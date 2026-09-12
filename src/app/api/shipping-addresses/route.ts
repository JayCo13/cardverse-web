import { accountRoute } from '@/lib/account-route';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getRouteUser } from '@/lib/supabase/route-user';
import { GOSHIP_REGION_ERROR, parseGoshipRegion, resolveGoshipRegion } from '@/lib/goship-region';

/**
 * Where a user RECEIVES parcels, in GoShip's geography.
 *
 * The buyer picks their address from the same three lists the seller picks
 * theirs from (/api/shipping/address/*), so both ends of a waybill sit in one
 * geography and there is nothing to translate. The province/ward columns are
 * copied from those lists — the city id and its name, the ward id and its
 * name — exactly as /api/shipping/pickup-address does for the seller, which is
 * what lets resolveShippingTier compare the two by id or by name.
 *
 * It used to collect the 2025 structure (34 provinces, no district) and keep
 * GoShip's ids as an optional extra. A buyer who skipped the extra could not
 * have a waybill booked, and the two structures beside each other on one row
 * invited the one thing that must never happen: deriving one from the other.
 * Ho Chi Minh City now contains wards GoShip still files under Bà Rịa - Vũng
 * Tàu, so a name match books a courier to the wrong city and reports success.
 */

type AddressBody = {
    recipient_name?: string;
    phone?: string;
    /** GoShip's city/district/ward ids, from /api/shipping/address/*. */
    goship?: { city?: string; district?: string; ward?: string } | null;
    detail?: string;
    is_default?: boolean;
};

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

    const body = (await request.json().catch(() => ({}))) as AddressBody;
    if (!body.recipient_name?.trim()) return NextResponse.json({ error: 'Tên người nhận là bắt buộc' }, { status: 400 });
    if (!body.phone?.trim()) return NextResponse.json({ error: 'Số điện thoại là bắt buộc' }, { status: 400 });
    const region = parseGoshipRegion(body.goship);
    if (!region) return NextResponse.json({ error: 'Vui lòng chọn đầy đủ Tỉnh/Thành, Quận/Huyện, Phường/Xã' }, { status: 400 });
    if (!body.detail?.trim()) return NextResponse.json({ error: 'Vui lòng nhập địa chỉ chi tiết' }, { status: 400 });

    const resolved = await resolveGoshipRegion(region);
    if (!resolved.ok) {
        return NextResponse.json(
            { error: GOSHIP_REGION_ERROR[resolved.reason] },
            { status: resolved.reason === 'unavailable' ? 503 : 400 },
        );
    }

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
            recipient_name: body.recipient_name.trim(),
            phone: body.phone.trim(),
            // The carrier's ids, deliberately: a GoShip city id is six digits
            // and a 2025 province code one or two, so the two code spaces
            // cannot be confused when resolveShippingTier compares ids.
            province_id: Number(resolved.value.city),
            province_name: resolved.value.cityName,
            district_id: Number(resolved.value.district),
            district_name: resolved.value.districtName,
            ward_code: resolved.value.ward,
            ward_name: resolved.value.wardName,
            detail: body.detail.trim(),
            goship: region,
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
