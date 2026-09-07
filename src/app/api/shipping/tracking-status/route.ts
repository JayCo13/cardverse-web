import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { fetchCarrierTracking, trackableCarrier } from '@/lib/carrier-tracking';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { notifyCarrierStatusChange } from '@/lib/carrier-notifications';

// The parcel's journey for one order, for the buyer or the seller on it.
//
// The tracking number is never taken from the request: it is read from the
// order after the caller is checked against it. A carrier tracking number
// exposes the recipient's name and address, so answering for an arbitrary
// number would hand anyone a lookup tool over other people's deliveries.
export async function GET(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const orderId = request.nextUrl.searchParams.get('order_id') || '';
    if (!orderId) {
        return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
    }

    const { data: order, error } = await supabase
        .from('orders')
        .select('id, buyer_id, seller_id, status, shipping_provider, tracking_number, carrier_status, carrier_sub_status, carrier_status_at')
        .eq('id', orderId)
        .maybeSingle<{
            id: string; buyer_id: string; seller_id: string; status: string;
            shipping_provider: string | null; tracking_number: string | null;
            carrier_status: string | null; carrier_sub_status: string | null;
            carrier_status_at: string | null;
        }>();

    if (error || !order) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (order.buyer_id !== user.id && order.seller_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const carrier = order.shipping_provider || '';
    const trackingNumber = order.tracking_number || '';

    // What the database already knows, which is what the webhook has pushed so
    // far. Shown even when the live lookup is unavailable.
    const stored = {
        status: order.carrier_status,
        subStatus: order.carrier_sub_status,
        at: order.carrier_status_at,
        orderStatus: order.status,
        carrier,
        trackingNumber,
    };

    if (!trackingNumber || !trackableCarrier(carrier)) {
        return NextResponse.json({
            ...stored,
            supported: false,
            lookup: 'not_trackable',
            events: [],
        });
    }

    // No language is sent on the read: the parcel's prose language was fixed
    // when it was registered, and `gettrackinfo` ignores `lang` (see
    // TRACKING_LANGS). Each event carries its translation and that
    // translation's language, and the dialog compares before using it.
    const live = await fetchCarrierTracking(carrier, trackingNumber);

    // `supported` says the carrier can be tracked at all; `lookup` says whether
    // we actually managed to read it just now. Keeping them apart is the point:
    // folding a failed lookup into `events: []` told the reader the carrier had
    // posted no updates, when the truth was that we never got an answer.
    if (!live.ok) {
        console.warn(`[Tracking] lookup failed for ${carrier} ${trackingNumber}: ${live.reason}`);
        return NextResponse.json({
            ...stored,
            supported: true,
            lookup: live.reason,
            events: [],
        });
    }

    // Write back what we just learned.
    //
    // This read is the only place that holds the carrier's current answer, and
    // it used to throw it away — the page showed a live 'Delivered' while the
    // row behind it still said 'InTransit'. Nothing reads carrier_status on
    // screen, but complete_delivered_orders and dispute_evidence_verdict both
    // do, and a stale row there is what turns a delivered parcel into an
    // escalation and a refund recommendation against a seller who shipped.
    //
    // 17TRACK does not guarantee its pushes and does not retry ours, so this is
    // the repair path for a webhook that never arrived: every time either party
    // opens the tracking dialog, the row catches up. Best-effort and on the
    // service role, since the RPC is granted to nobody else; a failure here
    // must not cost the reader their timeline.
    let at = stored.at;
    if (live.status && live.status !== stored.status) {
        try {
            const service = createServiceSupabaseClient();

            // The RPC finds its order by tracking number and takes the newest
            // match, so it cannot be aimed at the order in hand. While a number
            // is shared — nothing enforces uniqueness yet — reconciling would
            // write this parcel's status onto somebody else's order, and a
            // 'Delivered' there starts a 72h release clock that nobody asked
            // for. Reading is still worth doing; writing is not, until the
            // number identifies one order. Counted on the service role because
            // the caller's own view is filtered to their orders.
            const { count } = await service
                .from('orders')
                .select('id', { count: 'exact', head: true })
                .eq('tracking_number', trackingNumber)
                .eq('shipping_provider', carrier);

            if ((count ?? 0) > 1) {
                console.warn(
                    `[Tracking] Not reconciling ${carrier} ${trackingNumber}: ${count} orders share it`,
                );
                throw new Error('ambiguous_tracking_number');
            }

            const { data: applied, error: applyError } = await service.rpc('apply_carrier_tracking_event' as never, {
                p_tracking_number: trackingNumber,
                p_shipping_provider: carrier,
                p_status: live.status,
                p_sub_status: live.subStatus,
            } as never);
            if (applyError) throw applyError;
            // Same mail the webhook would have sent. Reaching this line means
            // the webhook did not, so the buyer has heard nothing yet.
            await notifyCarrierStatusChange(service, applied as never);
            // The row moved, so the timestamp beside the status is this moment
            // rather than whenever the old status was first seen.
            at = new Date().toISOString();
        } catch (reconcileError) {
            // Never fatal: the reader still gets the live timeline, which is
            // the thing they opened the dialog for.
            console.error('[Tracking] Reconcile failed:', reconcileError);
        }
    }

    return NextResponse.json({
        ...stored,
        at,
        supported: true,
        lookup: 'ok',
        status: live.status,
        subStatus: live.subStatus,
        events: live.events,
    });
}
