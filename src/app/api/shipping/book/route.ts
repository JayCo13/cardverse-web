import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { goshipCreateShipment, goshipCarrierToApp } from '@/lib/goship';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { isEvidenceVideoUrl } from '@/lib/evidence-video';

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
const DEFAULT_PARCEL = { weight: 200, width: 15, height: 3, length: 20 };

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
            .select('id, seller_id, status, goship_code, to_goship, to_name, to_phone, to_address_detail')
            .eq('id', orderId)
            .maybeSingle();
        const row = data as {
            id: string; seller_id: string; status: string; goship_code: string | null;
            to_goship: { city?: string; district?: string; ward?: string } | null;
            to_name: string | null; to_phone: string | null; to_address_detail: string | null;
        } | null;

        if (!row || row.seller_id !== user.id) {
            return NextResponse.json({ error: 'Không tìm thấy đơn hàng.' }, { status: 404 });
        }
        if (row.goship_code) {
            return NextResponse.json({ error: 'Đơn này đã có vận đơn.', code: 'already_booked' }, { status: 409 });
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

    const weight = Number(body?.weight);
    const parcel = {
        ...DEFAULT_PARCEL,
        ...(Number.isFinite(weight) && weight > 0 && weight <= 30_000 ? { weight: Math.round(weight) } : {}),
    };

    const { data: profile } = await supabase
        .from('profiles')
        .select('goship_pickup')
        .eq('id', user.id)
        .single();

    const from = (profile as { goship_pickup: Record<string, string> | null } | null)?.goship_pickup;
    if (!from?.city || !from?.district || !from?.ward || !from?.street || !from?.name || !from?.phone) {
        return NextResponse.json(
            { error: 'Bạn cần lưu đầy đủ thông tin người gửi trước khi đặt vận đơn.', code: 'missing_goship_pickup' },
            { status: 409 },
        );
    }

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

    if (order) {
        // Service role: the seller may write this column on their own order,
        // but the write must not depend on a policy that could change under it.
        const service = createServiceSupabaseClient();
        // The packing video rides along with the booking now. It used to be
        // uploaded on the old ship form, which this replaces, and it is what
        // dispute_evidence_verdict reads as the seller's side of the story —
        // losing it with the form would have quietly weakened every dispute.
        const raw = body?.packingVideoUrl;
        const packingVideoUrl = isEvidenceVideoUrl(raw, process.env.CLOUDINARY_CLOUD_NAME)
            ? (raw as string) : null;

        const { error: linkError } = await service
            .from('orders')
            .update({
                goship_code: gcode,
                // Remember the ids for this order, so a retry or a later read
                // does not depend on the form that supplied them.
                to_goship: { city: dest.city, district: dest.district, ward: dest.ward },
                // Both arrive with the booking, so the buyer has a number to
                // look up before any webhook fires.
                ...(created.tracking_number ? { tracking_number: created.tracking_number } : {}),
                ...(created.carrier_short_name
                    ? { shipping_provider: goshipCarrierToApp(created.carrier_short_name) } : {}),
                ...(packingVideoUrl ? { seller_packing_video_url: packingVideoUrl } : {}),
            } as never)
            .eq('id', order.id)
            .is('goship_code', null);

        if (linkError) {
            // The parcel is booked and the order does not know. Loud, with the
            // code in it: a courier is already coming, and this is the only
            // record of which shipment belongs to which order.
            console.error(
                `[Book] ORPHAN SHIPMENT ${gcode} for order ${order.id}: ${linkError.message}`,
            );
            return NextResponse.json(
                { error: 'Đã tạo vận đơn nhưng chưa gắn được vào đơn hàng. Liên hệ hỗ trợ kèm mã ' + gcode, code: 'link_failed', gcode },
                { status: 500 },
            );
        }
    }

    return NextResponse.json({ data: result.data, gcode });
}
