import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { goshipRates } from '@/lib/goship';

/**
 * What the carriers would charge to send this seller's parcel to that address.
 *
 * Origin comes from the caller's saved pickup address rather than from the
 * request: a seller quoting from someone else's warehouse would get a price
 * they cannot honour, and the address is a stored fact about them anyway.
 * Destination is passed in, because a quote is wanted before an order exists —
 * a buyer wants the price while choosing where to send it.
 *
 * Both are GoShip's ids, at both ends. Not the app's: GoShip routes on the
 * pre-2025 structure, and Ho Chi Minh City now contains wards that GoShip files
 * under a province of its own, so a translated id quotes the wrong route.
 *
 * Quotes are not stored. GoShip's rate ids are the token you hand back when
 * booking and they go stale, so the price shown and the price booked have to
 * come from the same round trip.
 */

const ID = /^[0-9]{1,12}$/;

/** A slabbed card in a bubble mailer. Carriers bill by volumetric weight too,
 *  so the box matters as much as the grams. */
const DEFAULT_PARCEL = { weight: 200, width: 15, height: 3, length: 20 };

export async function POST(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => null) as {
        to?: { city?: unknown; district?: unknown };
        weight?: unknown;
        declaredValue?: unknown;
    } | null;

    const toCity = typeof body?.to?.city === 'string' ? body.to.city.trim() : '';
    const toDistrict = typeof body?.to?.district === 'string' ? body.to.district.trim() : '';
    if (!ID.test(toCity) || !ID.test(toDistrict)) {
        return NextResponse.json({ error: 'Thiếu tỉnh/thành hoặc quận/huyện của người nhận.' }, { status: 400 });
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

    const pickup = (profile as { goship_pickup: { city?: string; district?: string } | null } | null)?.goship_pickup;
    if (!pickup?.city || !pickup?.district) {
        return NextResponse.json(
            { error: 'Bạn cần lưu địa chỉ lấy hàng theo đơn vị vận chuyển trước.', code: 'missing_goship_pickup' },
            { status: 409 },
        );
    }

    // Quoted with the declared value, because the carrier charges for it: a
    // price shown without one is not the price of a booking made with one.
    const declaredValue = Number(body?.declaredValue);
    const result = await goshipRates({
        from: { city: pickup.city, district: pickup.district },
        to: { city: toCity, district: toDistrict },
        parcel,
        declaredValue: Number.isFinite(declaredValue) && declaredValue > 0 ? declaredValue : 0,
    });

    if (!result.ok) {
        console.error('[Quote] GoShip rates failed:', result.reason);
        return NextResponse.json({ error: 'Không lấy được bảng giá vận chuyển.' }, { status: 502 });
    }

    // An empty list is a route nobody serves, which is a different answer from
    // a failed lookup and has to read differently to whoever is choosing.
    return NextResponse.json({ data: result.rates, servable: result.rates.length > 0 });
}
