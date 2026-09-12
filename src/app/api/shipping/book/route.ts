import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { goshipCreateShipment, goshipCarrierToApp, goshipFindShipmentByOrderId, goshipEnv, goshipRates } from '@/lib/goship';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { isEvidenceVideoUrl } from '@/lib/evidence-video';
import { parseParcel, parcelCopy } from '@/lib/parcel';
import { getRequestLocale } from '@/lib/request-localization';
import { booksWithCarrier } from '@/lib/shipping-carriers';
import { shipmentCarriers } from '@/lib/shipment-carriers';

/**
 * Book a parcel with a carrier.
 *
 * The only call in this codebase that dispatches a courier to somebody's door
 * and bills for it, so everything it can check, it checks here rather than
 * trusting the form.
 *
 * Origin is the caller's saved sender address, never the request: a seller
 * cannot book a pickup from an address they have not proved is theirs.
 *
 * `declaredValue` is required and must be positive. It is GoShip's
 * parcel.amount — khai giá — and it is what the carrier pays if the parcel is
 * lost. It also costs: above a threshold the carrier charges for it, so the
 * quote the seller chose from was priced with the same figure.
 */

const ID = /^[0-9]{1,12}$/;
const PHONE = /^0[0-9]{8,10}$/;

/** A slabbed card in a bubble mailer; overridable, but bounded. */


/**
 * Write a booked shipment onto its order.
 *
 * Returns a response only when something went wrong; null means it was filed.
 * Shared between a fresh booking and the recovery of one whose answer was lost,
 * so both leave the order in the same state.
 */
async function linkShipmentToOrder(
    orderId: string,
    created: { id?: string; tracking_number?: string; carrier_short_name?: string },
    body: Record<string, any> | null,
    destination?: { city: string; district: string; ward: string } | null,
    /** What GoShip charges. The seller's payout is netted against it, so it is
     *  read from a server-side quote and never from the request. */
    goshipFee?: number | null,
) {
    const gcode = created.id as string;
    const raw = body?.packingVideoUrl;
    const packingVideoUrl = isEvidenceVideoUrl(raw, process.env.CLOUDINARY_CLOUD_NAME)
        ? (raw as string) : null;

    const service = createServiceSupabaseClient();
    const { error } = await service
        .from('orders')
        .update({
            goship_code: gcode,
            // Stamped at booking, because it is the only moment we know it for
            // certain. Afterwards the code alone cannot say which account
            // issued it, and events from the other one must not be obeyed.
            goship_env: goshipEnv(),
            ...(typeof goshipFee === 'number' && goshipFee >= 0 ? { goship_fee: Math.round(goshipFee) } : {}),
            // Remember the ids used, so a retry or a later read does not depend
            // on the form that supplied them.
            ...(destination ? { to_goship: destination } : {}),
            ...(created.tracking_number ? { tracking_number: created.tracking_number } : {}),
            ...(created.carrier_short_name
                ? { shipping_provider: goshipCarrierToApp(created.carrier_short_name) } : {}),
            ...(packingVideoUrl ? { seller_packing_video_url: packingVideoUrl } : {}),
        } as never)
        .eq('id', orderId)
        .is('goship_code', null);

    if (error) {
        // A courier is already coming and this is the only record of which
        // shipment belongs to which order.
        console.error(`[Book] ORPHAN SHIPMENT ${gcode} for order ${orderId}: ${error.message}`);
        return NextResponse.json(
            { error: 'Đã tạo vận đơn nhưng chưa gắn được vào đơn hàng. Liên hệ hỗ trợ kèm mã ' + gcode, code: 'link_failed', gcode },
            { status: 500 },
        );
    }
    return null;
}

