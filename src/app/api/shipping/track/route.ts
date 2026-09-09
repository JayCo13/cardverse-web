import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { goshipShipmentByCode } from '@/lib/goship';
import { goshipStatusToCarrierStatus } from '@/lib/goship-status';

/**
 * Where a parcel is, for the two people entitled to ask.
 *
 * Both sides of the order, not only the buyer: delivery starts the seller's
 * 72-hour payout clock and a parcel that never confirms goes to an
 * administrator instead of paying out, so the seller has as much reason to look.
 * Anyone else gets a 404 — not a 403, which would confirm the order exists.
 *
 * Read live from GoShip rather than from the order row. The row keeps the
 * latest status because that is what decides money; the sequence of scans is
 * what a person is actually asking for, and mirroring it into a table would be
 * a second copy to fall behind.
 */

export async function GET(request: NextRequest) {
    const orderId = request.nextUrl.searchParams.get('orderId')?.trim();
    if (!orderId) return NextResponse.json({ error: 'Thiếu mã đơn hàng.' }, { status: 400 });

    const auth = await createServerSupabaseClient();
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Chưa đăng nhập.' }, { status: 401 });

    const service = createServiceSupabaseClient();
    const { data, error } = await service
        .from('orders')
        .select('id, buyer_id, seller_id, goship_code, carrier_status, carrier_status_at, shipping_provider, tracking_number, carrier_tracking_url')
        .eq('id', orderId)
        .maybeSingle();

    const order = data as {
        buyer_id: string; seller_id: string; goship_code: string | null;
        carrier_status: string | null; carrier_status_at: string | null;
        shipping_provider: string | null; tracking_number: string | null;
        carrier_tracking_url: string | null;
    } | null;

    if (error || !order || (order.buyer_id !== user.id && order.seller_id !== user.id)) {
        return NextResponse.json({ error: 'Không tìm thấy đơn hàng.' }, { status: 404 });
    }

    if (!order.goship_code) {
        return NextResponse.json({
            data: {
                gcode: null, events: [],
                carrierName: null, carrierCode: null, trackingUrl: null,
            },
        });
    }

    const shipment = await goshipShipmentByCode(order.goship_code);
    if (!shipment.ok) {
        // The order still knows its own last status, so answer with that rather
        // than an error page: "we cannot reach the carrier right now" is worse
        // than "here is what we last heard, at this time".
        console.error('[Track] GoShip lookup failed:', shipment.reason);
        return NextResponse.json({
            data: {
                gcode: order.goship_code,
                degraded: true,
                events: order.carrier_status
                    ? [{
                        code: null,
                        status: order.carrier_status,
                        text: null,
                        detail: null,
                        at: order.carrier_status_at,
                    }]
                    : [],
                carrierName: order.shipping_provider,
                carrierCode: order.tracking_number,
                trackingUrl: order.carrier_tracking_url,
            },
        });
    }

    const found = shipment.data;
    const history = Array.isArray(found?.history) ? found.history : [];

    return NextResponse.json({
        data: {
            gcode: order.goship_code,
            degraded: false,
            carrierName: found?.carrier_name ?? order.shipping_provider,
            // Null until the carrier accepts. GoShip writes the literal string
            // NULL into its own tracking_url in the meantime, which is why that
            // is read through the same guard the webhook uses.
            carrierCode: found?.carrier_code || order.tracking_number || null,
            trackingUrl: /=(?:NULL|null|undefined)?(?:&|$)/.test(String(found?.tracking_url ?? ''))
                ? order.carrier_tracking_url
                : (found?.tracking_url || order.carrier_tracking_url),
            expected: found?.expected_delivery_date || null,
            // Oldest first: a journey reads forwards.
            events: history
                .map((h) => ({
                    code: typeof h.status === 'number' ? h.status : null,
                    status: typeof h.status === 'number'
                        ? goshipStatusToCarrierStatus(h.status)
                        : null,
                    text: h.status_text ?? null,
                    detail: h.message || h.status_desc || null,
                    at: h.updated_time
                        ? new Date(h.updated_time * 1000).toISOString()
                        : (h.updated_at ?? null),
                }))
                .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')),
        },
    });
}
