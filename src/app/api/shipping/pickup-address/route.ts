import { accountRoute } from '@/lib/account-route';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * The seller's pickup address, in GoShip's geography.
 *
 * Separate from /api/shipping-addresses, which stores where a buyer receives
 * things in the 2025 structure — 34 provinces, no districts. This one holds
 * GoShip's pre-2025 ids and exists only to dispatch a courier. The two are
 * never joined: Ho Chi Minh City now contains wards named Bà Rịa and Vũng Tàu
 * that GoShip still files under a province of their own, so a name match books
 * a pickup in the wrong city and reports success.
 *
 * Values must come from /api/shipping/address/*, which proxies GoShip's own
 * lists. The database has a CHECK on the shape, but shape is all it can see: an
 * id from the app's own tables is digits too, so it is the source that makes
 * this correct, not the constraint.
 */

type Pickup = {
    city: string;
    district: string;
    ward: string;
    street: string;
    name: string;
    phone: string;
};

const ID = /^[0-9]{1,12}$/;
/** Vietnamese mobile numbers, the only kind a carrier will call. */
const PHONE = /^0[0-9]{8,10}$/;

function parse(body: unknown): { ok: true; value: Pickup } | { ok: false; error: string } {
    if (!body || typeof body !== 'object') return { ok: false, error: 'Thiếu dữ liệu địa chỉ.' };
    const b = body as Record<string, unknown>;
    const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');

    const value: Pickup = {
        city: str('city'),
        district: str('district'),
        ward: str('ward'),
        street: str('street'),
        name: str('name'),
        phone: str('phone').replace(/\s+/g, ''),
    };

    if (!ID.test(value.city)) return { ok: false, error: 'Chưa chọn tỉnh/thành.' };
    if (!ID.test(value.district)) return { ok: false, error: 'Chưa chọn quận/huyện.' };
    if (!ID.test(value.ward)) return { ok: false, error: 'Chưa chọn phường/xã.' };
    if (value.street.length < 1 || value.street.length > 255) {
        return { ok: false, error: 'Địa chỉ cụ thể cần 1-255 ký tự.' };
    }
    if (value.name.length < 1 || value.name.length > 120) {
        return { ok: false, error: 'Tên người gửi cần 1-120 ký tự.' };
    }
    if (!PHONE.test(value.phone)) {
        return { ok: false, error: 'Số điện thoại không hợp lệ (bắt đầu bằng 0, 9-11 chữ số).' };
    }
    return { ok: true, value };
}

async function handleGET() {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase
        .from('profiles')
        .select('goship_pickup')
        .eq('id', user.id)
        .single();
    if (error) return NextResponse.json({ error: 'Không đọc được địa chỉ lấy hàng.' }, { status: 500 });

    return NextResponse.json({ data: (data as { goship_pickup: Pickup | null }).goship_pickup });
}

async function handlePUT(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = parse(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    // Own row only — RLS decides, and the id is never taken from the body.
    const { error } = await supabase
        .from('profiles')
        .update({ goship_pickup: parsed.value } as never)
        .eq('id', user.id);

    if (error) {
        console.error('[Pickup] Save failed:', error.message);
        return NextResponse.json({ error: 'Không lưu được địa chỉ lấy hàng.' }, { status: 500 });
    }
    return NextResponse.json({ data: parsed.value });
}

export const GET = accountRoute(handleGET);
export const PUT = accountRoute(handlePUT);
