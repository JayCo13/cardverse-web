#!/usr/bin/env npx ts-node
/**
 * Topps Soccer 2025-2026 Sold Cards Crawler
 * Fetches SOLD/completed listings from eBay for Topps soccer cards
 * 
 * Usage: npx ts-node scripts/crawl-topps-sold.ts
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// Configuration - load from environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const EBAY_APP_ID = process.env.EBAY_APP_ID || '';
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || '';
const SELLER_ID = process.env.SELLER_ID || 'bbf79ca5-b980-4fdd-85a6-31cac47db0c4';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
    process.exit(1);
}
if (!EBAY_APP_ID || !EBAY_CLIENT_SECRET) {
    console.error('❌ Missing EBAY_APP_ID or EBAY_CLIENT_SECRET environment variables');
    process.exit(1);
}

// ========================================
// TOPPS 2025/2026 SEARCH CATEGORIES
// General searches without player names
// ========================================
const TOPPS_CATEGORIES = [
    // Topps Chrome 2025
    {
        name: 'Topps Chrome 2025',
        query: 'topps chrome soccer 2025 autograph auto',
        minPrice: 10
    },
    {
        name: 'Topps Chrome 2025 Refractor',
        query: 'topps chrome soccer 2025 refractor numbered',
        minPrice: 15
    },
    {
        name: 'Topps Chrome 2025 Gold',
        query: 'topps chrome soccer 2025 gold /50 /25',
        minPrice: 25
    },
    // Topps 2025/2026 General
    {
        name: 'Topps Soccer 2025',
        query: 'topps soccer card 2025 autograph auto signed',
        minPrice: 10
    },
    {
        name: 'Topps Soccer 2026',
        query: 'topps soccer card 2026 autograph auto signed',
        minPrice: 10
    },
    {
        name: 'Topps Finest 2025',
        query: 'topps finest soccer 2025 autograph refractor',
        minPrice: 15
    },
    // Topps Match Attax & Merlin
    {
        name: 'Topps Match Attax 2025',
        query: 'topps match attax 2025 limited edition gold',
        minPrice: 5
    },
    {
        name: 'Topps Merlin 2025',
        query: 'topps merlin heritage soccer 2025',
        minPrice: 10
    },
    // Champions League
    {
        name: 'Topps UCL 2025',
        query: 'topps champions league 2025 autograph auto',
        minPrice: 15
    },
    {
        name: 'Topps UCL 2024-25',
        query: 'topps uefa champions league 2024-25 limited auto',
        minPrice: 10
    },
    // Premier League Topps
    {
        name: 'Topps Premier League 2025',
        query: 'topps premier league 2025 autograph auto card',
        minPrice: 10
    },
    // Bowman (Topps subsidiary)
    {
        name: 'Bowman Soccer 2025',
        query: 'bowman soccer 2025 autograph auto prospect',
        minPrice: 15
    },
];

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface EbayItem {
    itemId: string;
    title: string;
    price?: { value: string; currency: string };
    image?: { imageUrl: string };
    thumbnailImages?: Array<{ imageUrl: string }>;
    condition?: string;
    itemEndDate?: string;
    seller?: { username: string };
}

interface CrawledCard {
    name: string;
    price: number;
    category: string;
    listing_type: string;
    seller_id: string;
    ebay_id: string;
    description: string;
    image_url: string | null;
    year: string | null;
    grader: string | null;
    grade: string | null;
    set_name: string | null;
    player_name: string | null;
    metadata: Record<string, unknown>;
}

async function getEbayToken(): Promise<string> {
    console.log('🔑 Getting eBay access token...');

    const authBasic = Buffer.from(`${EBAY_APP_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
    const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${authBasic}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });

    if (!response.ok) {
        throw new Error(`Failed to get eBay token: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Got eBay access token');
    return data.access_token;
}

async function searchEbaySold(token: string, query: string, minPrice: number): Promise<EbayItem[]> {
    const encodedQuery = encodeURIComponent(query);
    // Use filter for SOLD items - items that have ended with a sale
    const filter = `&filter=price:[${minPrice}..]&filter=buyingOptions:{FIXED_PRICE|AUCTION}&filter=itemEndDate:[2024-01-01T00:00:00Z..]`;
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodedQuery}&limit=50${filter}`;

    console.log(`🔍 Searching eBay (Sold): ${query.substring(0, 50)}...`);

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        console.error(`❌ eBay search failed: ${response.status}`);
        return [];
    }

    const data = await response.json();
    return data.itemSummaries || [];
}

function parseCardDetails(title: string): { year: string | null; grader: string | null; grade: string | null; setName: string | null; playerName: string | null } {
    // Extract year
    const yearMatch = title.match(/\b(202[4-9]|203\d)\b/);
    const year = yearMatch ? yearMatch[0] : null;

    // Extract grader
    const graderMatch = title.match(/\b(PSA|BGS|SGC|CGC|TAG|ACE)\b/i);
    const grader = graderMatch ? graderMatch[0].toUpperCase() : null;

    // Extract grade
    let grade: string | null = null;
    if (grader) {
        const gradeRegex = new RegExp(`${grader}\\s?(\\d{1,2}(\\.\\d)?)`, 'i');
        const gradeMatch = title.match(gradeRegex);
        if (gradeMatch) grade = gradeMatch[1];
    }

    // Extract set name (Topps variants)
    const setMatch = title.match(/\b(Chrome|Finest|Merlin|Match Attax|Bowman|Heritage|Stadium Club)\b/i);
    const setName = setMatch ? `Topps ${setMatch[0]}` : 'Topps';

    // Extract player name
    const playerPatterns = [
        /\b(Mbappe|Mbappé|Haaland|Bellingham|Yamal|Mainoo|Wirtz|Musiala)\b/i,
        /\b(Messi|Ronaldo|Neymar)\b/i,
        /\b(Salah|Saka|Palmer|Foden|Rice|Fernandes|Rashford|Kane)\b/i,
        /\b(Vinicius|Pedri|Gavi|Lautaro)\b/i,
    ];
    let playerName: string | null = null;
    for (const pattern of playerPatterns) {
        const match = title.match(pattern);
        if (match) {
            playerName = match[0];
            break;
        }
    }

    return { year, grader, grade, setName, playerName };
}

function formatCard(item: EbayItem, category: string): CrawledCard | null {
    if (!item.title) return null;

    const title = item.title.toLowerCase();

    // Exclude non-single-card items
    const excludePatterns = [
        'mystery', 'pack', 'box', 'lot', 'bundle', 'set of', 'collection',
        'bulk', 'repack', 'break', 'pick your', 'you pick', 'choose',
        'complete set', 'base set', 'hobby', 'blaster', 'mega box',
        'hanger', 'cello', 'fat pack', 'value pack', 'multi pack',
        'guaranteed', 'random', 'chase', 'hit or miss',
        // American football exclusions
        'nfl', 'football', 'quarterback', 'touchdown', 'super bowl'
    ];

    for (const pattern of excludePatterns) {
        if (title.includes(pattern)) {
            return null;
        }
    }

    const rawPrice = item.price ? parseFloat(item.price.value) : 0;
    if (rawPrice <= 0) return null;

    let imageUrl: string | null = null;
    if (item.image?.imageUrl) {
        imageUrl = item.image.imageUrl;
    } else if (item.thumbnailImages?.[0]?.imageUrl) {
        imageUrl = item.thumbnailImages[0].imageUrl;
    }

    if (!imageUrl) return null;

    // Convert to high-resolution
    imageUrl = imageUrl
        .replace(/s-l\d+\.jpg/i, 's-l1600.jpg')
        .replace(/s-l\d+\.png/i, 's-l1600.png')
        .replace(/s-l\d+\.webp/i, 's-l1600.webp');

    const { year, grader, grade, setName, playerName } = parseCardDetails(item.title);

    return {
        name: item.title,
        price: Math.round(rawPrice),
        category: 'Soccer Cards',
        listing_type: 'sold', // Mark as SOLD
        seller_id: SELLER_ID,
        ebay_id: item.itemId,
        description: `SOLD: eBay Item ID: ${item.itemId} | Sold Price: $${rawPrice}`,
        image_url: imageUrl,
        year,
        grader,
        grade,
        set_name: setName,
        player_name: playerName,
        metadata: {
            ...item,
            sport: 'soccer',
            original_price_usd: rawPrice,
            source_category: category,
            is_sold: true,
            crawled_at: new Date().toISOString()
        }
    };
}

async function insertCards(cards: CrawledCard[]): Promise<number> {
    if (cards.length === 0) return 0;

    console.log(`💾 Inserting ${cards.length} sold cards into database...`);

    const ebayIds = cards.map(c => c.ebay_id);
    const { data: existingCards } = await supabase
        .from('crawled_cards')
        .select('ebay_id')
        .in('ebay_id', ebayIds);

    const existingIds = new Set(existingCards?.map(c => c.ebay_id) || []);
    const newCards = cards.filter(c => !existingIds.has(c.ebay_id));

    if (newCards.length === 0) {
        console.log('ℹ️  All cards already exist in database');
        return 0;
    }

    const { error } = await supabase
        .from('crawled_cards')
        .insert(newCards);

    if (error) {
        console.error('❌ Insert error:', error.message);
        return 0;
    }

    console.log(`✅ Inserted ${newCards.length} new sold cards`);
    return newCards.length;
}

async function main() {
    console.log('🚀 Starting Topps 2025/2026 Sold Cards Crawler...\n');

    try {
        const token = await getEbayToken();
        let totalInserted = 0;

        console.log('\n📦 Crawling Topps 2025/2026 Categories...');
        for (const category of TOPPS_CATEGORIES) {
            console.log(`\n🏷️  Processing: ${category.name}`);

            const items = await searchEbaySold(token, category.query, category.minPrice);
            console.log(`   Found ${items.length} items`);

            const cards = items
                .map(item => formatCard(item, category.name))
                .filter((card): card is CrawledCard => card !== null);

            console.log(`   Formatted ${cards.length} valid cards`);

            const inserted = await insertCards(cards);
            totalInserted += inserted;

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`\n🎉 Crawl complete! Total new sold cards inserted: ${totalInserted}`);

    } catch (error) {
        console.error('❌ Crawler error:', error);
        process.exit(1);
    }
}

main();
