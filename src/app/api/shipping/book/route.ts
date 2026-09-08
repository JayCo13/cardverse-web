import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { goshipCreateShipment } from '@/lib/goship';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

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
 * `declaredValue` is required and must be positive. It is sent as GoShip's
 * parcel.amount, which their reference calls khai giá — but a created shipment
 * comes back without it and with insurrance_fee at 0, so it does not currently
 * insure anything. See the note in lib/goship.ts. It stays required because the
 * figure is the right one to hold, not because it protects a parcel today.
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

    // Booking against an order, or standing alone.
    //
    // Standing alone is the test path that proved this flow; an order is what
    // makes a waybill mean anything. When one is named, the caller must be the
    // seller on it and it must be waiting to ship — a second waybill on an
    // order already moving is how two couriers get sent for one card.
    const orderId = str(body?.orderId);
    let order: { id: string; goship_code: string | null } | null = null;
    if (orderId) {
        const { data } = await supabase
            .from('orders')
            .select('id, seller_id, status, goship_code')
            .eq('id', orderId)
            .maybeSingle();
        const row = data as { id: string; seller_id: string; status: string; goship_code: string | null } | null;
        if (!row || row.seller_id !== user.id) {
            return NextResponse.json({ error: 'Không tìm thấy đơn hàng.' }, { status: 404 });
        }
        if (row.goship_code) {
            return NextResponse.json(
                { error: 'Đơn này đã có vận đơn.', code: 'already_booked' },
                { status: 409 },
            );
        }
        if (row.status !== 'paid') {
            return NextResponse.json(
                { error: 'Chỉ tạo vận đơn cho đơn đã thanh toán và chưa gửi.', code: 'not_bookable' },
                { status: 409 },
            );
        }
        order = { id: row.id, goship_code: row.goship_code };
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
    const created = result.data as Record<string, unknown>;
    const gcode = typeof created?.id === 'string' ? created.id
        : typeof created?.gcode === 'string' ? created.gcode
            : null;

    if (order && gcode) {
        // Service role: the seller may write this column on their own order,
        // but the write must not depend on a policy that could change under it.
        const service = createServiceSupabaseClient();
        const { error: linkError } = await service
            .from('orders')
            .update({ goship_code: gcode } as never)
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