export async function POST(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => null) as Record<string, any> | null;
    const to = body?.to ?? {};
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

    const dest = {
        city: str(to.city), district: str(to.district), ward: str(to.ward),
        street: str(to.street), name: str(to.name), phone: str(to.phone).replace(/\s+/g, ''),
    };

    const orderId = str(body?.orderId);
    let requireDimensions = false;
    let order: { id: string; goship_code: string | null } | null = null;

    // The order is the authority on who receives the parcel.
    //
    // Name, phone and street were snapshotted at checkout and are what the buyer
    // actually gave; a seller retyping them into a booking form is a chance to
    // get them wrong. Only the carrier's three ids can come from the request,
    // and only because an order placed before checkout collected them has none.
    if (orderId) {
        const { data } = await supabase
            .from('orders')
            .select('id, seller_id, status, goship_code, to_goship, to_name, to_phone, to_address_detail, metadata, card:cards(*)')
            .eq('id', orderId)
            .maybeSingle();
        const row = data as {
            card?: { product_kind?: string };
            id: string; seller_id: string; status: string; goship_code: string | null;
            to_goship: { city?: string; district?: string; ward?: string } | null;
            to_name: string | null; to_phone: string | null; to_address_detail: string | null;
            metadata: { shipping_carrier?: string } | null;
        } | null;

        if (!row || row.seller_id !== user.id) {
            return NextResponse.json({ error: 'Không tìm thấy đơn hàng.' }, { status: 404 });
        }
        requireDimensions = !!row.card?.product_kind && row.card.product_kind !== 'card';
        if (row.goship_code) {
            return NextResponse.json({ error: 'Đơn này đã có vận đơn.', code: 'already_booked' }, { status: 409 });
        }
        // A meet-up has no waybill, and this is where that promise is kept
        // rather than merely stated. The buyer paid nothing for shipping on
        // this order, so a real carrier bill attached to it would be netted off
        // the seller's payout in full at settlement — the seller would pay for
        // a courier out of the sale, on an order both sides agreed to hand
        // over in person.
        if (!booksWithCarrier(row.metadata?.shipping_carrier)) {
            return NextResponse.json({
                error: 'Đơn này là giao tận tay nên không tạo vận đơn. Hẹn gặp người mua rồi bấm đã giao.',
                code: 'hand_delivery',
            }, { status: 409 });
        }
        if (row.status !== 'paid') {
            return NextResponse.json(
                { error: 'Chỉ tạo vận đơn cho đơn đã thanh toán và chưa gửi.', code: 'not_bookable' },
                { status: 409 },
            );
        }

        dest.name = str(row.to_name);
        dest.phone = str(row.to_phone).replace(/\s+/g, '');
        dest.street = str(row.to_address_detail);

        // The order's own ids win; the request only fills in for an order that
        // predates them.
        if (row.to_goship?.city && row.to_goship?.district && row.to_goship?.ward) {
            dest.city = String(row.to_goship.city);
            dest.district = String(row.to_goship.district);
            dest.ward = String(row.to_goship.ward);
        }
        order = { id: row.id, goship_code: row.goship_code };
    }

    if (!ID.test(dest.city) || !ID.test(dest.district) || !ID.test(dest.ward)) {
        return NextResponse.json({ error: 'Chưa chọn đủ tỉnh/thành, quận/huyện, phường/xã của người nhận.' }, { status: 400 });
    }
    if (!dest.street || dest.street.length > 255) {
        return NextResponse.json({ error: 'Địa chỉ cụ thể của người nhận cần 1-255 ký tự.' }, { status: 400 });
    }
    if (!dest.name || dest.name.length > 120) {
        return NextResponse.json({ error: 'Tên người nhận cần 1-120 ký tự.' }, { status: 400 });
    }
    if (!PHONE.test(dest.phone)) {
        return NextResponse.json({ error: 'Số điện thoại người nhận không hợp lệ.' }, { status: 400 });
    }

    const rateId = str(body?.rateId);
    if (!rateId) return NextResponse.json({ error: 'Chưa chọn gói vận chuyển.' }, { status: 400 });

    // Required, not defaulted. A parcel booked at zero is a parcel the carrier
    // owes nothing for.
    const declaredValue = Number(body?.declaredValue);
    if (!Number.isFinite(declaredValue) || declaredValue <= 0 || declaredValue > 500_000_000) {
        return NextResponse.json(
            { error: 'Khai giá phải lớn hơn 0.' },
            { status: 400 },
        );
    }

    // Orders must always supply explicit packed dimensions. Standalone legacy
    // previews retain their card defaults until they adopt the expanded form.
    const parcel = parseParcel(body, requireDimensions);
    if (!parcel) return NextResponse.json({ error: parcelCopy(getRequestLocale(request)).invalid }, { status: 400 });

    const { data: profile } = await supabase
        .from('profiles')
        .select('goship_pickup,shipping_carriers')
        .eq('id', user.id)
        .single();

    const seller = profile as { goship_pickup: Record<string, string> | null; shipping_carriers: string[] | null } | null;
    const from = seller?.goship_pickup;
    if (!from?.city || !from?.district || !from?.ward || !from?.street || !from?.name || !from?.phone) {
        return NextResponse.json(
            { error: 'Bạn cần lưu đầy đủ thông tin người gửi trước khi đặt vận đơn.', code: 'missing_goship_pickup' },
            { status: 409 },
        );
    }

    // Recover a booking whose answer was lost.
    //
    // Creating a shipment is not idempotent and the call is not reliable:
    // GoShip can accept one and answer slower than the function may wait,
    // leaving a real parcel upstream and an order that never heard. Looking
    // first turns a retry into recovery instead of a second courier.
    if (order) {
        const existing = await goshipFindShipmentByOrderId(order.id);
        if (existing.ok && existing.data?.id) {
            // A recovered booking carries its own price, which is better than
            // a quote: it is what GoShip actually billed.
            const linked = await linkShipmentToOrder(order.id, existing.data, body, null,
                Number((existing.data as { total_fee?: number }).total_fee) || null);
            if (linked) return linked;
            return NextResponse.json({ data: existing.data, gcode: existing.data.id, recovered: true });
        }
    }

    // Price it again before booking, for two reasons that happen to share one
    // call. The seller now pays whatever this costs above what the buyer was
    // charged, so the figure that decides their payout cannot be a number the
    // browser sent. And a rate id that has expired is no longer in the answer,
    // which catches a stale quote before a courier is dispatched rather than
    // after.
    const fresh = await goshipRates({
        from: { city: from.city, district: from.district },
        to: { city: dest.city, district: dest.district },
        parcel,
        declaredValue,
    });
    const priced = fresh.ok ? fresh.rates.find((r) => r.id === rateId) ?? null : null;
    if (fresh.ok && !priced) {
        return NextResponse.json(
            { error: 'Bảng giá đã hết hạn. Bấm xem giá lại rồi đặt.', code: 'stale_rate' },
            { status: 409 },
        );
    }
    if (!fresh.ok) return NextResponse.json({ code: 'shipping_quote_failed' }, { status: 503 });
    if (!priced || !shipmentCarriers(seller?.shipping_carriers).includes(priced.carrierCode)) {
        return NextResponse.json({ code: 'invalid_shipping_carrier' }, { status: 409 });
    }
    const quotedFee = priced?.totalFee ?? null;

    const result = await goshipCreateShipment({
        from: from as never,
        to: dest,
        parcel,
        rateId,
        declaredValue,
        orderId: order?.id,
        note: str(body?.note) || undefined,
    });

    if (!result.ok) {
        // A stale rate is the one failure a seller can act on: quotes expire, so
        // the fix is to price it again rather than to try again.
        const stale = /không tìm thấy dịch vụ|dịch vụ phù hợp/i.test(result.reason);
        console.error('[Book] GoShip create failed:', result.reason);
        return NextResponse.json(
            {
                error: stale
                    ? 'Bảng giá đã hết hạn. Bấm xem giá lại rồi đặt.'
                    : 'Không tạo được vận đơn. Thử lại sau.',
                code: stale ? 'stale_rate' : 'create_failed',
            },
            { status: 502 },
        );
    }

    // GoShip's own code for the shipment. This, not the carrier's number, is
    // what their webhooks are matched on.
    const created = result.data as {
        id?: string; gcode?: string; tracking_number?: string; carrier_short_name?: string;
    };
    const gcode = typeof created?.id === 'string' ? created.id
        : typeof created?.gcode === 'string' ? created.gcode
            : null;

    // A booking that produced no code we can recognise is not a success. The
    // parcel exists upstream and nothing here can match its events, so say so
    // loudly rather than answering 200 with a null — which is how the first
    // real booking got lost.
    if (!gcode) {
        console.error('[Book] No shipment code in GoShip response:', JSON.stringify(created).slice(0, 400));
        return NextResponse.json(
            { error: 'Đã tạo vận đơn nhưng không đọc được mã. Liên hệ hỗ trợ.', code: 'no_gcode' },
            { status: 502 },
        );
    }

    // Same path as recovery, so a fresh booking and a recovered one leave the
    // order in exactly the same state.
    if (order) {
        const linked = await linkShipmentToOrder(order.id, created, body,
            { city: dest.city, district: dest.district, ward: dest.ward }, quotedFee);
        if (linked) return linked;
    }

    return NextResponse.json({ data: result.data, gcode });
}
