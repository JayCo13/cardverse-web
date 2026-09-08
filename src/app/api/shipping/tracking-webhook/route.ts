import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { readTrackingEvent } from '@/lib/carrier-tracking';
import { notifyCarrierStatusChange } from '@/lib/carrier-notifications';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

export async function POST(request: NextRequest) {
    const expectedToken = process.env.SEVENTEENTRACK_WEBHOOK_TOKEN;
    if (!expectedToken) {
        console.error('[Tracking Webhook] SEVENTEENTRACK_WEBHOOK_TOKEN is not set — rejecting');
        return NextResponse.json({ error: 'Webhook not configured' }, { status: 401 });
    }

    const providedToken = request.nextUrl.searchParams.get('token')
        || request.headers.get('x-webhook-token')
        || '';
    // Fixed-length digests so a length mismatch cannot throw or leak timing.
    if (!timingSafeEqual(sha256(providedToken), sha256(expectedToken))) {
        console.warn('[Tracking Webhook] Invalid token');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const event = readTrackingEvent(body);
        if (!event) {
            // Acknowledge rather than error: the service retries on failure, and
            // a payload we cannot read will never become readable.
            return NextResponse.json({ success: true, ignored: 'unreadable_payload' });
        }

        // Which carrier the seller declared is on the order; the numeric code in
        // the payload is the service's own and is not compared against it here.
        const supabase = createServiceSupabaseClient();
        const { data, error } = await supabase.rpc('apply_carrier_tracking_event' as never, {
            p_tracking_number: event.number,
            p_shipping_provider: null,
            p_status: event.status,
            p_sub_status: event.subStatus,
        } as never);
        if (error) throw error;

        // Only a real transition is worth an email. The RPC's early returns —
        // order_not_found, terminal_order, replayed, out_of_order — carry no
        // order_id, so this also covers the repeat pushes 17TRACK sends.
        await notifyCarrierStatusChange(supabase, data as never);

        return NextResponse.json({ success: true, result: data });
    } catch (error: any) {
        console.error('[Tracking Webhook] Failed:', error);
        return NextResponse.json({ error: error?.message || 'error' }, { status: 500 });
    }
}
