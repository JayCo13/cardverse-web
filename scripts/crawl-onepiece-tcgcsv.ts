#!/usr/bin/env npx ts-node
/**
 * One Piece Card Crawler - TCGCSV
 * Fetches One Piece cards from TCGCSV (TCGPlayer data) and saves to tcgcsv_products table
 * 
 * Usage: npx ts-node scripts/crawl-onepiece-tcgcsv.ts
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// Configuration - load from environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
    process.exit(1);
}

// TCGCSV Category ID for One Piece
const ONE_PIECE_CATEGORY_ID = 68;

// TCGCSV API Base URL
const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer';

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface TcgGroup {
    groupId: number;
    name: string;
    abbreviation: string;
    publishedOn: string;
    modifiedOn: string;
    categoryId: number;
}

interface TcgProduct {
    productId: number;
    name: string;
    cleanName: string;
    imageUrl: string;
    categoryId: number;
    groupId: number;
    url: string;
    modifiedOn: string;
    extendedData?: Array<{
        name: string;
        value: string;
    }>;
}

interface TcgPrice {
    productId: number;
    lowPrice: number | null;
    midPrice: number | null;
    highPrice: number | null;
    marketPrice: number | null;
    directLowPrice: number | null;
    subTypeName: string;
}

interface DbProduct {
    product_id: number;
    category_id: number;
    group_id: number;
    name: string;
    image_url: string | null;
    set_name: string | null;
    number: string | null;
    rarity: string | null;
    market_price: number | null;
    low_price: number | null;
    mid_price: number | null;
    high_price: number | null;
    extended_data: Record<string, unknown>;
    tcgplayer_url: string | null;
}

async function fetchGroups(): Promise<TcgGroup[]> {
    console.log('📦 Fetching One Piece groups from TCGCSV...');

    const url = `${TCGCSV_BASE}/${ONE_PIECE_CATEGORY_ID}/groups`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to fetch groups: ${response.status}`);
    }

    const data = await response.json();
    console.log(`   Found ${data.results?.length || 0} groups`);
    return data.results || [];
}

async function fetchProducts(groupId: number): Promise<TcgProduct[]> {
    const url = `${TCGCSV_BASE}/${ONE_PIECE_CATEGORY_ID}/${groupId}/products`;
    const response = await fetch(url);

    if (!response.ok) {
        console.error(`   ❌ Failed to fetch products for group ${groupId}`);
        return [];
    }

    const data = await response.json();
    return data.results || [];
}

async function fetchPrices(groupId: number): Promise<TcgPrice[]> {
    const url = `${TCGCSV_BASE}/${ONE_PIECE_CATEGORY_ID}/${groupId}/prices`;
    const response = await fetch(url);

    if (!response.ok) {
        return [];
    }

    const data = await response.json();
    return data.results || [];
}

function extractExtendedData(product: TcgProduct): { number: string | null; rarity: string | null } {
    let number: string | null = null;
    let rarity: string | null = null;

    if (product.extendedData) {
        for (const data of product.extendedData) {
            if (data.name === 'Number') {
                number = data.value;
            } else if (data.name === 'Rarity') {
                rarity = data.value;
            }
        }
    }

    return { number, rarity };
}

async function processGroup(group: TcgGroup): Promise<number> {
    console.log(`\n📁 Processing: ${group.name} (ID: ${group.groupId})`);

    // Fetch products and prices
    const [products, prices] = await Promise.all([
        fetchProducts(group.groupId),
        fetchPrices(group.groupId)
    ]);

    console.log(`   Products: ${products.length}, Prices: ${prices.length}`);

    if (products.length === 0) return 0;

    // Create price map
    const priceMap = new Map<number, TcgPrice>();
    for (const price of prices) {
        // Prefer "Normal" pricing, fallback to first found
        if (!priceMap.has(price.productId) || price.subTypeName === 'Normal') {
            priceMap.set(price.productId, price);
        }
    }

    // Format products for database
    const dbProducts: DbProduct[] = products
        .filter(p => p.name && !p.name.toLowerCase().includes('booster') && !p.name.toLowerCase().includes('box'))
        .map(product => {
            const price = priceMap.get(product.productId);
            const { number, rarity } = extractExtendedData(product);

            return {
                product_id: product.productId,
                category_id: ONE_PIECE_CATEGORY_ID,
                group_id: group.groupId,
                name: product.name,
                // Convert thumbnail to high-res: _200w.jpg -> _in_1000x1000.jpg
                image_url: product.imageUrl
                    ? product.imageUrl.replace(/_\d+w\.jpg$/, '_in_1000x1000.jpg')
                    : null,
                set_name: group.name,
                number,
                rarity,
                market_price: price?.marketPrice || null,
                low_price: price?.lowPrice || null,
                mid_price: price?.midPrice || null,
                high_price: price?.highPrice || null,
                extended_data: {
                    extendedData: product.extendedData || [],
                    abbreviation: group.abbreviation,
                    publishedOn: group.publishedOn
                },
                tcgplayer_url: product.url || null
            };
        })
        // Filter out products without a card number
        .filter(p => p.number !== null);

    if (dbProducts.length === 0) return 0;

    // Upsert to database
    const { error } = await supabase
        .from('tcgcsv_products')
        .upsert(dbProducts, { onConflict: 'product_id' });

    if (error) {
        console.error(`   ❌ Insert error: ${error.message}`);
        return 0;
    }

    console.log(`   ✅ Upserted ${dbProducts.length} cards`);
    return dbProducts.length;
}

async function syncGroups(groups: TcgGroup[]): Promise<void> {
    console.log('📁 Syncing groups to tcgcsv_groups...');

    const dbGroups = groups.map(g => ({
        group_id: g.groupId,
        category_id: g.categoryId,
        name: g.name,
        published_on: g.publishedOn ? new Date(g.publishedOn) : null,
        modified_on: g.modifiedOn ? new Date(g.modifiedOn) : null
    }));

    const { error } = await supabase
        .from('tcgcsv_groups')
        .upsert(dbGroups, { onConflict: 'group_id' });

    if (error) {
        console.error(`   ❌ Groups sync error: ${error.message}`);
    } else {
        console.log(`   ✅ Synced ${dbGroups.length} groups`);
    }
}

async function main() {
    console.log('🏴‍☠️ Starting One Piece Card Crawler (TCGCSV)...\n');

    try {
        // Fetch all groups
        const groups = await fetchGroups();

        if (groups.length === 0) {
            console.log('No groups found');
            return;
        }

        // Sync groups to database
        await syncGroups(groups);

        // Process each group (most recent first)
        const sortedGroups = groups.sort((a, b) =>
            new Date(b.publishedOn || 0).getTime() - new Date(a.publishedOn || 0).getTime()
        );

        let totalCards = 0;

        // Process latest 10 sets to avoid overloading
        const setsToProcess = sortedGroups.slice(0, 10);
        console.log(`\n🎯 Processing ${setsToProcess.length} most recent sets...`);

        for (const group of setsToProcess) {
            const count = await processGroup(group);
            totalCards += count;

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`\n🎉 Crawl complete! Total cards synced: ${totalCards}`);

    } catch (error) {
        console.error('❌ Crawler error:', error);
        process.exit(1);
    }
}

main();
