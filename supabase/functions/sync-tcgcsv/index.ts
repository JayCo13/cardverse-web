// TCGCSV Sync Edge Function
// Syncs Pokemon card data from tcgcsv.com to Supabase
// Price history is recorded ONLY when a product's market price changes
// (plus a baseline for brand-new products), to avoid daily row bloat.
// 
// Usage: 
// - POST /sync-tcgcsv                 - Sync all Pokemon groups
// - POST /sync-tcgcsv?group_id=604    - Sync specific group (Base Set = 604)
// - POST /sync-tcgcsv?category_id=3   - Pokemon (3), Yu-Gi-Oh (2), One Piece (68)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const TCGCSV_BASE_URL = 'https://tcgcsv.com/tcgplayer';

// tcgcsv.com (Cloudflare) returns 401 to the default fetch User-Agent; a
// browser UA is accepted. This is why the edge-function sync started failing
// (HTTP 401) — it was never an IP block.
const TCG_FETCH_OPTS = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
};

// Category IDs
const CATEGORY_POKEMON = 3;
const CATEGORY_POKEMON_JAPAN = 85;
const CATEGORY_YUGIOH = 2;
const CATEGORY_ONEPIECE = 68;

// Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface TcgGroup {
    groupId: number;
    name: string;
    abbreviation?: string;
    publishedOn?: string;
    modifiedOn?: string;
    categoryId: number;
}

interface TcgProduct {
    productId: number;
    name: string;
    cleanName?: string;
    imageUrl?: string;
    categoryId: number;
    groupId: number;
    url?: string;
    modifiedOn?: string;
    extendedData?: Array<{ name: string; value: string }>;
}

interface TcgPrice {
    productId: number;
    lowPrice?: number;
    midPrice?: number;
    highPrice?: number;
    marketPrice?: number;
    directLowPrice?: number;
    subTypeName?: string;
}

// Fetch all groups for a category
async function fetchGroups(categoryId: number): Promise<TcgGroup[]> {
    const response = await fetch(`${TCGCSV_BASE_URL}/${categoryId}/groups`, TCG_FETCH_OPTS);
    if (!response.ok) throw new Error(`Failed to fetch groups: ${response.status}`);
    const data = await response.json();
    return data.results || [];
}

// Fetch products for a group
async function fetchProducts(categoryId: number, groupId: number): Promise<TcgProduct[]> {
    const response = await fetch(`${TCGCSV_BASE_URL}/${categoryId}/${groupId}/products`, TCG_FETCH_OPTS);
    if (!response.ok) throw new Error(`Failed to fetch products: ${response.status}`);
    const data = await response.json();
    return data.results || [];
}

// Fetch prices for a group
async function fetchPrices(categoryId: number, groupId: number): Promise<TcgPrice[]> {
    const response = await fetch(`${TCGCSV_BASE_URL}/${categoryId}/${groupId}/prices`, TCG_FETCH_OPTS);
    if (!response.ok) throw new Error(`Failed to fetch prices: ${response.status}`);
    const data = await response.json();
    return data.results || [];
}

// Extract extended data field value
function getExtendedValue(extendedData: Array<{ name: string; value: string }> | undefined, field: string): string | null {
    if (!extendedData) return null;
    const item = extendedData.find(d => d.name === field);
    return item?.value || null;
}

