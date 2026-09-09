import { accountRoute } from '@/lib/account-route';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getRouteUser } from '@/lib/supabase/route-user';
import { findProvince, findWard } from '@/lib/vn-address';

type AddressBody = {
    recipient_name?: string;
    phone?: string;
    province_id?: number;
    province_name?: string;
    /** @deprecated No district level since 1/7/2025. Null on anything saved now. */
    district_id?: number | null;
    /** @deprecated See `district_id`. */
    district_name?: string | null;
    ward_code?: string;
    ward_name?: string;
    detail?: string;
    is_default?: boolean;
    /**
     * GoShip's own city/district/ward ids for this address.
     *
     * Optional, and never derived from the fields above. GoShip routes on the
     * pre-2025 structure while those are the 34-province one, and Ho Chi Minh
     * City now contains wards GoShip still files under a province of their own
     * — so a translated id books a courier to the wrong city and reports
     * success. Present only when the buyer picked it from GoShip's own lists.
     */
    goship?: { city?: string; district?: string; ward?: string } | null;
};

const GOSHIP_ID = /^[0-9]{1,12}$/;

/** Null unless all three ids are there and well formed — a half address is worse
 *  than none, because it looks bookable. */
function normalizeGoship(input: AddressBody['goship']): { city: string; district: string; ward: string } | null {
    if (!input || typeof input !== 'object') return null;
    const city = String(input.city ?? '').trim();
    const district = String(input.district ?? '').trim();
    const ward = String(input.ward ?? '').trim();
    if (!GOSHIP_ID.test(city) || !GOSHIP_ID.test(district) || !GOSHIP_ID.test(ward)) return null;
    return { city, district, ward };
}

function validate(body: AddressBody): string | null {
    if (!body.recipient_name?.trim()) return 'Tên người nhận là bắt buộc';
    if (!body.phone?.trim()) return 'Số điện thoại là bắt buộc';
    // Two levels, not three: the district tier was abolished on 1/7/2025.
    if (!body.province_id || !body.ward_code) return 'Vui lòng chọn đầy đủ Tỉnh/Phường xã';
    if (!findProvince(body.province_id) || !findWard(body.province_id, body.ward_code)) {
        return 'Địa chỉ dùng mã hành chính cũ hoặc Phường/Xã không thuộc Tỉnh/Thành đã chọn';
    }
    if (!body.detail?.trim()) return 'Vui lòng nhập địa chỉ chi tiết';
    return null;
}

// GET — list the current user's saved addresses (default first, then newest).
async function handleGET() {
    const supabase = await createServerSupabaseClient();
    const user = await getRouteUser(supabase);
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
        .from('shipping_addresses')
        .select('*')
        .eq('user_id', user.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ addresses: data ?? [] });
}

// POST — create a new address. The first address (or one flagged is_default)
// becomes the default; setting a new default clears the previous one.
async function handlePOST(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as AddressBody;
    const validationError = validate(body);
    if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const province = findProvince(body.province_id)!;
    const ward = findWard(body.province_id, body.ward_code)!;

    const { count } = await supabase
        .from('shipping_addresses')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

    const makeDefault = body.is_default === true || (count ?? 0) === 0;

    if (makeDefault) {
        await supabase
            .from('shipping_addresses')
            .update({ is_default: false } as never)
            .eq('user_id', user.id)
            .eq('is_default', true);
    }

    const { data, error } = await supabase
        .from('shipping_addresses')
        .insert({
            user_id: user.id,
            recipient_name: body.recipient_name!.trim(),
            phone: body.phone!.trim(),
            province_id: province.code,
            province_name: province.name,
            // Null rather than an empty string: these columns now record that
            // an address predates the reorganisation, and '' would claim the
            // address has a district whose name nobody wrote down.
            district_id: null,
            district_name: null,
            ward_code: ward.code.toString(),
            ward_name: ward.name,
            detail: body.detail!.trim(),
            goship: normalizeGoship(body.goship),
            is_default: makeDefault,
        } as never)
        .select('*')
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ address: data }, { status: 201 });
}

export const GET = accountRoute(handleGET);
export const POST = accountRoute(handlePOST);
