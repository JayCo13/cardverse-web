import { accountRoute } from '@/lib/account-route';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { fetchCarrierTracking, trackableCarrier } from '@/lib/carrier-tracking';

// The parcel's journey for one order, for the buyer or the seller on it.
//
// The tracking number is never taken from the request: it is read from the
// order after the caller is checked against it. A carrier tracking number
// exposes the recipient's name and address, so answering for an arbitrary
// number would hand anyone a lookup tool over other people's deliveries.
async function handleGET(request: NextRequest) {
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

    return NextResponse.json({
        ...stored,
        supported: true,
        lookup: 'ok',
        status: live.status,
        subStatus: live.subStatus,
        events: live.events,
    });
}

export const GET = accountRoute(handleGET);
