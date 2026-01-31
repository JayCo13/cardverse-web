#!/usr/bin/env npx ts-node
/**
 * Soccer Card Crawler - SET & YEAR BASED
 * Crawls by card sets and years, includes inserts and numbered cards
 * Excludes packs, boxes, lots, etc.
 * 
 * Usage: npx ts-node scripts/crawl-soccer-sets.ts
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
// SOCCER CARD SETS BY YEAR
// No player names - focus on sets, inserts, numbered cards
// ========================================
const SOCCER_SETS = [
    // ===== 2025 SETS =====
    { name: 'Topps Chrome 2025', query: 'topps chrome soccer 2025 card -pack -box -lot -bundle', minPrice: 5 },
    { name: 'Topps Chrome 2025 Refractor', query: 'topps chrome soccer 2025 refractor -pack -box -lot', minPrice: 10 },
    { name: 'Topps Chrome 2025 Auto', query: 'topps chrome soccer 2025 autograph auto -pack -box', minPrice: 20 },
    { name: 'Topps Chrome 2025 Numbered', query: 'topps chrome soccer 2025 /99 /50 /25 -pack -box', minPrice: 15 },
    { name: 'Topps Finest 2025', query: 'topps finest soccer 2025 card -pack -box -lot', minPrice: 10 },
    { name: 'Topps Finest 2025 Auto', query: 'topps finest soccer 2025 autograph auto -pack -box', minPrice: 25 },
    { name: 'Topps Merlin 2025', query: 'topps merlin soccer 2025 card -pack -box -lot', minPrice: 5 },
    { name: 'Topps UCL 2025', query: 'topps champions league 2025 card -pack -box -lot', minPrice: 5 },
    { name: 'Panini Prizm 2025', query: 'panini prizm soccer 2025 card -pack -box -lot -bundle', minPrice: 5 },
    { name: 'Panini Prizm 2025 Silver', query: 'panini prizm soccer 2025 silver -pack -box -lot', minPrice: 10 },
    { name: 'Panini Prizm 2025 Color', query: 'panini prizm soccer 2025 gold red green blue -pack -box', minPrice: 20 },
    { name: 'Panini Prizm 2025 Auto', query: 'panini prizm soccer 2025 autograph auto -pack -box', minPrice: 25 },
    { name: 'Panini Select 2025', query: 'panini select soccer 2025 card -pack -box -lot', minPrice: 5 },
    { name: 'Panini Mosaic 2025', query: 'panini mosaic soccer 2025 card -pack -box -lot', minPrice: 5 },

    // ===== 2024 SETS =====
    { name: 'Topps Chrome 2024', query: 'topps chrome soccer 2024 card -pack -box -lot -bundle', minPrice: 3 },
    { name: 'Topps Chrome 2024 Refractor', query: 'topps chrome soccer 2024 refractor -pack -box -lot', minPrice: 8 },
    { name: 'Topps Chrome 2024 Auto', query: 'topps chrome soccer 2024 autograph auto -pack -box', minPrice: 15 },
    { name: 'Topps Chrome 2024 Insert', query: 'topps chrome soccer 2024 insert -pack -box -lot', minPrice: 5 },
    { name: 'Topps Finest 2024', query: 'topps finest soccer 2024 card -pack -box -lot', minPrice: 5 },
    { name: 'Topps Finest 2024 Auto', query: 'topps finest soccer 2024 autograph auto -pack -box', minPrice: 20 },
    { name: 'Topps UCL 2024', query: 'topps champions league 2024 card -pack -box -lot', minPrice: 3 },
    { name: 'Topps UCL 2024 Insert', query: 'topps champions league 2024 insert -pack -box', minPrice: 5 },
    { name: 'Topps Stadium Club 2024', query: 'topps stadium club soccer 2024 -pack -box -lot', minPrice: 3 },
    { name: 'Panini Prizm 2024', query: 'panini prizm soccer 2024 card -pack -box -lot -bundle', minPrice: 3 },
    { name: 'Panini Prizm 2024 Silver', query: 'panini prizm soccer 2024 silver prizm -pack -box', minPrice: 8 },
    { name: 'Panini Prizm 2024 Color', query: 'panini prizm soccer 2024 gold red blue green -pack -box', minPrice: 15 },
    { name: 'Panini Prizm 2024 Numbered', query: 'panini prizm soccer 2024 /99 /75 /50 /25 -pack -box', minPrice: 15 },
    { name: 'Panini Prizm 2024 Auto', query: 'panini prizm soccer 2024 autograph auto -pack -box', minPrice: 20 },
    { name: 'Panini Select 2024', query: 'panini select soccer 2024 card -pack -box -lot', minPrice: 3 },
    { name: 'Panini Mosaic 2024', query: 'panini mosaic soccer 2024 card -pack -box -lot', minPrice: 3 },
    { name: 'Panini Donruss 2024', query: 'panini donruss soccer 2024 card -pack -box -lot', minPrice: 2 },
    { name: 'Panini Obsidian 2024', query: 'panini obsidian soccer 2024 card -pack -box -lot', minPrice: 5 },

    // ===== INSERTS & SPECIAL CARDS =====
    { name: 'Soccer Insert Cards 2024', query: 'soccer card 2024 insert -pack -box -lot -bundle', minPrice: 5 },
    { name: 'Soccer Insert Cards 2025', query: 'soccer card 2025 insert -pack -box -lot -bundle', minPrice: 5 },
    { name: 'Soccer Numbered Cards 2024', query: 'soccer card 2024 numbered /99 /50 -pack -box -lot', minPrice: 10 },
    { name: 'Soccer Numbered Cards 2025', query: 'soccer card 2025 numbered /99 /50 -pack -box -lot', minPrice: 10 },
    { name: 'Soccer Rookie Cards 2024', query: 'soccer card 2024 rookie RC -pack -box -lot -bundle', minPrice: 3 },
    { name: 'Soccer Rookie Cards 2025', query: 'soccer card 2025 rookie RC -pack -box -lot -bundle', minPrice: 5 },

    // ===== EURO 2024 =====
    { name: 'Euro 2024 Cards', query: 'euro 2024 soccer card -pack -box -lot -sticker -bundle', minPrice: 3 },
    { name: 'Euro 2024 Auto', query: 'euro 2024 autograph auto card -pack -box -lot', minPrice: 15 },
    { name: 'Euro 2024 Insert', query: 'euro 2024 insert card -pack -box -lot -sticker', minPrice: 5 },

    // ===== PREMIER LEAGUE =====
    { name: 'Premier League 2024-25', query: 'premier league card 2024 2025 -pack -box -lot -sticker', minPrice: 3 },
    { name: 'Premier League Auto 2024', query: 'premier league autograph auto card 2024 -pack -box', minPrice: 15 },
];

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface EbayItem {
    itemId: string;
    title: string;
    price?: { value: string; currency: string };
    image?: { imageUrl: string };
    thumbnailImages?: Array<{ imageUrl: string }>;
    condition?: string;
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
        throw new Error(`Failed to get eBay token: ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ Got eBay access token');
    return data.access_token;
}

async function searchEbay(token: string, query: string, minPrice: number): Promise<EbayItem[]> {
    const encodedQuery = encodeURIComponent(query);
    const filter = `&filter=price:[${minPrice}..]&filter=buyingOptions:{FIXED_PRICE|AUCTION}`;
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodedQuery}&limit=50${filter}`;

    console.log(`🔍 Searching: ${query.substring(0, 55)}...`);

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        console.error(`❌ Search failed: ${response.status}`);
        return [];
    }

    const data = await response.json();
    return data.itemSummaries || [];
}

function parseCardDetails(title: string): { year: string | null; grader: string | null; grade: string | null; setName: string | null; playerName: string | null } {
    const yearMatch = title.match(/\b(202[4-9]|203\d)\b/);
    const year = yearMatch ? yearMatch[0] : null;

    const graderMatch = title.match(/\b(PSA|BGS|SGC|CGC|TAG|ACE)\b/i);
    const grader = graderMatch ? graderMatch[0].toUpperCase() : null;

    let grade: string | null = null;
    if (grader) {
        const gradeRegex = new RegExp(`${grader}\\s?(\\d{1,2}(\\.\\d)?)`, 'i');
        const gradeMatch = title.match(gradeRegex);
        if (gradeMatch) grade = gradeMatch[1];
    }

    const setMatch = title.match(/\b(Prizm|Chrome|Finest|Optic|Select|Mosaic|Donruss|Bowman|Topps|Panini|Stadium Club|Obsidian|Merlin)\b/i);
    const setName = setMatch ? setMatch[0] : null;

    // Extract player name if present
    const playerPatterns = [
        /\b(Mbappe|Mbappé|Haaland|Bellingham|Yamal|Mainoo|Wirtz|Musiala)\b/i,
        /\b(Messi|Ronaldo|Neymar)\b/i,
        /\b(Salah|Saka|Palmer|Foden|Rice|Fernandes|Kane)\b/i,
        /\b(Vinicius|Pedri|Gavi|Lautaro)\b/i,
    ];
    let playerName: string | null = null;
    for (const pattern of playerPatterns) {
        const match = title.match(pattern);
        if (match) { playerName = match[0]; break; }
    }

    return { year, grader, grade, setName, playerName };
}

function formatCard(item: EbayItem, category: string): CrawledCard | null {
    if (!item.title) return null;

    const title = item.title.toLowerCase();

    // STRICT exclusion of non-single-card items
    const excludePatterns = [
        'mystery', 'pack', 'box', 'lot', 'bundle', 'set of', 'collection',
        'bulk', 'repack', 'break', 'pick your', 'you pick', 'choose',
        'complete set', 'base set', 'hobby', 'blaster', 'mega box', 'mega',
        'hanger', 'cello', 'fat pack', 'value pack', 'multi pack', 'x card',
        'guaranteed', 'random', 'chase', 'hit or miss', 'case', 'sealed',
        // American football exclusions
        'nfl', 'football', 'quarterback', 'touchdown', 'super bowl',
        'patriots', 'cowboys', 'chiefs', 'eagles', 'steelers',
        // Stickers
        'sticker', 'album'
    ];

    for (const pattern of excludePatterns) {
        if (title.includes(pattern)) return null;
    }

    // Must contain "card" or be clearly a single card
    const cardIndicators = ['card', 'auto', 'autograph', 'rookie', 'rc', 'insert', 'refractor', 'prizm', '/99', '/50', '/25', '/10', '/5', '/1'];
    const hasCardIndicator = cardIndicators.some(ind => title.includes(ind));
    if (!hasCardIndicator) return null;

    const rawPrice = item.price ? parseFloat(item.price.value) : 0;
    if (rawPrice <= 0) return null;

    let imageUrl: string | null = null;
    if (item.image?.imageUrl) {
        imageUrl = item.image.imageUrl;
    } else if (item.thumbnailImages?.[0]?.imageUrl) {
        imageUrl = item.thumbnailImages[0].imageUrl;
    }
    if (!imageUrl) return null;

    imageUrl = imageUrl
        .replace(/s-l\d+\.jpg/i, 's-l1600.jpg')
        .replace(/s-l\d+\.png/i, 's-l1600.png');

    const { year, grader, grade, setName, playerName } = parseCardDetails(item.title);

    return {
        name: item.title,
        price: Math.round(rawPrice),
        category: 'Soccer Cards',
        listing_type: 'sale',
        seller_id: SELLER_ID,
        ebay_id: item.itemId,
        description: `eBay: ${item.itemId} | Price: $${rawPrice}`,
        image_url: imageUrl,
        year,
        grader,
        grade,
        set_name: setName,
        player_name: playerName,
        metadata: {
            ...item,
            sport: 'soccer',
            source_category: category,
            original_price_usd: rawPrice,
            crawled_at: new Date().toISOString()
        }
    };
}

async function insertCards(cards: CrawledCard[]): Promise<number> {
    if (cards.length === 0) return 0;

    console.log(`💾 Inserting ${cards.length} cards...`);

    const ebayIds = cards.map(c => c.ebay_id);
    const { data: existing } = await supabase
        .from('crawled_cards')
        .select('ebay_id')
        .in('ebay_id', ebayIds);

    const existingIds = new Set(existing?.map(c => c.ebay_id) || []);
    const newCards = cards.filter(c => !existingIds.has(c.ebay_id));

    if (newCards.length === 0) {
        console.log('ℹ️  All cards already exist');
        return 0;
    }

    const { error } = await supabase.from('crawled_cards').insert(newCards);
    if (error) {
        console.error('❌ Insert error:', error.message);
        return 0;
    }

    console.log(`✅ Inserted ${newCards.length} new cards`);
    return newCards.length;
}

async function main() {
    console.log('🚀 Starting Soccer Set-Based Crawler...\n');
    console.log('📋 Strategy: Sets & Years | Includes: Inserts, Numbered | Excludes: Packs, Boxes\n');

    try {
        const token = await getEbayToken();
        let totalInserted = 0;

        for (const set of SOCCER_SETS) {
            console.log(`\n🏷️  ${set.name}`);

            const items = await searchEbay(token, set.query, set.minPrice);
            console.log(`   Found ${items.length} items`);

            const cards = items
                .map(item => formatCard(item, set.name))
                .filter((card): card is CrawledCard => card !== null);

            console.log(`   Valid cards: ${cards.length}`);

            const inserted = await insertCards(cards);
            totalInserted += inserted;

            await new Promise(resolve => setTimeout(resolve, 800));
        }

        console.log(`\n🎉 Complete! Total new cards: ${totalInserted}`);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

main();
