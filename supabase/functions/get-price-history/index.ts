// Get Price History Edge Function
// Returns historical price data for a product to power charts
//
// Usage:
// - GET /get-price-history?product_id=12345              - Last 30 days
// - GET /get-price-history?product_id=12345&days=7       - Last 7 days
// - GET /get-price-history?product_id=12345&days=365     - Last year

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface PriceHistoryPoint {
    date: string;
    price: number;
    low: number | null;
    high: number | null;
}

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
        const productId = url.searchParams.get('product_id');
        const days = parseInt(url.searchParams.get('days') || '30');

        if (!productId) {
            return new Response(
                JSON.stringify({ error: 'product_id is required' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Calculate date range
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Fetch price history
        const { data: history, error } = await supabase
            .from('tcgcsv_price_history')
            .select('recorded_at, market_price, low_price, high_price')
            .eq('product_id', parseInt(productId))
            .gte('recorded_at', startDate.toISOString().split('T')[0])
            .lte('recorded_at', endDate.toISOString().split('T')[0])
            .order('recorded_at', { ascending: true });

        if (error) {
            console.error('Query error:', error);
            return new Response(
                JSON.stringify({ error: 'Failed to fetch price history' }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Also fetch product info
        const { data: product } = await supabase
            .from('tcgcsv_products')
            .select('name, image_url, set_name, rarity, market_price, low_price, high_price')
            .eq('product_id', parseInt(productId))
            .single();

        // Format for Recharts
        const chartData: PriceHistoryPoint[] = (history || []).map(h => ({
            date: new Date(h.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            price: h.market_price || 0,
            low: h.low_price,
            high: h.high_price,
        }));

        // Calculate stats
        const prices = chartData.map(d => d.price).filter(p => p > 0);
        const currentPrice = prices[prices.length - 1] || product?.market_price || 0;
        const previousPrice = prices[prices.length - 2] || prices[0] || currentPrice;
        const priceChange = previousPrice > 0
            ? ((currentPrice - previousPrice) / previousPrice * 100).toFixed(1)
            : '0.0';

        return new Response(
            JSON.stringify({
                success: true,
                product: product || null,
                chartData,
                stats: {
                    currentPrice,
                    priceChange: parseFloat(priceChange),
                    priceChangeDirection: parseFloat(priceChange) >= 0 ? 'up' : 'down',
                    dataPoints: chartData.length,
                    dateRange: {
                        start: startDate.toISOString().split('T')[0],
                        end: endDate.toISOString().split('T')[0],
                    }
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
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
});
