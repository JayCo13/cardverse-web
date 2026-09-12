import { accountRoute } from '@/lib/account-route';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { goshipCities } from '@/lib/goship';

/**
 * The seller's pickup address — the ONE address a seller sets, in GoShip's
 * geography.
 *
 * There used to be a second one. profiles.address_* held the same physical
 * place in the 2025 structure, entered through a second form, and a seller had
 * to fill in both. They were kept apart for a real reason — a name match
 * between the two structures books a pickup in the wrong city and reports
 * success, because Ho Chi Minh City now contains wards GoShip still files under
 * Bà Rịa - Vũng Tàu — but the conclusion drawn from it was wrong. Nothing ever
 * needed the 2025 version of the seller's own address: tracing every read of
 * those columns found two uses and no third. One is a gate ("does this seller
 * have somewhere to collect from"), the other is picking the distance tier from
 * the province NAME.
 *
 * Both are answered better here. GoShip returns 63 provinces, all of which
 * resolve against the region lists in shipping-fee.ts, because those lists were
 * written in the pre-2025 names to begin with. And the tier exists to predict a
 * carrier bill, which the carrier computes in exactly this geography — a seller
 * whose ward moved into Ho Chi Minh City on paper is still billed as another
 * province, and now quoted as one.
 *
 * So this route writes both: goship_pickup for booking, and the profile columns
 * every existing gate already reads. No translation is involved; the province
 * name is copied from the same list the seller picked their city from.
 *
 * Still separate from /api/shipping-addresses, which is where a user RECEIVES
 * parcels. That one is genuinely a different address, picked from the same
 * GoShip lists and written the same way, so the two ends of a waybill sit in
 * one geography.
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

    // The province name behind the id the seller chose, read from the same list
    // they chose it from. Not a translation and not a guess: if the lookup
    // fails, the name is left alone rather than invented, because it is what
    // decides the distance tier on every order this shop takes.
    const cities = await goshipCities();
    const city = cities.ok
        ? (cities.data as { id: string | number; name: string }[])
            .find((c) => String(c.id) === parsed.value.city)
        : undefined;

    if (!city) {
        // A saved address with no province name would pass the shape checks and
        // then fail every checkout with seller_shipping_origin_missing, which is
        // a worse outcome than being asked to try again.
        console.error('[Pickup] Could not resolve city', parsed.value.city, cities.ok ? 'not in list' : cities.reason);
        return NextResponse.json(
            { error: 'Không xác định được tỉnh/thành từ danh mục của đơn vị vận chuyển. Thử lại sau.' },
            { status: 503 },
        );
    }

    // Own row only — RLS decides, and the id is never taken from the body.
    //
    // The profile columns are written in the same statement as goship_pickup so
    // the two can never disagree about where a shop ships from. They are the
    // carrier's ids, deliberately: city ids are six digits and a 2025 province
    // code is one or two, so resolveShippingTier's id comparison cannot confuse
    // the two code spaces the way it once confused GHN's ids with the official
    // ones.
    const { error } = await supabase
        .from('profiles')
        .update({
            goship_pickup: parsed.value,
            address_province_id: Number(parsed.value.city),
            address_province_name: city.name,
            address_ward_code: parsed.value.ward,
            address_detail: parsed.value.street,
        } as never)
        .eq('id', user.id);

    if (error) {
        console.error('[Pickup] Save failed:', error.message);
        return NextResponse.json({ error: 'Không lưu được địa chỉ lấy hàng.' }, { status: 500 });
    }

    // Nothing to reprice. The shop's price list is the fixed table in
    // shipping-fee.ts, which does not depend on where the parcel leaves from —
    // this used to re-quote GoShip from the new address and write
    // goship_tier_fees, and that column is no longer read by anything.
    return NextResponse.json({ data: parsed.value });
}

export const GET = accountRoute(handleGET);
export const PUT = accountRoute(handlePUT);
