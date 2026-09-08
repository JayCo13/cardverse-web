import type { SupabaseClient } from '@supabase/supabase-js';
import { getCarrier, getTrackingUrl } from '@/lib/shipping-carriers';
import { sendOrderInTransitEmail, sendOrderDeliveredEmail } from '@/lib/mail';

/**
 * Statuses that mean the parcel is physically moving.
 *
 * A carrier reports both, in that order, and the buyer only needs to hear "it
 * is on its way" once — so the mail goes out on the transition into this set,
 * not on every event inside it.
 */
const MOVING_STATUSES = new Set(['InTransit', 'OutForDelivery']);

/** What apply_carrier_tracking_event answers with when it actually moved a row. */
export type CarrierEventResult = {
    order_id?: string;
    status?: string;
    from_status?: string | null;
} | null;

/**
 * Tell the buyer their parcel moved, for whichever path noticed.
 *
 * Kept apart from the route that receives the event so the decision travels
 * with the event rather than with whichever path noticed it. That mattered when
 * three paths could apply a status and only one of them mailed; it still holds
 * now that GoShip's webhook is the only one, because the next path added should
 * not have to remember.
 *
 * Driven by the RPC's own result rather than by a status the caller read
 * beforehand: the row can move between a caller's read and its write, and the
 * RPC's early returns (order_not_found, terminal_order, replayed, out_of_order)
 * carry no order_id, so they cannot be mistaken for a transition.
 *
 * Swallows its own failures. Every caller has already committed the status
 * change by the time this runs, and none of them should fail because a mail
 * server was slow.
 */
export async function notifyCarrierStatusChange(
    service: SupabaseClient,
    result: CarrierEventResult,
): Promise<void> {
    const status = result?.status;
    const orderId = result?.order_id;
    if (!orderId || !status) return;

    const delivered = status === 'Delivered';
    const startedMoving = MOVING_STATUSES.has(status)
        && !MOVING_STATUSES.has(result?.from_status || '');
    if (!delivered && !startedMoving) return;

    try {
        const { data: order } = await service
            .from('orders')
            .select('buyer_id, card_id, shipping_provider, tracking_number, auto_complete_at')
            .eq('id', orderId)
            .single();
        if (!order) return;

        const row = order as {
            buyer_id: string;
            card_id: string | null;
            shipping_provider: string | null;
            tracking_number: string | null;
            auto_complete_at: string | null;
        };

        const [{ data: buyer }, { data: card }] = await Promise.all([
            service.from('profiles').select('email').eq('id', row.buyer_id).single(),
            row.card_id
                ? service.from('cards').select('name').eq('id', row.card_id).single()
                : Promise.resolve({ data: null }),
        ]);

        const buyerEmail = (buyer as { email?: string } | null)?.email;
        if (!buyerEmail) return;
        const cardName = (card as { name?: string } | null)?.name || 'thẻ của bạn';

        if (delivered) {
            await sendOrderDeliveredEmail(buyerEmail, {
                cardName,
                orderId,
                autoCompleteAt: row.auto_complete_at,
            });
            return;
        }

        const carrierCode = row.shipping_provider;
        const trackingNo = row.tracking_number;
        await sendOrderInTransitEmail(buyerEmail, {
            cardName,
            carrierName: (carrierCode && getCarrier(carrierCode)?.name) || carrierCode || 'Đơn vị vận chuyển',
            trackingNumber: trackingNo || '',
            trackingUrl: carrierCode && trackingNo ? getTrackingUrl(carrierCode, trackingNo) : null,
        });
    } catch (error) {
        console.error('[Tracking] Carrier status mail failed:', error);
    }
}
