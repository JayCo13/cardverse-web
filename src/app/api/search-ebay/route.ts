import { NextRequest, NextResponse } from 'next/server';

const EBAY_APP_ID = process.env.EBAY_APP_ID || '';
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || '';

// OAuth token cache (tokens last 2 hours, we refresh at 1h55m)
let cachedToken: { token: string; expiresAt: number } | null = null;
const TOKEN_REFRESH_BUFFER = 5 * 60 * 1000; // 5 minutes before expiry

// Simple in-memory cache with 5-minute TTL for search results
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Clean old cache entries periodically (prevents memory leak)
function cleanCache() {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
            cache.delete(key);
        }
    }
}

async function getEbayToken(): Promise<string> {
    // Return cached token if still valid
    if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_BUFFER) {
        return cachedToken.token;
    }

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
        throw new Error('Failed to get eBay token');
    }

    // Cache the token (eBay tokens last 2 hours = 7200 seconds)
    const expiresIn = (data.expires_in || 7200) * 1000;
    cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + expiresIn
    };

    return data.access_token;
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const limit = searchParams.get('limit') || '20';

    if (!query) {
        return NextResponse.json({ error: 'Query parameter q is required' }, { status: 400 });
    }

    if (!EBAY_APP_ID || !EBAY_CLIENT_SECRET) {
        return NextResponse.json({ error: 'eBay credentials not configured' }, { status: 500 });
    }

    // Check cache first
    const cacheKey = `${query}-${limit}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return NextResponse.json(cached.data, {
            headers: {
                'X-Cache': 'HIT',
                'Cache-Control': 'public, max-age=300' // Browser can cache for 5 min
            }
        });
    }

    // Clean old cache entries
    cleanCache();

    try {
        const token = await getEbayToken();

        // Enhanced negative keywords to exclude bulk/non-single-card items
        const enhancedQuery = `${query} -(box,case,sealed,lot,bulk,break,random,mystery,repack,hobby)`;

        const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
        searchUrl.searchParams.append('q', enhancedQuery);
        searchUrl.searchParams.append('limit', limit);

        // Filter to Sports Trading Cards category for better accuracy
        searchUrl.searchParams.append('category_ids', '212');

        // Request only essential fields for faster response
        searchUrl.searchParams.append('fieldgroups', 'MATCHING_ITEMS');

        // Sort by price (lowest first for buyers)
        searchUrl.searchParams.append('sort', 'price');

        // Filter to Buy It Now only (excludes auctions for predictable pricing)
        searchUrl.searchParams.append('filter', 'buyingOptions:{FIXED_PRICE}');

        const response = await fetch(searchUrl.toString(), {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
            }
        });

        const data = await response.json();

        if (data.errors) {
            return NextResponse.json({ error: data.errors[0]?.message || 'eBay API error' }, { status: 500 });
        }

        const result = {
            items: data.itemSummaries || [],
            total: data.total || 0
        };

        // Store in cache
        cache.set(cacheKey, { data: result, timestamp: Date.now() });

        return NextResponse.json(result, {
            headers: {
                'X-Cache': 'MISS',
                'Cache-Control': 'public, max-age=300'
            }
        });

    } catch (error) {
        console.error('eBay search error:', error);
        return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }
}
