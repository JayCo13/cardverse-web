import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { OFFERABLE_COURIERS } from '@/lib/shipping-carriers';
import { coverageIsFresh, refreshCarrierCoverage, type CarrierCoverage } from '@/lib/carrier-coverage';
import { parseParcelOverrides, type ParcelOverrides } from '@/lib/parcel';

/**
 * The shop's shipping setup: which carriers it ships with, and how it packs.
 *
 * No prices. Postage is GoShip's answer per route, quoted when the buyer picks
 * an address, so the only decisions left to a seller are the ones GoShip
 * cannot make for them — which of the couriers that collect at their door they
 * are willing to hand a parcel to, and (saved from the booking desk) what a
 * parcel of each kind from this shop actually weighs and measures. Both are
 * read by every quote afterwards, which is why the carriers are checked
 * against coverage on save and not merely on display.
 */

type ShopRow = {
    shipping_carriers: string[] | null;
    carrier_coverage: CarrierCoverage | null;
    parcel_overrides: unknown;
    goship_pickup: { city?: string; district?: string } | null;
};

const SHOP_COLUMNS = 'shipping_carriers, carrier_coverage, parcel_overrides, goship_pickup';

async function readShop(userId: string) {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.from('profiles').select(SHOP_COLUMNS).eq('id', userId).single();
    if (error) return null;
    return data as unknown as ShopRow;
}

function shape(row: ShopRow, coverage: CarrierCoverage | null) {
    const offerable = OFFERABLE_COURIERS.map((c) => c.code as string);
    const collects = coverage?.carriers?.length ? offerable.filter((c) => coverage.carriers.includes(c)) : null;
    return {
        carriers: (row.shipping_carriers ?? []).filter((c) => offerable.includes(c) && (!collects || collects.includes(c))),
        // Null means "not probed yet" — the picker offers a button; an array
        // (even empty) is an answer.
        coverage: coverage ? { carriers: coverage.carriers, checked_at: coverage.checked_at } : null,
        parcelOverrides: parseParcelOverrides(row.parcel_overrides),
        hasPickup: !!(row.goship_pickup?.city && row.goship_pickup?.district),
    };
}

export async function GET() {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const row = await readShop(user.id);
    if (!row) return NextResponse.json({ error: 'Không đọc được cấu hình vận chuyển.' }, { status: 500 });

    // Stale coverage is refreshed on read, so a seller who has not opened this
    // page in a month sees today's couriers rather than last month's.
    let coverage = row.carrier_coverage;
    if (!coverageIsFresh(coverage) && row.goship_pickup?.city && row.goship_pickup?.district) {
        coverage = await refreshCarrierCoverage(user.id, { city: row.goship_pickup.city, district: row.goship_pickup.district }) ?? coverage;
    }
    return NextResponse.json({ data: shape(row, coverage) });
}

export async function PUT(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => null) as { carriers?: unknown; parcelOverrides?: unknown } | null;
    if (!body) return NextResponse.json({ error: 'Thiếu dữ liệu.' }, { status: 400 });

    const row = await readShop(user.id);
    if (!row) return NextResponse.json({ error: 'Không đọc được cấu hình vận chuyển.' }, { status: 500 });
    const coverage = row.carrier_coverage;
    const patch: Record<string, unknown> = {};

    // Carriers, when sent: every code offerable, every code collecting here,
    // at least one.
    let codes = row.shipping_carriers ?? [];
    if (body.carriers !== undefined) {
        if (!Array.isArray(body.carriers)) return NextResponse.json({ error: 'Danh sách đơn vị vận chuyển không hợp lệ.' }, { status: 400 });
        const offerable = OFFERABLE_COURIERS.map((c) => c.code as string);
        codes = [...new Set(body.carriers.map((c) => String(c)))];
        const unknown = codes.find((c) => !offerable.includes(c));
        if (unknown) return NextResponse.json({ error: `Không hỗ trợ "${unknown}".` }, { status: 400 });
        const outside = coverage?.carriers?.length ? codes.find((c) => !coverage.carriers.includes(c)) : undefined;
        if (outside) return NextResponse.json({ error: `"${outside}" không lấy hàng tại khu vực của bạn.`, code: 'carrier_not_collecting' }, { status: 400 });
        if (codes.length === 0) return NextResponse.json({ error: 'Chọn ít nhất một đơn vị vận chuyển.', code: 'no_carrier' }, { status: 400 });
        patch.shipping_carriers = codes;
    }

    // Parcel numbers, when sent: merged per kind over what is saved, so the
    // desk can save one kind without knowing the others. Invalid entries are
    // dropped, not refused — a listing must not fail over a parcel size.
    let overrides: ParcelOverrides = parseParcelOverrides(row.parcel_overrides);
    if (body.parcelOverrides !== undefined) {
        overrides = { ...overrides, ...parseParcelOverrides(body.parcelOverrides) };
        patch.parcel_overrides = overrides;
    }

    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Không có gì để lưu.' }, { status: 400 });

    // Own row only — RLS decides, and the id is never taken from the body.
    const { error } = await supabase.from('profiles').update(patch as never).eq('id', user.id);
    if (error) {
        console.error('[ShopShipping] Save failed:', error.message);
        return NextResponse.json({ error: 'Không lưu được cấu hình vận chuyển.' }, { status: 500 });
    }

    return NextResponse.json({ data: shape({ ...row, shipping_carriers: codes, parcel_overrides: overrides }, coverage) });
}
