import { accountRoute, getAccountRouteContext } from '@/lib/account-route';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { expireUnshippedPaidOrders } from '@/lib/expire-orders';
import { NextRequest, NextResponse } from 'next/server';

type DashboardSummary = {
    orders: { total: number; waitingShip: number; shipping: number; completed: number; totalEarnings: number };
    listings: { active: number; sold: number; draft: number; total: number };
};

const EMPTY_SUMMARY: DashboardSummary = {
    orders: { total: 0, waitingShip: 0, shipping: 0, completed: 0, totalEarnings: 0 },
    listings: { active: 0, sold: 0, draft: 0, total: 0 },
};

async function handleGET(request: NextRequest) {
    const { supabase, user } = await getAccountRouteContext(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Preserve the self-healing behavior of the full orders endpoint before
    // reading its aggregates. The dashboard stays light, but it must not show
    // an overdue status just because it uses a smaller response.
    await supabase.rpc('complete_delivered_orders' as never);
    try {
        await expireUnshippedPaidOrders(createServiceSupabaseClient());
    } catch (error) {
        console.error('expireUnshippedPaidOrders failed:', error);
    }

    const [{ data: summaryData, error: summaryError }, { data: recentOrders, error: ordersError }] = await Promise.all([
        supabase.rpc('get_seller_dashboard_summary' as never),
        supabase
            .from('orders')
            .select(`
                id, status, carrier_status, carrier_status_at, amount, platform_fee, created_at,
                card:cards(name, image_url)
            `)
            .eq('seller_id', user.id)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(5),
    ]);

    if (summaryError || ordersError) {
        const error = summaryError || ordersError;
        console.error('[Seller dashboard] Load failed:', error?.message);
        return NextResponse.json({ error: 'Không tải được seller dashboard.' }, { status: 500 });
    }

    return NextResponse.json({
        recentOrders: recentOrders || [],
        summary: (summaryData as DashboardSummary | null) || EMPTY_SUMMARY,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export const GET = accountRoute(handleGET);
