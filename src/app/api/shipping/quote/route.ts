import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { goshipRates, type GoshipRate } from '@/lib/goship';
import { parcelFor, parcelPresetOr, parseParcel, parseParcelOverrides, parcelCopy, type Parcel } from '@/lib/parcel';
import { getRequestLocale } from '@/lib/request-localization';
import { shipmentCarriers } from '@/lib/shipment-carriers';

/**
 * What the carriers would charge to send this seller's parcel to that address.
 *
 * Origin comes from the caller's saved pickup address rather than from the
 * request: a seller quoting from someone else's warehouse would get a price
 * they cannot honour, and the address is a stored fact about them anyway.
 * Destination is passed in, or read from the order when there is one.
 *
 * Both are GoShip's ids, at both ends. Not the app's: GoShip routes on the
 * pre-2025 structure, and Ho Chi Minh City now contains wards that GoShip files
 * under a province of its own, so a translated id quotes the wrong route.
 *
 * For an order, three quotes come back so the desk can show the seller what
 * each of their choices costs THEM, not just the total:
 *   - `data`     the parcel and declared value they have chosen now;
 *   - `baseline` the same parcel declared at 0 — the difference is khai giá;
 *   - `original` the parcel the buyer was quoted for, declared at 0 — the
 *                difference from baseline is the parcel upgrade, when any.
 * Rate ids go stale, so the price shown and the price booked come from the
 * same round trip: the booking route quotes again.
 */

const ID = /^[0-9]{1,12}$/;

type OrderRow = {
    to_goship: { city?: string; district?: string; ward?: string } | null;
    status: string;
    goship_code: string | null;
    parcel_preset: string | null;
    card: { product_kind: string | null } | null;
};

export async function POST(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => null) as {
        orderId?: string;
        to?: { city?: unknown; district?: unknown };
        weight?: unknown;
        width?: unknown; height?: unknown; length?: unknown;
        declaredValue?: unknown;
    } | null;

    let destination = body?.to;
    let order: OrderRow | null = null;
    if (body?.orderId) {
        const { data, error } = await supabase.from('orders')
            .select('to_goship,status,goship_code,parcel_preset,card:cards(product_kind)')
            .eq('id', body.orderId).eq('seller_id', user.id).maybeSingle();
        if (error) return NextResponse.json({ code: 'preparation_failed' }, { status: 503 });
        order = data as unknown as OrderRow | null;
        if (!order) return NextResponse.json({ code: 'order_not_found' }, { status: 404 });
        if (order.status !== 'paid' || order.goship_code) return NextResponse.json({ code: 'not_bookable' }, { status: 409 });
        destination = order.to_goship as typeof destination;
    }
    const toCity = typeof destination?.city === 'string' ? destination.city.trim() : '';
    const toDistrict = typeof destination?.district === 'string' ? destination.district.trim() : '';
    if (!ID.test(toCity) || !ID.test(toDistrict)) {
        return NextResponse.json({ error: 'Thiếu tỉnh/thành hoặc quận/huyện của người nhận.' }, { status: 400 });
    }

    // The parcel as the seller has it in front of them: grams and centimetres,
    // prefilled by the desk from the kind's default or their saved numbers and
    // editable, so what is quoted is what they typed.
    const parcel: Parcel | null = parseParcel(body, !!body?.orderId);
    if (!parcel) return NextResponse.json({ error: parcelCopy(getRequestLocale(request)).invalid }, { status: 400 });

    const { data: profile } = await supabase
        .from('profiles')
        .select('goship_pickup,shipping_carriers,carrier_coverage,parcel_overrides')
        .eq('id', user.id)
        .single();

    const seller = profile as {
        goship_pickup: { city?: string; district?: string } | null;
        shipping_carriers: string[] | null;
        carrier_coverage: { carriers?: string[] } | null;
        parcel_overrides: unknown;
    } | null;
    const pickup = seller?.goship_pickup;
    if (!pickup?.city || !pickup?.district) {
        return NextResponse.json(
            { error: 'Bạn cần lưu địa chỉ lấy hàng theo đơn vị vận chuyển trước.', code: 'missing_goship_pickup' },
            { status: 409 },
        );
    }

    const from = { city: pickup.city, district: pickup.district };
    const to = { city: toCity, district: toDistrict };
    const declared = Number(body?.declaredValue);
    const declaredValue = Number.isFinite(declared) && declared > 0 ? Math.round(declared) : 0;

    // The parcel the buyer paid for: the kind the order was priced as (or the
    // listing's kind, for orders that predate the column), in the seller's
    // saved numbers if any. Only quoted when the seller has moved off it — the
    // same numbers now booked have nothing to compare.
    const orderParcel = order
        ? parcelFor(parcelPresetOr(order.parcel_preset, parcelPresetOr(order.card?.product_kind)), 1, parseParcelOverrides(seller?.parcel_overrides))
        : null;
    const parcelChanged = !!orderParcel && JSON.stringify(orderParcel) !== JSON.stringify(parcel);

    const [current, baseline, original] = await Promise.all([
        goshipRates({ from, to, parcel, declaredValue }),
        declaredValue > 0 ? goshipRates({ from, to, parcel, declaredValue: 0 }) : Promise.resolve(null),
        parcelChanged ? goshipRates({ from, to, parcel: orderParcel!, declaredValue: 0 }) : Promise.resolve(null),
    ]);

    if (!current.ok) {
        console.error('[Quote] GoShip rates failed:', current.reason);
        return NextResponse.json({ error: 'Không lấy được bảng giá vận chuyển.' }, { status: 502 });
    }

    // An empty list is a route nobody serves, which is a different answer from
    // a failed lookup and has to read differently to whoever is choosing.
    const allowed = shipmentCarriers(seller?.shipping_carriers, seller?.carrier_coverage);
    const keep = (rates: GoshipRate[]) => (body?.orderId ? rates.filter((rate) => allowed.includes(rate.carrierCode)) : rates);
    const rates = keep(current.rates);
    return NextResponse.json({
        data: rates,
        baseline: baseline?.ok ? keep(baseline.rates) : rates,
        original: original?.ok ? keep(original.rates) : null,
        servable: rates.length > 0,
    });
}
