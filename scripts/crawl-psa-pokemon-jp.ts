/**
 * PSA Pokemon Japanese Cards Crawler (Set-Based)
 * 
 * Crawls eBay for PSA graded Pokemon Japanese cards by set.
 * Gets top 10 most expensive cards per set and searches for PSA 10, 9, 8.
 * Uses card number for precise matching.
 * 
 * Usage: npx tsx scripts/crawl-psa-pokemon-jp.ts [--sets=10] [--cards-per-set=10] [--max-api-calls=500]
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

// CLI arguments
const args = process.argv.slice(2);
const getArg = (name: string, defaultVal: number) => {
    const arg = args.find(a => a.startsWith(`--${name}=`));
    return arg ? parseInt(arg.split('=')[1]) : defaultVal;
};

const MAX_SETS = getArg('sets', 10);
const CARDS_PER_SET = getArg('cards-per-set', 10);
const SKIP_SETS = getArg('skip-sets', 0); // Skip first N sets (for resume)
const MAX_API_CALLS = getArg('max-api-calls', 500); // Safety limit for eBay API calls

// Global API call counter
let apiCallCount = 0;

// Category ID for Japanese Pokemon
const CATEGORY_ID = 85;

// PSA grades to crawl
const PSA_GRADES = ['10', '9', '8'];

interface PokemonSet {
    group_id: number;
    name: string;
}

interface TargetCard {
    product_id: number;
    name: string;
    set_name: string;
    number: string | null;
    market_price: number;
}

interface EbayItem {
    itemId: string;
    title: string;
    price?: { value: string; currency: string };
    image?: { imageUrl: string };
    thumbnailImages?: { imageUrl: string }[];
    itemWebUrl?: string;
    condition?: string;
}

interface PsaPrice {
    product_id: number;
    ebay_id: string;
    name: string;
    image_url: string | null;
    grader: string;
    grade: string;
    price: number;
    ebay_url: string | null;
    raw_data: object;
}

// Parse grading info from title - ONLY accept PSA
function parseGradingInfo(title: string): { grader: string | null; grade: string | null } {
    const upperTitle = title.toUpperCase();

    // Reject if title contains other TCG keywords (not Pokemon)
    const excludeKeywords = ['YUGIOH', 'YU-GI-OH', 'MAGIC', 'MTG', 'DIGIMON', 'DRAGON BALL', 'ONE PIECE'];
    if (excludeKeywords.some(kw => upperTitle.includes(kw))) {
        return { grader: null, grade: null };
    }

    // Only match PSA grades
    const match = title.match(/\bPSA\s*(\d+(?:\.\d+)?)\b/i);
    if (match) {
        return { grader: 'PSA', grade: match[1] };
    }
    return { grader: null, grade: null };
}

// Upgrade eBay thumbnail URL to high resolution
function getHighResImageUrl(url: string | undefined | null): string | null {
    if (!url) return null;
    return url.replace(/s-l\d+/, 's-l1600').replace(/\$_\d+/, '$_57');
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

async function fetchSets(): Promise<PokemonSet[]> {
    console.log(`📚 Fetching Pokemon Japanese sets (limit ${MAX_SETS})...`);

    // Get distinct sets from tcgcsv_groups for Japanese Pokemon category
    const url = `${SUPABASE_URL}/rest/v1/tcgcsv_groups?` +
        `category_id=eq.${CATEGORY_ID}&` +
        `order=group_id.desc&` +
        `limit=${MAX_SETS}&` +
        `select=group_id,name`;

    const response = await fetch(url, {
        headers: { 'apikey': SUPABASE_KEY }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch sets: ${await response.text()}`);
    }

    const data = await response.json();
    console.log(`   Found ${data.length} sets`);
    return data;
}

async function fetchTopCardsForSet(groupId: number, setName: string): Promise<TargetCard[]> {
    // Get top cards by market price for this set
    const url = `${SUPABASE_URL}/rest/v1/tcgcsv_products?` +
        `group_id=eq.${groupId}&` +
        `market_price=not.is.null&` +
        `order=market_price.desc&` +
        `limit=${CARDS_PER_SET}&` +
        `select=product_id,name,number,market_price`;

    const response = await fetch(url, {
        headers: { 'apikey': SUPABASE_KEY }
    });

    if (!response.ok) {
        console.error(`   ⚠️ Failed to fetch cards for set ${setName}`);
        return [];
    }

    const data = await response.json();
    return data.map((c: { product_id: number; name: string; number: string | null; market_price: number }) => ({
        ...c,
        set_name: setName
    }));
}

function hasReachedApiLimit(): boolean {
    if (apiCallCount >= MAX_API_CALLS) {
        return true;
    }
    return false;
}

async function searchEbay(token: string, query: string, retries = 3): Promise<EbayItem[]> {
    // Safety check: stop before hitting quota
    if (hasReachedApiLimit()) {
        console.warn(`   🛑 API call limit reached (${apiCallCount}/${MAX_API_CALLS}). Skipping search.`);
        return [];
    }

    const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
    searchUrl.searchParams.append('q', query);
    searchUrl.searchParams.append('limit', '5');
    searchUrl.searchParams.append('sort', 'price');
    searchUrl.searchParams.append('category_ids', '183454'); // Trading cards

    for (let attempt = 0; attempt <= retries; attempt++) {
        apiCallCount++;
        const response = await fetch(searchUrl.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
            }
        });

        // Handle rate limiting with exponential backoff
        if (response.status === 429) {
            const backoffMs = Math.min(5000 * Math.pow(2, attempt), 60000); // 5s, 10s, 20s, max 60s
            console.warn(`   ⏳ Rate limited. Retrying in ${backoffMs / 1000}s... (attempt ${attempt + 1}/${retries})`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue;
        }

        const data = await response.json();

        if (data.errors) {
            const msg = data.errors[0]?.message || 'Unknown error';
            if (msg.includes('Too many requests') && attempt < retries) {
                const backoffMs = Math.min(5000 * Math.pow(2, attempt), 60000);
                console.warn(`   ⏳ Rate limited (body). Retrying in ${backoffMs / 1000}s... (attempt ${attempt + 1}/${retries})`);
                await new Promise(resolve => setTimeout(resolve, backoffMs));
                continue;
            }
            console.error('   eBay API error:', msg);
            return [];
        }

        return data.itemSummaries || [];
    }

    console.error('   ❌ Max retries exceeded for query:', query.slice(0, 60));
    return [];
}

async function saveToSupabase(prices: PsaPrice[], retries = 3): Promise<number> {
    if (prices.length === 0) return 0;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/pokemon_psa_prices?on_conflict=ebay_id`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates'
                },
                body: JSON.stringify(prices)
            });

            if (!response.ok) {
                const error = await response.text();
                console.error(`      ⚠️ Supabase error (attempt ${attempt}):`, error);
                if (attempt < retries) {
                    await new Promise(r => setTimeout(r, 1000 * attempt));
                    continue;
                }
                return 0;
            }

            return prices.length;
        } catch (err) {
            console.error(`      ⚠️ Network error (attempt ${attempt}):`, (err as Error).message);
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1000 * attempt));
                continue;
            }
            return 0;
        }
    }
    return 0;
}

function transformItem(item: EbayItem, card: TargetCard, targetGrade: string): PsaPrice | null {
    const { grader, grade } = parseGradingInfo(item.title);
    if (!grader || grade !== targetGrade) return null;

    const priceValue = parseFloat(item.price?.value || '0');
    const rawImageUrl = item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null;

    return {
        product_id: card.product_id,
        ebay_id: item.itemId,
        name: item.title,
        image_url: getHighResImageUrl(rawImageUrl),
        grader: grader,
        grade: grade,
        price: Math.round(priceValue * 100),
        ebay_url: item.itemWebUrl || null,
        raw_data: {
            condition: item.condition,
            source_market_price: card.market_price,
            set_name: card.set_name,
            card_number: card.number
        }
    };
}

function buildSearchQuery(card: TargetCard, grade: string): string {
    // Clean card name - remove special chars and extra whitespace
    const cleanName = card.name
        .replace(/[^\w\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Take first 3 words of name for flexibility
    const nameParts = cleanName.split(' ').slice(0, 3).join(' ');

    // Include card number if available
    const cardNum = card.number ? card.number.replace('/', ' ') : '';

    // Simple query with Japanese keyword
    return `PSA ${grade} ${nameParts} ${cardNum} pokemon japanese`.trim();
}

async function main() {
    console.log('🚀 PSA Pokemon Japanese Cards Crawler (Set-Based)');
    console.log('==================================================');
    console.log(`   Max API calls: ${MAX_API_CALLS}\n`);

    if (!EBAY_APP_ID || !EBAY_CLIENT_SECRET) {
        console.error('❌ Missing EBAY_APP_ID or EBAY_CLIENT_SECRET');
        process.exit(1);
    }

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.error('❌ Missing Supabase configuration');
        process.exit(1);
    }

    try {
        // Step 1: Get all sets
        const sets = await fetchSets();

        if (sets.length === 0) {
            console.log('⚠️ No sets found');
            process.exit(0);
        }

        const token = await getEbayToken();
        let totalSaved = 0;
        let setsProcessed = 0;

        // Step 2: Process each set
        for (const set of sets) {
            setsProcessed++;

            // Skip sets if resuming
            if (setsProcessed <= SKIP_SETS) {
                console.log(`⏭️ [Set ${setsProcessed}/${sets.length}] Skipping ${set.name}`);
                continue;
            }

            console.log(`\n📦 [Set ${setsProcessed}/${sets.length}] ${set.name}`);

            // Get top cards for this set
            const cards = await fetchTopCardsForSet(set.group_id, set.name);

            if (cards.length === 0) {
                console.log('   ⚠️ No cards found in set');
                continue;
            }

            console.log(`   Found ${cards.length} top cards`);

            // Step 3: Process each card in the set
            for (const card of cards) {
                // Check API limit before processing card
                if (hasReachedApiLimit()) {
                    console.warn(`\n🛑 Stopping: API call limit reached (${apiCallCount}/${MAX_API_CALLS})`);
                    console.log(`   Use --max-api-calls=<N> to increase the limit.`);
                    console.log(`   Use --skip-sets=${setsProcessed - 1} to resume from this set.`);
                    break;
                }

                console.log(`   🃏 ${card.name.slice(0, 40)}... #${card.number || 'N/A'} ($${card.market_price}) [API: ${apiCallCount}/${MAX_API_CALLS}]`);

                const allPrices: PsaPrice[] = [];

                // Search for each PSA grade
                for (const grade of PSA_GRADES) {
                    if (hasReachedApiLimit()) break;

                    const query = buildSearchQuery(card, grade);

                    const items = await searchEbay(token, query);

                    const prices = items
                        .map(item => transformItem(item, card, grade))
                        .filter((p): p is PsaPrice => p !== null);

                    if (prices.length > 0) {
                        allPrices.push(...prices);
                    }

                    await new Promise(resolve => setTimeout(resolve, 1500));
                }

                if (allPrices.length > 0) {
                    const saved = await saveToSupabase(allPrices);
                    totalSaved += saved;
                    console.log(`      ✅ PSA 10/9/8: ${saved} listings saved`);
                }

                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            // Break outer set loop too if limit reached
            if (hasReachedApiLimit()) break;
        }

        console.log(`\n==================================================`);
        console.log(`✅ Done! Processed ${setsProcessed} sets, saved ${totalSaved} PSA prices`);
        console.log(`📊 Total eBay API calls used: ${apiCallCount}/${MAX_API_CALLS}`);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

main();
