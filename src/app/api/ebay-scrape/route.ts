import { NextResponse } from 'next/server';

// eBay Production Credentials from environment variables
const EBAY_APP_ID = process.env.EBAY_APP_ID || '';
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || '';

async function getEbayToken() {
    if (!EBAY_APP_ID || !EBAY_CLIENT_SECRET) {
        console.error('eBay credentials not configured');
        return null;
    }

    try {
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
            console.error(`Token Error: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json();
        return data.access_token;
    } catch (error) {
        console.error('Token Fetch Error:', error);
        return null;
    }
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const limit = searchParams.get('limit') || '30';

    if (!query) {
        return NextResponse.json({ error: 'Missing query parameter', items: [] }, { status: 400 });
    }

    try {
        // 1. Get Access Token
        const token = await getEbayToken();
        if (!token) {
            return NextResponse.json({ error: 'Failed to authenticate with eBay' }, { status: 500 });
        }

        // 2. Search eBay Browse API
        // Using "newlyListed" sort to mimic fresh crawlers, or "price" if needed. Default is "Best Match".
        const apiUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=${limit}&filter=buyingOptions:{FIXED_PRICE|AUCTION}`;

        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
            }
        });

        if (!response.ok) {
            const errData = await response.json();
            console.error('eBay API Error:', JSON.stringify(errData));
            return NextResponse.json({ error: 'eBay API search failed', details: errData }, { status: response.status });
        }

        const data = await response.json();
        const apiItems = data.itemSummaries || [];

        // 3. Map to generic format
        const items = apiItems.map((item: any) => ({
            itemId: item.itemId,
            title: item.title,
            price: {
                value: item.price?.value,
                currency: item.price?.currency,
                display: `$${item.price?.value}`
            },
            image: {
                imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || ''
            },
            itemWebUrl: item.itemWebUrl
        }));

        return NextResponse.json({
            items,
            count: items.length,
            success: true
        });

    } catch (error) {
        console.error('Search Proxy Error:', error);
        return NextResponse.json({
            error: 'Internal Server Error',
            details: (error as any).message
        }, { status: 500 });
    }
}
