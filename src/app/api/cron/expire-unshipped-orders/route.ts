import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { expireUnshippedPaidOrders } from '@/lib/expire-orders';

// Auto-cancel paid orders the seller didn't ship in time: relist the card,
// refund the buyer, add a seller fault. Also runs opportunistically on /orders
// load, so this cron is a backstop. This service-role endpoint must fail closed
// when CRON_SECRET is absent; otherwise an anonymous caller could trigger
// cancellations and wallet refunds.
export async function POST(request: NextRequest) {
    const secret = process.env.CRON_SECRET;
    const token = request.nextUrl.searchParams.get('token') || request.headers.get('x-cron-secret');
    if (!secret || token !== secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const cancelled = await expireUnshippedPaidOrders(createServiceSupabaseClient());
        return NextResponse.json({ cancelled });
    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'error' }, { status: 500 });
    }
}
