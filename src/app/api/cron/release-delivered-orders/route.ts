import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

// One pass of the post-delivery sweep.
//
// `complete_delivered_orders()` was only ever called opportunistically, from the
// orders and wallet page loads. That was tolerable while it merely escalated
// orders to an administrator; now that it releases escrow to sellers, leaving
// payout timing to whether somebody happens to open a page is not good enough —
// a seller could wait days on a quiet week.
//
// It settles orders whose 72h buyer window has closed: carrier-confirmed
// deliveries pay out, everything else goes to an administrator. Running it twice
// is harmless — each order is claimed with `for update skip locked` and leaves
// the eligible set as soon as it is handled.
//
// Fails closed without CRON_SECRET: this runs on the service role and moves
// money, so an anonymous caller must never be able to trigger it.
const sha256 = (value: string) => createHash('sha256').update(value).digest();

export async function POST(request: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = request.nextUrl.searchParams.get('token')
        || request.headers.get('x-cron-secret')
        || '';
    if (!timingSafeEqual(sha256(token), sha256(secret))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { data, error } = await createServiceSupabaseClient()
            .rpc('complete_delivered_orders' as never);
        if (error) throw error;
        return NextResponse.json({ settled: data ?? 0 });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || 'error' }, { status: 500 });
    }
}
