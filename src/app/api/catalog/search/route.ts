import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

// Catalog search for the sell-form card picker. Sellers find the EXACT card
// they are listing so the listing carries a canonical catalog key
// (tcgcsv_products.product_id or soccer_cards.id) — the foundation of the VN
// market price aggregation.
//
// Service role for tcgcsv_products for the same reason as scan/pokemon-match:
// anon roles hit the ~3s statement_timeout on un-indexed `number` lookups.

const TCG_SEL = 'product_id,name,image_url,set_name,rarity,number,category_id,market_price';

// tcgcsv category ids: 3 = Pokémon EN, 85 = Pokémon JP, 68 = One Piece.
const CATEGORY_MAP: Record<string, { catId: number; language: 'en' | 'jp' }> = {
    'pokemon-en': { catId: 3, language: 'en' },
    'pokemon-jp': { catId: 85, language: 'jp' },
    'onepiece': { catId: 68, language: 'en' },
};

export type CatalogSearchResult = {
    kind: 'tcgcsv' | 'soccer';
    productId?: number;
    soccerId?: number;
    name: string;
    setName: string | null;
    number: string | null;
    language: 'en' | 'jp' | null;
    imageUrl: string | null;
    rarity: string | null;
    marketPrice?: number | null;
};

const escapeIlike = (value: string) => value.replace(/[%_,()]/g, ' ').trim();

export async function GET(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const q = escapeIlike(String(searchParams.get('q') || ''));
        const category = String(searchParams.get('category') || '');

        if (q.length < 2) {
            return NextResponse.json({ results: [] });
        }

        if (category === 'soccer') {
            // Soccer catalog lives in soccer_cards (regular client is fine —
            // search_name/card_number lookups are indexed).
            const { data, error } = await supabase
                .from('soccer_cards')
                .select('id, player, set_name, card_number, parallel, brand, year')
                .or(`search_name.ilike.%${q.toLowerCase()}%,card_number.ilike.%${q}%`)
                .limit(20);

            if (error) throw error;

            const results: CatalogSearchResult[] = ((data || []) as any[]).map(row => ({
                kind: 'soccer',
                soccerId: row.id,
                name: `${row.player}${row.parallel && row.parallel !== 'Base' ? ` (${row.parallel})` : ''}`,
                setName: `${row.year} ${row.brand} ${row.set_name}`.trim(),
                number: row.card_number,
                language: null,
                imageUrl: null,
                rarity: null,
            }));
            return NextResponse.json({ results });
        }

        const mapped = CATEGORY_MAP[category];
        if (!mapped) {
            return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
        }

        const service = createServiceSupabaseClient();
        const { data, error } = await service
            .from('tcgcsv_products')
            .select(TCG_SEL)
            .eq('category_id', mapped.catId)
            .or(`name.ilike.%${q}%,number.ilike.%${q}%`)
            .limit(20);

        if (error) throw error;

        const results: CatalogSearchResult[] = ((data || []) as any[]).map(row => ({
            kind: 'tcgcsv',
            productId: row.product_id,
            name: row.name,
            setName: row.set_name,
            number: row.number,
            language: mapped.language,
            imageUrl: row.image_url,
            rarity: row.rarity,
            marketPrice: row.market_price,
        }));

        return NextResponse.json({ results });
    } catch (error: any) {
        console.error('Catalog search error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