// Normalize a money value to 2dp for change comparison
// (NUMERIC may arrive from PostgREST as a string).
function normPrice(v: number | string | null | undefined): number | null {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// Store price history for chart data — but ONLY for products whose market
// price actually MOVED since the last sync. Unchanged prices (the bulk of
// products on any given day) are skipped, which keeps tcgcsv_price_history
// from growing ~60k rows/day. `oldPriceMap` holds the previously-stored
// market price per product, read BEFORE the product upsert overwrites it.
async function storePriceHistory(
    prices: TcgPrice[],
    oldPriceMap: Map<number, number | string | null>
): Promise<number> {
    if (prices.length === 0) return 0;

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const historyRows = prices
        .filter(p => p.marketPrice != null || p.lowPrice != null)
        .filter(p => {
            // New product (no prior price) → record a baseline point.
            if (!oldPriceMap.has(p.productId)) return true;
            // Otherwise only record when the market price changed.
            return normPrice(p.marketPrice) !== normPrice(oldPriceMap.get(p.productId));
        })
        .map(p => ({
            product_id: p.productId,
            market_price: p.marketPrice || null,
            low_price: p.lowPrice || null,
            mid_price: p.midPrice || null,
            high_price: p.highPrice || null,
            recorded_at: today,
        }));

    if (historyRows.length === 0) return 0;

    // Upsert handles re-runs / multiple price moves on the same day.
    const { error, count } = await supabase
        .from('tcgcsv_price_history')
        .upsert(historyRows, {
            onConflict: 'product_id,recorded_at',
            count: 'exact'
        });

    if (error) {
        console.error('Error storing price history:', error);
        return 0;
    }

    return count || historyRows.length;
}

// Sync a specific group (products + prices)
async function syncGroup(categoryId: number, groupId: number, groupName: string): Promise<{ products: number; updated: number; historyStored: number }> {
    console.log(`Syncing group ${groupId}: ${groupName}`);

    // Fetch products and prices in parallel
    const [allProducts, prices] = await Promise.all([
        fetchProducts(categoryId, groupId),
        fetchPrices(categoryId, groupId)
    ]);

    // CARDS ONLY: real cards have a collector Number. Sealed products
    // (booster packs/boxes, ETBs, tins, code cards, premium collections…)
    // have none — drop them so they don't pollute the catalog.
    const products = allProducts.filter(p => {
        const num = getExtendedValue(p.extendedData, 'Number');
        return num != null && String(num).trim() !== '';
    });

    // Create price lookup map
    const priceMap = new Map<number, TcgPrice>();
    for (const price of prices) {
        const existing = priceMap.get(price.productId);
        if (!existing || price.subTypeName === 'Normal' || price.subTypeName === 'Holofoil') {
            priceMap.set(price.productId, price);
        }
    }

    // Capture the previously-stored market price per product BEFORE the
    // upsert below overwrites tcgcsv_products — used to skip unchanged
    // price-history rows. Chunked to keep the IN() list small.
    const productIds = products.map(p => p.productId);
    const oldPriceMap = new Map<number, number | string | null>();
    for (let i = 0; i < productIds.length; i += 500) {
        const idChunk = productIds.slice(i, i + 500);
        const { data: existing } = await supabase
            .from('tcgcsv_products')
            .select('product_id, market_price')
            .in('product_id', idChunk);
        for (const row of existing ?? []) {
            oldPriceMap.set(row.product_id, row.market_price);
        }
    }

    // Transform products for upsert
    const productRows = products.map(p => {
        const price = priceMap.get(p.productId);
        return {
            product_id: p.productId,
            category_id: categoryId,
            group_id: groupId,
            name: p.name,
            image_url: p.imageUrl || null,
            set_name: groupName,
            number: getExtendedValue(p.extendedData, 'Number'),
            rarity: getExtendedValue(p.extendedData, 'Rarity'),
            market_price: price?.marketPrice || null,
            low_price: price?.lowPrice || null,
            mid_price: price?.midPrice || null,
            high_price: price?.highPrice || null,
            extended_data: p.extendedData ? JSON.stringify(p.extendedData) : '{}',
            tcgplayer_url: p.url || null,
        };
    });

    // Upsert products in batches
    const batchSize = 500;
    let updatedCount = 0;

    for (let i = 0; i < productRows.length; i += batchSize) {
        const batch = productRows.slice(i, i + batchSize);
        const { error } = await supabase
            .from('tcgcsv_products')
            .upsert(batch, { onConflict: 'product_id' });

        if (error) {
            console.error(`Error upserting batch ${i}-${i + batchSize}:`, error);
        } else {
            updatedCount += batch.length;
        }
    }

    // Store price history for charts (only products whose price changed)
    const historyStored = await storePriceHistory(prices, oldPriceMap);

    console.log(`Synced ${updatedCount}/${products.length} products, ${historyStored} price history records for ${groupName}`);
    return { products: products.length, updated: updatedCount, historyStored };
}

// Sync all groups for a category with batch pagination
async function syncCategory(categoryId: number, batch: number = 0): Promise<{
    groups: number;
    products: number;
    historyRecords: number;
    batch: number;
    batchSize: number;
    groupsSynced: number;
    hasMore: boolean;
    nextBatch: number | null
}> {
    console.log(`Syncing category ${categoryId}`);

    // Fetch all groups
    const groups = await fetchGroups(categoryId);
    console.log(`Found ${groups.length} groups`);

    // Upsert groups
    const groupRows = groups.map(g => ({
        group_id: g.groupId,
        category_id: categoryId,
        name: g.name,
        published_on: g.publishedOn ? g.publishedOn.split('T')[0] : null,
        modified_on: g.modifiedOn || null,
    }));

    const { error: groupError } = await supabase
        .from('tcgcsv_groups')
        .upsert(groupRows, { onConflict: 'group_id' });

    if (groupError) {
        console.error('Error upserting groups:', groupError);
    }

    // Sort groups by publishedOn (newest first)
    const sortedGroups = groups.sort((a, b) => {
        const dateA = a.publishedOn ? new Date(a.publishedOn).getTime() : 0;
        const dateB = b.publishedOn ? new Date(b.publishedOn).getTime() : 0;
        return dateB - dateA;
    });

    // Apply batch pagination
    const batchSize = 50;
    const startIdx = batch * batchSize;
    const endIdx = Math.min(startIdx + batchSize, sortedGroups.length);
    const groupsToSync = sortedGroups.slice(startIdx, endIdx);

    console.log(`Syncing batch ${batch}: groups ${startIdx}-${endIdx} of ${sortedGroups.length}`);

    let totalProducts = 0;
    let totalHistory = 0;

    for (const group of groupsToSync) {
        try {
            const result = await syncGroup(categoryId, group.groupId, group.name);
            totalProducts += result.products;
            totalHistory += result.historyStored;
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            console.error(`Error syncing group ${group.groupId}:`, error);
        }
    }

    const hasMore = endIdx < sortedGroups.length;
    return {
        groups: groups.length,
        products: totalProducts,
        historyRecords: totalHistory,
        batch,
        batchSize,
        groupsSynced: groupsToSync.length,
        hasMore,
        nextBatch: hasMore ? batch + 1 : null
    };
}

// Main handler
Deno.serve(async (req) => {
    try {
        const url = new URL(req.url);
        const groupId = url.searchParams.get('group_id');
        const categoryId = parseInt(url.searchParams.get('category_id') || String(CATEGORY_POKEMON));
        const batch = parseInt(url.searchParams.get('batch') || '0');

        let result: any;

        if (groupId) {
            // Sync specific group
            const group = await supabase
                .from('tcgcsv_groups')
                .select('name')
                .eq('group_id', parseInt(groupId))
                .single();

            result = await syncGroup(categoryId, parseInt(groupId), group.data?.name || 'Unknown');
        } else {
            // Sync entire category with batch support
            result = await syncCategory(categoryId, batch);
        }

        return new Response(
            JSON.stringify({ success: true, ...result }),
            { headers: { 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('Sync error:', error);
        return new Response(
            JSON.stringify({ success: false, error: String(error) }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
});
