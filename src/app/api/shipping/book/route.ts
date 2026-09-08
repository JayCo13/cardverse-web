import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { goshipCreateShipment } from '@/lib/goship';

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
 * `declaredValue` is required and must be positive. It is GoShip's parcel.amount
 * — khai giá — and it is what the carrier pays if the parcel is lost. Zero is
 * the API's default, which on a marketplace selling cards worth millions of
 * đồng would insure one at nothing.
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
            { error: 'Khai giá phải lớn hơn 0 — đây là số tiền hãng đền nếu mất hàng.' },
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
        orderId: str(body?.orderId) || undefined,
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

    return NextResponse.json({ data: result.data });
}
