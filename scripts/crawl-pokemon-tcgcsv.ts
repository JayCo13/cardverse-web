#!/usr/bin/env npx tsx
/**
 * Pokémon Card Crawler — TCGCSV (LOCAL, direct fetch)
 *
 * Replaces the sync-tcgcsv EDGE FUNCTION for Pokémon: tcgcsv.com blocks
 * cloud IPs (Supabase edge / GitHub / Netlify all get HTTP 401), so the
 * fetch must originate from a residential IP. This script does that —
 * run it from your Mac (e.g. via crawl-full.command / daily-sync.sh).
 *
 * Mirrors the edge function's product/price mapping so existing data and
 * the Pokémon materialized views stay consistent, and records a price-
 * history point ONLY when a product's market price changed.
 *
 * Categories: 3 = Pokémon EN, 85 = Pokémon JP.
 * Usage:
 *   npx tsx scripts/crawl-pokemon-tcgcsv.ts            # both EN + JP
 *   npx tsx scripts/crawl-pokemon-tcgcsv.ts --category 3
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
    process.exit(1);
}

const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer';
const CATEGORIES: Record<number, string> = { 3: 'Pokémon EN', 85: 'Pokémon JP' };

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface TcgGroup { groupId: number; name: string; abbreviation?: string; publishedOn?: string; modifiedOn?: string; categoryId: number; }
interface TcgProduct { productId: number; name: string; imageUrl?: string; url?: string; extendedData?: Array<{ name: string; value: string }>; }
interface TcgPrice { productId: number; lowPrice: number | null; midPrice: number | null; highPrice: number | null; marketPrice: number | null; subTypeName: string; }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// tcgcsv.com (Cloudflare) returns 401 to the default node/undici User-Agent.
// A browser UA is accepted — this is what makes the fetch work from ANY host
// (local, Supabase edge, GitHub Actions); it was never an IP block.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchJson(url: string): Promise<any> {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return res.json();
}

function getExtended(ext: Array<{ name: string; value: string }> | undefined, field: string): string | null {
    return ext?.find(d => d.name === field)?.value || null;
}

// 2dp normalize for change comparison (numeric may come back as string).
function normPrice(v: number | string | null | undefined): number | null {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

async function processGroup(categoryId: number, group: TcgGroup): Promise<{ products: number; history: number }> {
    let products: TcgProduct[] = [];
    let prices: TcgPrice[] = [];
    try {
        [products, prices] = await Promise.all([
            fetchJson(`${TCGCSV_BASE}/${categoryId}/${group.groupId}/products`).then(d => d.results || []),
            fetchJson(`${TCGCSV_BASE}/${categoryId}/${group.groupId}/prices`).then(d => d.results || []),
        ]);
    } catch (e) {
        console.error(`   ❌ ${group.name}: ${(e as Error).message}`);
        return { products: 0, history: 0 };
    }
    if (products.length === 0) return { products: 0, history: 0 };

    // Price map: prefer Normal / Holofoil (matches the edge function).
    const priceMap = new Map<number, TcgPrice>();
    for (const p of prices) {
        const existing = priceMap.get(p.productId);
        if (!existing || p.subTypeName === 'Normal' || p.subTypeName === 'Holofoil') priceMap.set(p.productId, p);
    }

    // Capture previous market prices BEFORE upsert (for change detection).
    const ids = products.map(p => p.productId);
    const oldPriceMap = new Map<number, number | string | null>();
    for (let i = 0; i < ids.length; i += 500) {
        const { data } = await supabase
            .from('tcgcsv_products')
            .select('product_id, market_price')
            .in('product_id', ids.slice(i, i + 500));
        for (const r of data ?? []) oldPriceMap.set(r.product_id, r.market_price);
    }

    const dbProducts = products
        // CARDS ONLY: real cards have a collector Number in extendedData.
        // Sealed products (booster packs/boxes, ETBs, tins, code cards,
        // premium collections, cases…) have no Number — drop them.
        .filter(p => {
            const num = getExtended(p.extendedData, 'Number');
            return num != null && String(num).trim() !== '';
        })
        .map(p => {
            const price = priceMap.get(p.productId);
            return {
                product_id: p.productId,
                category_id: categoryId,
                group_id: group.groupId,
                name: p.name,
                image_url: p.imageUrl || null,
                set_name: group.name,
                number: getExtended(p.extendedData, 'Number'),
                rarity: getExtended(p.extendedData, 'Rarity'),
                market_price: price?.marketPrice ?? null,
                low_price: price?.lowPrice ?? null,
                mid_price: price?.midPrice ?? null,
                high_price: price?.highPrice ?? null,
                extended_data: p.extendedData ? JSON.stringify(p.extendedData) : '{}',
                tcgplayer_url: p.url || null,
            };
        });

    if (dbProducts.length === 0) return { products: 0, history: 0 };

    const { error: upErr } = await supabase.from('tcgcsv_products').upsert(dbProducts, { onConflict: 'product_id' });
    if (upErr) { console.error(`   ❌ ${group.name} products: ${upErr.message}`); return { products: 0, history: 0 }; }

    // Only the cards we kept (history for sealed products is pointless).
    const keptIds = new Set(dbProducts.map(p => p.product_id));

    // Price history — only products whose market price actually moved.
    const historyRows = prices
        .filter(p => keptIds.has(p.productId))
        .filter(p => priceMap.get(p.productId) === p) // one row per product (the chosen subtype)
        .filter(p => p.marketPrice != null || p.lowPrice != null)
        .filter(p => !oldPriceMap.has(p.productId) || normPrice(p.marketPrice) !== normPrice(oldPriceMap.get(p.productId)))
        .map(p => ({
            product_id: p.productId,
            market_price: p.marketPrice ?? null,
            low_price: p.lowPrice ?? null,
            mid_price: p.midPrice ?? null,
            high_price: p.highPrice ?? null,
            recorded_at: today,
        }));

    let historyCount = 0;
    if (historyRows.length > 0) {
        const { error: hErr } = await supabase
            .from('tcgcsv_price_history')
            .upsert(historyRows, { onConflict: 'product_id,recorded_at' });
        if (hErr) console.error(`   ⚠️  ${group.name} history: ${hErr.message}`);
        else historyCount = historyRows.length;
    }

    console.log(`   ✅ ${group.name}: ${dbProducts.length} products, ${historyCount} price changes`);
    return { products: dbProducts.length, history: historyCount };
}

async function syncCategory(categoryId: number): Promise<void> {
    const label = CATEGORIES[categoryId] || `category ${categoryId}`;
    console.log(`\n📦 ${label} — fetching groups...`);
    const groups: TcgGroup[] = (await fetchJson(`${TCGCSV_BASE}/${categoryId}/groups`)).results || [];
    console.log(`   ${groups.length} groups`);
    if (groups.length === 0) return;

    // Upsert groups
    const dbGroups = groups.map(g => ({
        group_id: g.groupId,
        category_id: categoryId,
        name: g.name,
        published_on: g.publishedOn ? g.publishedOn.split('T')[0] : null,
        modified_on: g.modifiedOn || null,
    }));
    const { error: gErr } = await supabase.from('tcgcsv_groups').upsert(dbGroups, { onConflict: 'group_id' });
    if (gErr) console.error(`   ❌ groups: ${gErr.message}`);

    // Process every group (newest first), gentle rate limit to stay unblocked.
    const sorted = groups.sort((a, b) =>
        new Date(b.publishedOn || 0).getTime() - new Date(a.publishedOn || 0).getTime());

    let totalProducts = 0, totalHistory = 0;
    for (const g of sorted) {
        const r = await processGroup(categoryId, g);
        totalProducts += r.products; totalHistory += r.history;
        await sleep(400);
    }
    console.log(`📊 ${label} done: ${totalProducts} products, ${totalHistory} price changes`);
}

async function main() {
    const argIdx = process.argv.indexOf('--category');
    const cats = argIdx !== -1 ? [parseInt(process.argv[argIdx + 1], 10)] : [3, 85];

    console.log(`⚡ Pokémon TCGCSV crawler (local) — categories: ${cats.join(', ')}`);
    try {
        for (const c of cats) await syncCategory(c);

        // Refresh the Pokémon materialized views (DB-side RPC, not IP-blocked).
        console.log('\n🔄 Refreshing Pokémon materialized views...');
        const { error } = await supabase.rpc('refresh_pokemon_views');
        if (error) console.error(`   ⚠️  refresh_pokemon_views: ${error.message}`);
        else console.log('   ✅ views refreshed');

        console.log('\n🎉 Pokémon crawl complete.');
    } catch (e) {
        console.error('❌ Crawler error:', e);
        process.exit(1);
    }
}

main();
