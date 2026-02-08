#!/usr/bin/env npx ts-node
/**
 * Soccer Card Crawler - TOPPS FLAGSHIP 2025-26 (UCC)
 * Targets: Topps UEFA Club Competitions 2025-26 Paper Set
 * Released: Jan 15, 2026
 * * Usage: npx ts-node scripts/crawl-topps-flagship.ts
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const EBAY_APP_ID = process.env.EBAY_APP_ID || '';
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || '';
const SELLER_ID = process.env.SELLER_ID || 'bbf79ca5-b980-4fdd-85a6-31cac47db0c4';

// Search Settings
const ITEMS_PER_PAGE = 200; // eBay API Limit
const PAGES_TO_CRAWL = 3;   // 3 Pages = 600 items per category
const CONCURRENT_BATCH_SIZE = 50;

if (!SUPABASE_URL || !SUPABASE_KEY || !EBAY_APP_ID || !EBAY_CLIENT_SECRET) {
    console.error('❌ Missing API credentials');
    process.exit(1);
}

// Strict exclusion string
const EXCLUDE_QUERY = '-lot -set -pack -box -case -break -picking -choose -digital -code -online';

// ========================================
// TARGET: TOPPS UCC FLAGSHIP 2025-26
// ========================================
const FLAGSHIP_SETS = [
    // --- 1. CORE SEARCHES ---
    {
        name: 'Topps UCC 2025-26 Base',
        query: `topps uefa club competitions 2025 2026 card ${EXCLUDE_QUERY}`,
        minPrice: 1.50
    },
    {
        name: 'Topps UCC 2025-26 Refractor/Foil',
        query: `topps uefa club competitions 2025 2026 (refractor,foil,prizm) ${EXCLUDE_QUERY}`,
        minPrice: 3
    },

    // --- 2. EXCLUSIVE FLAGSHIP PARALLELS ---
    {
        name: 'Topps UCC FlowFractor (Hobby)',
        query: `topps uefa club competitions 2025 flowfractor ${EXCLUDE_QUERY}`,
        minPrice: 5
    },
    {
        name: 'Topps UCC Raindrop',
        query: `topps uefa club competitions 2025 raindrop ${EXCLUDE_QUERY}`,
        minPrice: 3
    },
    {
        name: 'Topps UCC Inferno/Holo (Retail)',
        query: `topps uefa club competitions 2025 (inferno,holo) ${EXCLUDE_QUERY}`,
        minPrice: 3
    },

    // --- 3. KEY INSERTS & AUTOS ---
    {
        name: 'Topps UCC 1955 Retro Auto',
        query: `topps uefa club competitions 2025 1955 auto ${EXCLUDE_QUERY}`,
        minPrice: 25
    },
    {
        name: 'Topps UCC Marks of Excellence',
        query: `topps uefa club competitions 2025 marks of excellence ${EXCLUDE_QUERY}`,
        minPrice: 30
    },
    {
        name: 'Topps UCC 8-Bit / Murals',
        query: `topps uefa club competitions 2025 (8-bit,mural,home pitch) ${EXCLUDE_QUERY}`,
        minPrice: 5
    },

    // --- 4. TOP ROOKIE CHASES (The big 3 for 2026) ---
    {
        name: 'Lamine Yamal Flagship',
        query: `lamine yamal topps uefa 2025 2026 ${EXCLUDE_QUERY}`,
        minPrice: 15
    },
    {
        name: 'Endrick Flagship',
        query: `endrick topps uefa 2025 2026 ${EXCLUDE_QUERY}`,
        minPrice: 15
    },
    {
        name: 'Estevao Willian Flagship',
        query: `estevao willian topps uefa 2025 2026 ${EXCLUDE_QUERY}`,
        minPrice: 10
    },
];

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface EbayItem {
    itemId: string;
    title: string;
    price?: { value: string; currency: string };
    image?: { imageUrl: string };
    thumbnailImages?: Array<{ imageUrl: string }>;
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
    const authBasic = Buffer.from(`${EBAY_APP_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
    const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${authBasic}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });
    if (!response.ok) throw new Error('Failed to get eBay token');
    const data = await response.json();
    return data.access_token;
}

async function searchEbay(token: string, query: string, minPrice: number, offset: number = 0): Promise<EbayItem[]> {
    const encodedQuery = encodeURIComponent(query);
    // Sort by Newly Listed to catch the freshest flagship drops
    const filter = `&filter=price:[${minPrice}..]&filter=buyingOptions:{FIXED_PRICE|AUCTION}&sort=newlyListed`;
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodedQuery}&limit=${ITEMS_PER_PAGE}&offset=${offset}${filter}`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (!response.ok) return [];
        const data = await response.json();
        return data.itemSummaries || [];
    } catch (e) {
        console.error('API Error:', e);
        return [];
    }
}

/**
 * Filter checks for lots/sets AND validates 2025-26 context
 */
function isValidFlagshipCard(title: string): boolean {
    const t = title.toLowerCase();

    // 1. Exclude Lots/Bulk
    const forbidden = [
        'pack', 'box', 'lot', 'set', 'collection', 'bundle', 'bulk', 'break',
        'case', 'sealed', 'repack', 'mystery', 'sticker', 'album', 'empty',
        'pick', 'choose', 'choice', 'variation', 'digital', 'code', 'online'
    ];
    if (forbidden.some(word => t.includes(word))) return false;

    // Quantity Check
    if (/\b\d+\s?cards?\b/.test(t)) return false;
    if (/\b\d+x\b/.test(t)) return false;
    if (/x\d+\b/.test(t)) return false;

    // 2. Ensure it's actually 2025/2026
    // (We want to avoid accidental 2024 hits if eBay search gets fuzzy)
    if (!t.includes('2025') && !t.includes('2026') && !t.includes('25-26') && !t.includes('25/26')) {
        return false;
    }

    return true;
}

