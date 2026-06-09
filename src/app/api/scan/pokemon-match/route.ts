import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

// Number-based candidate search for the card scanner, run with the SERVICE ROLE.
//
// Why a server route: the anon/authenticated Postgres roles have a ~3s
// statement_timeout, and tcgcsv_products has no index on `number`, so a
// number lookup that matches few rows seq-scans and times out from the client.
// service_role has no such timeout, so the same query completes here. (Adding
// the pg_trgm/btree index on `number` makes this fast; until then this keeps
// number matching working.)

const SEL = 'product_id,name,image_url,set_name,rarity,market_price,low_price,mid_price,high_price,number,tcgplayer_url,extended_data,category_id';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const catIds: number[] = Array.isArray(body.catIds) ? body.catIds.filter((n: unknown) => typeof n === 'number') : [];
        const numberFormats: string[] = Array.isArray(body.numberFormats) ? body.numberFormats.filter(Boolean).slice(0, 40) : [];
        const collectorPatterns: string[] = Array.isArray(body.collectorPatterns) ? body.collectorPatterns.filter(Boolean).slice(0, 20) : [];

        if (catIds.length === 0 || (numberFormats.length === 0 && collectorPatterns.length === 0)) {
            return NextResponse.json({ products: [] });
        }

        const supabase = createServiceSupabaseClient();
        const seen = new Set<number>();
        const products: Record<string, unknown>[] = [];
        const add = (rows: Record<string, unknown>[] | null) => {
            for (const r of rows || []) {
                const id = r.product_id as number;
                if (!seen.has(id)) { seen.add(id); products.push(r); }
            }
        };

        const tasks: Promise<void>[] = [];
        for (const cat of catIds) {
            // exact number (any format variant)
            if (numberFormats.length > 0) {
                const orEq = numberFormats.map((n) => `number.eq.${n}`).join(',');
                tasks.push((async () => {
                    try {
                        const { data } = await supabase.from('tcgcsv_products').select(SEL).eq('category_id', cat).or(orEq).limit(25);
                        add(data as Record<string, unknown>[] | null);
                    } catch { /* ignore */ }
                })());
            }
            // collector token (ilike) — robust to a misread set total / format
            if (collectorPatterns.length > 0) {
                const orIlike = collectorPatterns.map((p) => `number.ilike.${p}`).join(',');
                tasks.push((async () => {
                    try {
                        const { data } = await supabase.from('tcgcsv_products').select(SEL).eq('category_id', cat).or(orIlike).limit(60);
                        add(data as Record<string, unknown>[] | null);
                    } catch { /* ignore */ }
                })());
            }
        }
        await Promise.allSettled(tasks);

        return NextResponse.json({ products });
    } catch (e) {
        return NextResponse.json({ products: [], error: (e as Error)?.message || 'error' }, { status: 200 });
    }
}
