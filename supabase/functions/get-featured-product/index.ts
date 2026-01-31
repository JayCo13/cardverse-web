// Get Featured Product Edge Function
// Returns a featured high-value card for the Market Spotlight section
//
// Usage:
// - GET /get-featured-product                    - Random high-value card
// - GET /get-featured-product?search=Charizard   - Search for specific card

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async (req) => {
    // Handle CORS
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    }

    try {
        const url = new URL(req.url);
        const search = url.searchParams.get('search');
        const cardNumber = url.searchParams.get('number'); // Support card number search

        // Build query
        let query = supabase
            .from('tcgcsv_products')
            .select('product_id, name, image_url, set_name, rarity, market_price, low_price, mid_price, high_price, number, tcgplayer_url, extended_data')
            .not('market_price', 'is', null)
            .not('number', 'is', null) // Only cards with numbers (exclude boxes/boosters)
            .gt('market_price', 0);

        if (search) {
            query = query.ilike('name', `%${search}%`);
        }

        // Fetch more results to allow client-side sorting by card number
        const { data: products, error } = await query
            .order('market_price', { ascending: false })
            .limit(cardNumber ? 50 : 10); // Get more if filtering by number

        if (error) {
            console.error('Query error:', JSON.stringify(error));
            return new Response(
                JSON.stringify({ error: 'Failed to fetch products', details: error }),
                { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
            );
        }

        if (!products || products.length === 0) {
            return new Response(
                JSON.stringify({ error: 'No products found', search }),
                { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
            );
        }

        // If card number provided, sort to prioritize exact matches (like mobile app)
        let sortedProducts = products;
        if (cardNumber) {
            const cleanNumber = cardNumber.replace(/[^\d/]/g, '').trim();
            sortedProducts = [...products].sort((a, b) => {
                const aNum = (a.number || '').replace(/[^\d/]/g, '');
                const bNum = (b.number || '').replace(/[^\d/]/g, '');

                const aMatches = aNum === cleanNumber;
                const bMatches = bNum === cleanNumber;

                // Prioritize exact number match
                if (aMatches && !bMatches) return -1;
                if (!aMatches && bMatches) return 1;

                // Otherwise sort by market price (higher first)
                return (b.market_price || 0) - (a.market_price || 0);
            });
        }

        // Pick first result (best match)
        const featured = search || cardNumber ? sortedProducts[0] : sortedProducts[Math.floor(Math.random() * sortedProducts.length)];

        // Fetch price history
        const { data: history } = await supabase
            .from('tcgcsv_price_history')
            .select('recorded_at, market_price, low_price, high_price')
            .eq('product_id', featured.product_id)
            .order('recorded_at', { ascending: true })
            .limit(30);

        // Format chart data
        const chartData = (history || []).map(h => ({
            date: new Date(h.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            price: h.market_price || 0,
            low: h.low_price,
            high: h.high_price,
        }));

        // Parse extended_data for card details
        let cardDetails: Record<string, string> = {};
        try {
            const extData = typeof featured.extended_data === 'string'
                ? JSON.parse(featured.extended_data)
                : featured.extended_data;

            if (Array.isArray(extData)) {
                for (const item of extData) {
                    if (item.name && item.value) {
                        cardDetails[item.name] = item.value;
                    }
                }
            }
        } catch (e) {
            console.log('Error parsing extended_data:', e);
        }

        // Parse card details
        const isFirstEdition = featured.name?.toLowerCase().includes('1st edition') ||
            featured.set_name?.toLowerCase().includes('1st edition') || false;
        const isHolo = featured.name?.toLowerCase().includes('holo') || false;
        const displayName = featured.name?.replace(/\s*-?\s*(holo|holofoil|1st edition)/gi, '').trim() || featured.name;

        return new Response(
            JSON.stringify({
                success: true,
                product: {
                    ...featured,
                    isFirstEdition,
                    isHolo,
                    displayName,
                    // Parsed card details
                    cardType: cardDetails['Card Type'] || null,
                    hp: cardDetails['HP'] || null,
                    stage: cardDetails['Stage'] || null,
                    attack1: cardDetails['Attack 1'] || null,
                    attack2: cardDetails['Attack 2'] || null,
                    attack3: cardDetails['Attack 3'] || null,
                    weakness: cardDetails['Weakness'] || null,
                    resistance: cardDetails['Resistance'] || null,
                    retreatCost: cardDetails['RetreatCost'] || null,
                    artist: cardDetails['Description'] || null,
                },
                chartData,
                stats: {
                    currentPrice: featured.market_price,
                    lowPrice: featured.low_price,
                    highPrice: featured.high_price,
                    dataPoints: chartData.length,
                }
            }),
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                }
            }
        );
    } catch (error) {
        console.error('Error:', error);
        return new Response(
            JSON.stringify({ success: false, error: String(error) }),
            { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
        );
    }
});
