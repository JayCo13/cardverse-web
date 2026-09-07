import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { readTrackingEvent } from '@/lib/carrier-tracking';
import { getCarrier, getTrackingUrl } from '@/lib/shipping-carriers';
import { sendOrderInTransitEmail, sendOrderDeliveredEmail } from '@/lib/mail';

/**
 * Statuses that mean the parcel is physically moving.
 *
 * 17TRACK reports both, in that order, and the buyer only needs to hear "it is
 * on its way" once — so the mail goes out on the transition into this set, not
 * on every event inside it.
 */
const MOVING_STATUSES = new Set(['InTransit', 'OutForDelivery']);

/**
 * Catch-up mail for a carrier event, best-effort.
 *
 * Deliberately swallows its own failures and is awaited before the webhook
 * answers: 17TRACK retries on a non-200, and re-running the whole event because
 * a mail server was slow would re-notify rather than repair. The status change
 * is already committed by the time this runs.
 */
async function notifyBuyer(
    service: ReturnType<typeof createServiceSupabaseClient>,
    orderId: string,
    status: string,
    fromStatus: string | null,
) {
    const delivered = status === 'Delivered';
    const startedMoving = MOVING_STATUSES.has(status) && !MOVING_STATUSES.has(fromStatus || '');
    if (!delivered && !startedMoving) return;

    try {
        const { data: order } = await service
            .from('orders')
            .select('buyer_id, card_id, shipping_provider, tracking_number, auto_complete_at')
            .eq('id', orderId)
            .single();
        if (!order) return;

        const [{ data: buyer }, { data: card }] = await Promise.all([
            service.from('profiles').select('email').eq('id', (order as any).buyer_id).single(),
            (order as any).card_id
                ? service.from('cards').select('name').eq('id', (order as any).card_id).single()
                : Promise.resolve({ data: null } as any),
        ]);

        const buyerEmail = (buyer as any)?.email;
        if (!buyerEmail) return;
        const cardName = (card as any)?.name || 'thẻ của bạn';

        if (delivered) {
            await sendOrderDeliveredEmail(buyerEmail, {
                cardName,
                orderId,
                autoCompleteAt: (order as any).auto_complete_at ?? null,
            });
            return;
        }

        const carrierCode = (order as any).shipping_provider as string | null;
        const trackingNo = (order as any).tracking_number as string | null;
        await sendOrderInTransitEmail(buyerEmail, {
            cardName,
            carrierName: (carrierCode && getCarrier(carrierCode)?.name) || carrierCode || 'Đơn vị vận chuyển',
            trackingNumber: trackingNo || '',
            trackingUrl: carrierCode && trackingNo ? getTrackingUrl(carrierCode, trackingNo) : null,
        });
    } catch (error) {
        console.error('[Tracking Webhook] Catch-up mail failed:', error);
    }
}

// Delivery status pushed by the tracking service (17TRACK).
//
// Register the URL at admin.17track.net → Settings → Package Webhook:
//   https://cardversehub.com/api/shipping/tracking-webhook?token=<SEVENTEENTRACK_WEBHOOK_TOKEN>
//
// Security: 17TRACK does not sign its pushes — no HMAC, no signature header,
// nothing (confirmed against their v2.4 documentation). Anyone who learns the
// URL could otherwise post a fake 'Delivered' and start the 72h clock that pays
// a seller out. So the URL carries a secret, compared in constant time, and the
// route fails closed when the secret is unset: an absent token must never mean
// an open door.

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
        const result = data as { order_id?: string; status?: string; from_status?: string | null } | null;
        if (result?.order_id && result.status) {
            await notifyBuyer(supabase, result.order_id, result.status, result.from_status ?? null);
        }

        return NextResponse.json({ success: true, result: data });
    } catch (error: any) {
        console.error('[Tracking Webhook] Failed:', error);
        return NextResponse.json({ error: error?.message || 'error' }, { status: 500 });
    }
}
