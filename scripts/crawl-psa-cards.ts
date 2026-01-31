/**
 * PSA Graded Cards Crawler
 * 
 * Crawls eBay for PSA graded Pokemon and One Piece cards
 * and stores them in the crawled_cards table.
 * 
 * Usage: npx tsx scripts/crawl-psa-cards.ts
 * 
 * Requires environment variables:
 * - EBAY_APP_ID
 * - EBAY_CLIENT_SECRET
 * - NEXT_PUBLIC_SUPABASE_URL
 * - NEXT_PUBLIC_SUPABASE_ANON_KEY
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const EBAY_APP_ID = process.env.EBAY_APP_ID || '';
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || '';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Search queries for PSA graded cards
const SEARCH_QUERIES = [
    // Pokemon
    { query: 'PSA 10 Pokemon', category: 'pokemon', limit: 50 },
    { query: 'PSA 9 Pokemon', category: 'pokemon', limit: 30 },
    { query: 'BGS 9.5 Pokemon', category: 'pokemon', limit: 20 },
    { query: 'CGC 10 Pokemon', category: 'pokemon', limit: 20 },
    { query: 'PSA 10 Charizard', category: 'pokemon', limit: 30 },
    { query: 'PSA 10 Pikachu', category: 'pokemon', limit: 20 },
    // One Piece
    { query: 'PSA 10 One Piece TCG', category: 'onepiece', limit: 50 },
    { query: 'PSA 9 One Piece TCG', category: 'onepiece', limit: 30 },
    { query: 'BGS 9.5 One Piece', category: 'onepiece', limit: 20 },
    { query: 'PSA 10 Luffy', category: 'onepiece', limit: 30 },
];

interface EbayItem {
    itemId: string;
    title: string;
    price?: { value: string; currency: string };
    image?: { imageUrl: string };
    thumbnailImages?: { imageUrl: string }[];
    itemWebUrl?: string;
    condition?: string;
}

interface CrawledCard {
    name: string;
    image_url: string | null;
    category: string;
    listing_type: string;
    price: number;
    ebay_id: string;
    set_name: string | null;
    year: string | null;
    card_number: string | null;
    grader: string | null;
    grade: string | null;
    player_name: string | null;
    raw_data: object;
}

// Parse grading info from title
function parseGradingInfo(title: string): { grader: string | null; grade: string | null } {
    const patterns = [
        /\b(PSA)\s*(\d+(?:\.\d+)?)/i,
        /\b(BGS)\s*(\d+(?:\.\d+)?)/i,
        /\b(CGC)\s*(\d+(?:\.\d+)?)/i,
        /\b(SGC)\s*(\d+(?:\.\d+)?)/i,
    ];

    for (const pattern of patterns) {
        const match = title.match(pattern);
        if (match) {
            return { grader: match[1].toUpperCase(), grade: match[2] };
        }
    }
    return { grader: null, grade: null };
}

// Parse card number from title (e.g., "223/191", "#025", "SV049")
function parseCardNumber(title: string): string | null {
    const patterns = [
        /\b(\d{1,3}\/\d{1,3})\b/,  // 223/191
        /#(\d+)/,                   // #025
        /\b(SV\d+)\b/i,            // SV049
        /\b([A-Z]{1,3}\d+)\b/,     // OP01-001
    ];

    for (const pattern of patterns) {
        const match = title.match(pattern);
        if (match) {
            return match[1];
        }
    }
    return null;
}

// Parse year from title
function parseYear(title: string): string | null {
    const match = title.match(/\b(19\d{2}|20\d{2})\b/);
    return match ? match[1] : null;
}

// Parse set name from title
function parseSetName(title: string): string | null {
    const patterns = [
        /\b(Surging Sparks|Prismatic Evolutions|Paldean Fates|Obsidian Flames|Scarlet & Violet|Crown Zenith|Silver Tempest|Lost Origin)\b/i,
        /\b(OP-\d+|Romance Dawn|Paramount War|Pillars of Strength|Awakening of the New Era)\b/i,
    ];

    for (const pattern of patterns) {
        const match = title.match(pattern);
        if (match) {
            return match[1];
        }
    }
    return null;
}

async function getEbayToken(): Promise<string> {
    console.log('🔑 Getting eBay OAuth token...');

    const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${Buffer.from(`${EBAY_APP_ID}:${EBAY_CLIENT_SECRET}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });

    const data = await response.json();

    if (!data.access_token) {
        throw new Error(`OAuth failed: ${data.error_description || 'Unknown error'}`);
    }

    console.log('✅ Got eBay token');
    return data.access_token;
}

async function searchEbay(token: string, query: string, limit: number): Promise<EbayItem[]> {
    const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
    searchUrl.searchParams.append('q', query);
    searchUrl.searchParams.append('limit', limit.toString());
    searchUrl.searchParams.append('sort', 'newlyListed');

    const response = await fetch(searchUrl.toString(), {
        headers: {
            'Authorization': `Bearer ${token}`,
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
        }
    });

    const data = await response.json();

    if (data.errors) {
        console.error('eBay API error:', data.errors[0]?.message);
        return [];
    }

    return data.itemSummaries || [];
}

async function saveToSupabase(cards: CrawledCard[]): Promise<number> {
    if (cards.length === 0) return 0;

    const response = await fetch(`${SUPABASE_URL}/rest/v1/crawled_cards?on_conflict=ebay_id`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(cards)
    });

    if (!response.ok) {
        const error = await response.text();
        console.error('Supabase error:', error);
        return 0;
    }

    return cards.length;
}

// Upgrade eBay thumbnail URL to high resolution
function getHighResImageUrl(url: string | undefined | null): string | null {
    if (!url) return null;
    // eBay images often have size suffixes like s-l300, s-l500, s-l1600
    // Replace any size suffix with l1600 for high resolution
    return url.replace(/s-l\d+/, 's-l1600').replace(/\$_\d+/, '$_57');
}

function transformItem(item: EbayItem, category: string): CrawledCard {
    const { grader, grade } = parseGradingInfo(item.title);
    const priceValue = parseFloat(item.price?.value || '0');
    const rawImageUrl = item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null;

    return {
        name: item.title,
        image_url: getHighResImageUrl(rawImageUrl),
        category: category,
        listing_type: 'sale',
        price: Math.round(priceValue * 100), // Store as cents
        ebay_id: item.itemId,
        set_name: parseSetName(item.title),
        year: parseYear(item.title),
        card_number: parseCardNumber(item.title),
        grader: grader,
        grade: grade,
        player_name: null, // Could be parsed for specific cards
        raw_data: { ebay_url: item.itemWebUrl, condition: item.condition }
    };
}

async function main() {
    console.log('🚀 PSA Graded Cards Crawler');
    console.log('===========================\n');

    // Check configuration
    if (!EBAY_APP_ID || !EBAY_CLIENT_SECRET) {
        console.error('❌ Missing EBAY_APP_ID or EBAY_CLIENT_SECRET');
        console.log('Add them to your .env.local file');
        process.exit(1);
    }

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.error('❌ Missing Supabase configuration');
        process.exit(1);
    }

    try {
        const token = await getEbayToken();
        let totalSaved = 0;

        for (const searchConfig of SEARCH_QUERIES) {
            console.log(`\n🔍 Searching: "${searchConfig.query}"...`);

            const items = await searchEbay(token, searchConfig.query, searchConfig.limit);
            console.log(`   Found ${items.length} items`);

            // Filter items that have grading info
            const gradedItems = items.filter(item => {
                const { grader, grade } = parseGradingInfo(item.title);
                return grader && grade;
            });
            console.log(`   ${gradedItems.length} with valid grading info`);

            if (gradedItems.length > 0) {
                const cards = gradedItems.map(item => transformItem(item, searchConfig.category));
                const saved = await saveToSupabase(cards);
                totalSaved += saved;
                console.log(`   ✅ Saved ${saved} cards`);
            }

            // Rate limiting - wait between requests
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`\n===========================`);
        console.log(`✅ Done! Saved ${totalSaved} PSA graded cards`);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

main();
