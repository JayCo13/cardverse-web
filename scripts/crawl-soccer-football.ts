#!/usr/bin/env npx ts-node
/**
 * Soccer & Football Card Crawler (eBay Browse API Version)
 * Uses official eBay Browse API instead of web scraping to avoid bot detection.
 * Fetches active listings and saves them with real market prices.
 * 
 * Usage: npx ts-node scripts/crawl-soccer-football.ts
 * 
 * Required env vars: EBAY_APP_ID, EBAY_CLIENT_SECRET, SUPABASE_URL/KEY
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
    console.error('   These are required for the eBay Browse API.');
    console.error('   Set them in your .env file.');
    process.exit(1);
}

// ========================================
// SOCCER SEARCH QUERIES (2024-2026)
// Using broader queries to maximize results via API
// ========================================
const SOCCER_SETS = [
    // ===== TOPPS =====
    { name: 'Topps Chrome Soccer', query: 'topps chrome soccer card -pack -box -lot -break -case', minPrice: 3 },
    { name: 'Topps Chrome Soccer Auto', query: 'topps chrome soccer autograph -pack -box -lot -break', minPrice: 15 },
    { name: 'Topps Chrome Refractor', query: 'topps chrome soccer refractor -pack -box -lot -break', minPrice: 8 },
    { name: 'Topps Finest Soccer', query: 'topps finest soccer card -pack -box -lot -break', minPrice: 5 },
    { name: 'Topps Merlin Soccer', query: 'topps merlin soccer card -pack -box -lot -break', minPrice: 3 },
    { name: 'Topps UCL', query: 'topps champions league card -pack -box -lot -break -sticker', minPrice: 3 },
    { name: 'Topps Museum Soccer', query: 'topps museum collection soccer -pack -box -lot -break', minPrice: 10 },
    { name: 'Topps Soccer General', query: 'topps soccer card autograph auto -pack -box -lot -break', minPrice: 5 },

    // ===== PANINI =====
    { name: 'Panini Prizm Soccer', query: 'panini prizm soccer card -pack -box -lot -break', minPrice: 3 },
    { name: 'Panini Prizm Silver', query: 'panini prizm soccer silver -pack -box -lot -break', minPrice: 8 },
    { name: 'Panini Prizm Color', query: 'panini prizm soccer gold numbered -pack -box -lot -break', minPrice: 15 },
    { name: 'Panini Select Soccer', query: 'panini select soccer card -pack -box -lot -break', minPrice: 3 },
    { name: 'Panini Mosaic Soccer', query: 'panini mosaic soccer card -pack -box -lot -break', minPrice: 3 },
    { name: 'Panini Donruss Soccer', query: 'panini donruss soccer card -pack -box -lot -break', minPrice: 2 },
    { name: 'Panini Obsidian Soccer', query: 'panini obsidian soccer card -pack -box -lot -break', minPrice: 10 },
    { name: 'Panini Immaculate Soccer', query: 'panini immaculate soccer card -pack -box -lot -break', minPrice: 15 },

    // ===== PLAYER SPECIFIC (high-value) =====
    { name: 'Messi Cards', query: 'lionel messi soccer card -pack -box -lot -break -sticker', minPrice: 5 },
    { name: 'Ronaldo Cards', query: 'cristiano ronaldo soccer card -pack -box -lot -break -sticker', minPrice: 5 },
    { name: 'Mbappe Cards', query: 'mbappe soccer card -pack -box -lot -break -sticker', minPrice: 5 },
    { name: 'Haaland Cards', query: 'haaland soccer card -pack -box -lot -break -sticker', minPrice: 5 },
    { name: 'Bellingham Cards', query: 'bellingham soccer card -pack -box -lot -break -sticker', minPrice: 5 },
    { name: 'Yamal Cards', query: 'lamine yamal soccer card -pack -box -lot -break -sticker', minPrice: 5 },
    { name: 'Vinicius Cards', query: 'vinicius soccer card -pack -box -lot -break -sticker', minPrice: 5 },
    { name: 'Salah Cards', query: 'salah soccer card -pack -box -lot -break -sticker', minPrice: 5 },
    { name: 'Palmer Cards', query: 'cole palmer soccer card -pack -box -lot -break -sticker', minPrice: 3 },
    { name: 'Saka Cards', query: 'bukayo saka soccer card -pack -box -lot -break -sticker', minPrice: 3 },

    // ===== GENERAL =====
    { name: 'Soccer Auto Cards', query: 'soccer autograph card auto signed -pack -box -lot -break', minPrice: 10 },
    { name: 'Soccer Numbered Cards', query: 'soccer card numbered /99 /50 /25 -pack -box -lot -break', minPrice: 10 },
    { name: 'Soccer PSA Graded', query: 'soccer card PSA graded -pack -box -lot -break', minPrice: 10 },
    { name: 'Soccer BGS Graded', query: 'soccer card BGS graded -pack -box -lot -break', minPrice: 10 },
];

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface EbayItem {
    itemId: string;
    title: string;
    price?: { value: string; currency: string };
    image?: { imageUrl: string };
    thumbnailImages?: Array<{ imageUrl: string }>;
    condition?: string;
    seller?: { username: string };
    itemWebUrl?: string;
    categories?: Array<{ categoryId: string; categoryName: string }>;
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

// ========================================
// eBay API Authentication
// ========================================
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

// ========================================
// eBay Browse API Search
// ========================================
async function searchEbayAPI(token: string, query: string, minPrice: number): Promise<EbayItem[]> {
    const encodedQuery = encodeURIComponent(query);
    
    // Browse API with price filter
    // Category 261328 = "Trading Card Singles" (avoids boxes, packs, etc.)
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodedQuery}&category_ids=261328&limit=50&filter=price:[${minPrice}..],priceCurrency:USD&sort=newlyListed`;

    console.log(`🔍 API Search: ${query.substring(0, 50)}...`);

    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`   ❌ API error ${response.status}: ${errorText.substring(0, 200)}`);
            return [];
        }

        const data = await response.json();
        const items = data.itemSummaries || [];
        console.log(`   Found ${items.length} items via API`);
        return items;
    } catch (error) {
        console.error(`   ❌ Fetch error: ${(error as any).message}`);
        return [];
    }
}

// ========================================
// Card Detail Parser
// ========================================
function parseCardDetails(title: string): {
    year: string | null;
    grader: string | null;
    grade: string | null;
    setName: string | null;
    playerName: string | null;
} {
    // Extract year
    const yearMatch = title.match(/\b(20[12]\d)\b/);
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

    // Extract set name (brand/product line)
    const setPatterns = [
        /\b(Prizm|Chrome|Finest|Optic|Select|Mosaic|Donruss|Obsidian|Immaculate|National Treasures)\b/i,
        /\b(Bowman|Topps|Panini|Upper Deck|Fleer|Score|Merlin|Museum|Match Attax)\b/i,
    ];
    let setName: string | null = null;
    for (const pattern of setPatterns) {
        const match = title.match(pattern);
        if (match) {
            setName = match[0];
            break;
        }
    }

    // Extract player name with expanded list
    const playerPatterns = [
        /\b(Mbapp[eé]|Haaland|Bellingham|Yamal|Mainoo|Wirtz|Musiala)\b/i,
        /\b(Messi|Ronaldo|Neymar)\b/i,
        /\b(Salah|Saka|Palmer|Foden|Rice|Fernandes|Rashford|Kane)\b/i,
        /\b(Vinicius|Vini\s*Jr|Pedri|Gavi|Lautaro|Martinez)\b/i,
        /\b(Sane|Gnabry|Havertz|De\s*Bruyne|Modric|Kroos|Lewandowski)\b/i,
        /\b(Endrick|Rodrygo|Camavinga|Valverde|Tchouameni)\b/i,
        /\b(Osimhen|Nkunku|Olmo|Joao\s*Felix|Grealish)\b/i,
        /\b(Maradona|Pele|Pel[eé]|Zidane|Beckham|Ronaldinho)\b/i,
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

// ========================================
// Format eBay API item into CrawledCard
// ========================================
function formatCard(item: EbayItem, categoryName: string): CrawledCard | null {
    if (!item.title) return null;

    const titleLower = item.title.toLowerCase();

    // Exclude non-single-card items
    const excludePatterns = [
        'mystery', 'pack', 'box', 'lot', 'bundle', 'set of', 'collection', 'bulk', 'repack',
        'break', 'pick your', 'you pick', 'choose', 'complete set', 'base set', 'hobby', 'blaster',
        'mega box', 'hanger', 'cello', 'fat pack', 'value pack', 'multi pack', 'guaranteed', 'random',
        'chase', 'hit or miss', 'sticker', 'album', 'digital', 'online', 'code', 'printing plate',
        // American football exclusions
        'nfl', 'quarterback', 'touchdown', 'super bowl'
    ];

    for (const pattern of excludePatterns) {
        if (titleLower.includes(pattern)) return null;
    }

    const rawPrice = item.price ? parseFloat(item.price.value) : 0;
    if (rawPrice <= 0) return null;

    // Get image URL (prefer high-res)
    let imageUrl: string | null = null;
    if (item.image?.imageUrl) {
        imageUrl = item.image.imageUrl;
    } else if (item.thumbnailImages?.[0]?.imageUrl) {
        imageUrl = item.thumbnailImages[0].imageUrl;
    }

    if (!imageUrl) return null;

    // Upgrade to high-res
    imageUrl = imageUrl
        .replace(/s-l\d+\.jpg/i, 's-l1600.jpg')
        .replace(/s-l\d+\.png/i, 's-l1600.png')
        .replace(/s-l\d+\.webp/i, 's-l1600.webp');

    const { year, grader, grade, setName, playerName } = parseCardDetails(item.title);

    return {
        name: item.title,
        price: Math.round(rawPrice),
        category: 'Soccer Cards',
        listing_type: 'sale',
        seller_id: SELLER_ID,
        ebay_id: item.itemId,
        description: `eBay Item ID: ${item.itemId} | Price: $${rawPrice}`,
        image_url: imageUrl,
        year,
        grader,
        grade,
        set_name: setName,
        player_name: playerName,
        metadata: {
            sport: 'soccer',
            original_price_usd: rawPrice,
            source_category: categoryName,
            condition: item.condition,
            ebay_url: item.itemWebUrl,
            crawled_at: new Date().toISOString()
        }
    };
}

// ========================================
// Database Insert (with dedup)
// ========================================
async function insertCards(cards: CrawledCard[]): Promise<number> {
    if (cards.length === 0) return 0;

    console.log(`💾 Inserting ${cards.length} cards into database...`);

    // Check for existing cards by ebay_id
    const ebayIds = cards.map(c => c.ebay_id);
    const { data: existingCards } = await supabase
        .from('crawled_cards')
        .select('ebay_id')
        .in('ebay_id', ebayIds);

    const existingIds = new Set(existingCards?.map(c => c.ebay_id) || []);
    const newCards = cards.filter(c => !existingIds.has(c.ebay_id));

    if (newCards.length === 0) {
        console.log('   ℹ️  All cards already exist in database');
        return 0;
    }

    // Insert in batches of 50 to avoid payload limits
    let totalInserted = 0;
    for (let i = 0; i < newCards.length; i += 50) {
        const batch = newCards.slice(i, i + 50);
        const { error } = await supabase
            .from('crawled_cards')
            .insert(batch);

        if (error) {
            console.error(`   ❌ Insert error (batch ${i}): ${error.message}`);
        } else {
            totalInserted += batch.length;
        }
    }

    console.log(`   ✅ Inserted ${totalInserted} new cards`);
    return totalInserted;
}

// ========================================
// MAIN
// ========================================
async function main() {
    console.log('🚀 Starting Soccer Card Crawler (eBay Browse API)...\n');

    try {
        const token = await getEbayToken();
        let totalInserted = 0;

        for (const set of SOCCER_SETS) {
            console.log(`\n🏆 ${set.name}`);

            const items = await searchEbayAPI(token, set.query, set.minPrice);

            const cards = items
                .map(item => formatCard(item, set.name))
                .filter((card): card is CrawledCard => card !== null);

            console.log(`   Formatted ${cards.length} valid cards`);

            const inserted = await insertCards(cards);
            totalInserted += inserted;

            // Rate limiting - 500ms between API calls
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`\n🎉 Complete! Total new cards inserted: ${totalInserted}`);

    } catch (error) {
        console.error('❌ Crawler error:', error);
        process.exit(1);
    }
}

main();
