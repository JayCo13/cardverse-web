import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { expireUnshippedPaidOrders } from '@/lib/expire-orders';

// Auto-cancel paid orders the seller didn't ship in time: relist the card,
// refund the buyer, add a seller fault. Also runs opportunistically on /orders
// load, so this cron is a backstop. Protect with CRON_SECRET if set.
export async function POST(request: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (secret) {
        const token = request.nextUrl.searchParams.get('token') || request.headers.get('x-cron-secret');
        if (token !== secret) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    try {
        const cancelled = await expireUnshippedPaidOrders(createServiceSupabaseClient());
        return NextResponse.json({ cancelled });
    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'error' }, { status: 500 });
    }
}