function parseCardDetails(title: string): { year: string | null; grader: string | null; grade: string | null; setName: string | null; playerName: string | null } {
    // Force 2025-26 context
    const year = "2025-26";

    const graderMatch = title.match(/\b(PSA|BGS|SGC|CGC|TAG|ACE)\b/i);
    const grader = graderMatch ? graderMatch[0].toUpperCase() : null;

    let grade: string | null = null;
    if (grader) {
        const gradeRegex = new RegExp(`${grader}\\s?(\\d{1,2}(\\.\\d)?)`, 'i');
        const gradeMatch = title.match(gradeRegex);
        if (gradeMatch) grade = gradeMatch[1];
    }

    // Identify Specific Flagship Subsets
    let setName = "Topps UEFA Club Competitions 2025-26";
    if (title.toLowerCase().includes('chrome')) setName = "Topps Chrome UCC 2025-26 (Preview)";
    if (title.toLowerCase().includes('1955')) setName = "Topps UCC 2025-26 (1955 Insert)";
    if (title.toLowerCase().includes('sapphire')) setName = "Topps Chrome Sapphire UCC 2025-26";

    const playerPatterns = [
        /\b(Yamal|Lamine)\b/i, /\b(Endrick)\b/i, /\b(Estevao|Willian)\b/i,
        /\b(Guler|Arda)\b/i, /\b(Mainoo)\b/i, /\b(Bellingham)\b/i,
        /\b(Haaland)\b/i, /\b(Mbappe)\b/i, /\b(Wirtz)\b/i, /\b(Musiala)\b/i
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

    if (!isValidFlagshipCard(item.title)) return null;

    const rawPrice = item.price ? parseFloat(item.price.value) : 0;
    if (rawPrice <= 0) return null;

    let imageUrl: string | null = null;
    if (item.image?.imageUrl) imageUrl = item.image.imageUrl;
    else if (item.thumbnailImages?.[0]?.imageUrl) imageUrl = item.thumbnailImages[0].imageUrl;

    if (!imageUrl) return null;
    imageUrl = imageUrl.replace(/s-l\d+\.jpg/i, 's-l1600.jpg').replace(/s-l\d+\.png/i, 's-l1600.png');

    const { year, grader, grade, setName, playerName } = parseCardDetails(item.title);

    return {
        name: item.title,
        price: Math.round(rawPrice),
        category: 'Soccer Cards',
        listing_type: 'sale',
        seller_id: SELLER_ID,
        ebay_id: item.itemId,
        description: `eBay: ${item.itemId} | Price: $${rawPrice} | Set: ${setName}`,
        image_url: imageUrl,
        year,
        grader,
        grade,
        set_name: setName,
        player_name: playerName,
        metadata: {
            ...item,
            sport: 'soccer',
            season: '2025-26',
            set_type: 'flagship',
            source_category: category,
            original_price_usd: rawPrice,
            crawled_at: new Date().toISOString()
        }
    };
}

async function insertCards(cards: CrawledCard[]): Promise<number> {
    if (cards.length === 0) return 0;

    const ebayIds = cards.map(c => c.ebay_id);
    const { data: existing } = await supabase
        .from('crawled_cards')
        .select('ebay_id')
        .in('ebay_id', ebayIds);

    const existingIds = new Set(existing?.map(c => c.ebay_id) || []);
    const newCards = cards.filter(c => !existingIds.has(c.ebay_id));

    if (newCards.length === 0) return 0;

    const { error } = await supabase.from('crawled_cards').insert(newCards);
    if (error) {
        console.error('   ❌ DB Error:', error.message);
        return 0;
    }
    return newCards.length;
}

async function main() {
    console.log('🚀 Starting TOPPS FLAGSHIP (UCC 2025-26) Crawler...\n');
    console.log('📅 Release: Jan 15, 2026 | Focus: Paper, FlowFractor, Raindrop, 1955 Auto');

    try {
        const token = await getEbayToken();
        let totalInserted = 0;

        for (const set of FLAGSHIP_SETS) {
            console.log(`\n🏷️  Processing: ${set.name}`);
            let setInserted = 0;

            // Fetch multiple pages deep
            for (let page = 0; page < PAGES_TO_CRAWL; page++) {
                const offset = page * ITEMS_PER_PAGE;
                process.stdout.write(`   ↳ Page ${page + 1} (Offset ${offset})... `);

                const items = await searchEbay(token, set.query, set.minPrice, offset);

                if (items.length === 0) {
                    console.log('No more items.');
                    break;
                }

                const validCards = items
                    .map(item => formatCard(item, set.name))
                    .filter((card): card is CrawledCard => card !== null);

                const count = await insertCards(validCards);
                setInserted += count;
                totalInserted += count;

                console.log(`Found ${items.length}, Saved ${count} new.`);

                // Rate limit niceness
                await new Promise(r => setTimeout(r, 600));
            }
            console.log(`   ✅ Total for ${set.name}: ${setInserted} cards`);
        }

        console.log(`\n🎉 Flagship Crawl Complete! Total new cards: ${totalInserted}`);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

main();