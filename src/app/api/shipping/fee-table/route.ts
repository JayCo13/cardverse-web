import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { quoteSellerTiers } from '@/lib/goship-tiers';
import { booksWithCarrier, carrierServesTier, SHIPPING_CARRIERS } from '@/lib/shipping-carriers';
import {
    isValidListingShippingFee,
    LISTING_SHIPPING_FEE_MAX,
    type ShippingTier,
    type ShopFeeTable,
} from '@/lib/shipping-fee';

/**
 * A shop's shipping price list: what the seller charges, and what it costs.
 *
 * Postage only, three cells per carrier. What a carrier adds for declared value
 * is not stored per shop at all — it is the same on every route, so it lives as
 * a measured model in khai-gia.ts and is added at checkout.
 *
 * Two tables, never merged here. `shipping_fees` is what the seller decided and
 * is the only thing this route writes. `goship_tier_fees` is what GoShip quotes
 * for their pickup address and is written only by a re-quote — it is the
 * recommendation the setup page shows behind each empty box, and the fallback
 * checkout uses for a box the seller never filled.
 *
 * Keeping them apart is what lets a seller edit one cell without freezing the
 * other five at today's prices.
 */

const TIERS: readonly ShippingTier[] = ['intra', 'inter', 'region'];

/**
 * Carriers a fee may be set for: the ones a courier is paid for.
 *
 * Hand delivery is not among them and gets no row at all. It is not a price of
 * zero the seller chose — it is the absence of a carrier bill, decided by what
 * the delivery is rather than by what anybody typed, so there is nothing here
 * to fill in and nothing that could be filled in wrong.
 */
const TABLE_CARRIERS = SHIPPING_CARRIERS.filter((c) => c.booksWithCarrier).map((c) => c.code);

/** GoShip prices all of them; the split exists for readers, not for the code. */
const QUOTABLE = TABLE_CARRIERS;

/**
 * Read a table out of a request body.
 *
 * Unknown carriers, tiers and bands are rejected rather than dropped. A silent
 * drop here is a seller watching a number they typed vanish on reload with no
 * reason given, which is worse than being told the shape was wrong.
 */
function parseTable(value: unknown): { ok: true; value: ShopFeeTable } | { ok: false; error: string } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, error: 'Bảng phí không hợp lệ.' };
    }
    const out: ShopFeeTable = {};
    for (const [carrier, tiers] of Object.entries(value as Record<string, unknown>)) {
        if (!TABLE_CARRIERS.includes(carrier as never)) {
            return {
                ok: false,
                error: booksWithCarrier(carrier)
                    ? `Không hỗ trợ đơn vị vận chuyển "${carrier}".`
                    : 'Giao tận tay không có phí để đặt.',
            };
        }
        if (!tiers || typeof tiers !== 'object' || Array.isArray(tiers)) {
            return { ok: false, error: `Bảng phí của ${carrier} không hợp lệ.` };
        }
        const row: ShopFeeTable[string] = {};
        for (const [tier, fee] of Object.entries(tiers as Record<string, unknown>)) {
            if (!TIERS.includes(tier as ShippingTier)) {
                return { ok: false, error: `Không có mức "${tier}".` };
            }
            // A price for a delivery this carrier cannot make is a price nobody
            // can ever be charged — hand delivery outside the seller's own
            // province being the case that exists. Rejected rather than
            // dropped, so a seller is told instead of watching it vanish.
            if (!carrierServesTier(carrier, tier as ShippingTier)) {
                return { ok: false, error: `${carrier} không nhận giao ở mức "${tier}".` };
            }
            // An empty box is an absent cell, not a zero. Zero is free shipping
            // and a seller has to type it on purpose.
            if (fee === null || fee === '') continue;
            const amount = Number(fee);
            if (!isValidListingShippingFee(amount)) {
                return {
                    ok: false,
                    error: `Phí phải là số nguyên từ 0 đến ${LISTING_SHIPPING_FEE_MAX.toLocaleString('vi-VN')}đ.`,
                };
            }
            row[tier as ShippingTier] = amount;
        }
        if (Object.keys(row).length) out[carrier] = row;
    }
    return { ok: true, value: out };
}

function parseCarriers(value: unknown): { ok: true; value: string[] } | { ok: false; error: string } {
    if (!Array.isArray(value)) return { ok: false, error: 'Danh sách đơn vị vận chuyển không hợp lệ.' };
    const codes = [...new Set(value.map((c) => String(c)))];
    const unknown = codes.find((c) => !SHIPPING_CARRIERS.some((sc) => sc.code === c));
    if (unknown) return { ok: false, error: `Không hỗ trợ "${unknown}".` };
    return { ok: true, value: codes };
}

type ShopRow = {
    shipping_carriers: string[] | null;
    shipping_fees: ShopFeeTable | null;
    goship_tier_fees: ShopFeeTable | null;
    goship_tier_fees_at: string | null;
    goship_pickup: { city: string; district: string } | null;
    address_province_name: string | null;
};

const SHOP_COLUMNS = 'shipping_carriers, shipping_fees, goship_tier_fees, goship_tier_fees_at, goship_pickup, address_province_name';

export async function GET() {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase
        .from('profiles')
        .select(SHOP_COLUMNS)
        .eq('id', user.id)
        .single();
    if (error) return NextResponse.json({ error: 'Không đọc được bảng phí.' }, { status: 500 });

    const row = data as unknown as ShopRow;
    return NextResponse.json({
        data: {
            carriers: row.shipping_carriers ?? [],
            fees: row.shipping_fees ?? {},
            recommended: row.goship_tier_fees ?? {},
            recommendedAt: row.goship_tier_fees_at,
            // Without a pickup address there is nothing to quote from, and the
            // page needs to say that rather than show six empty boxes.
            hasPickup: !!row.goship_pickup?.city && !!row.goship_pickup?.district,
        },
    });
}

export async function PUT(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: 'Thiếu dữ liệu.' }, { status: 400 });

    const carriers = parseCarriers(body.carriers ?? []);
    if (!carriers.ok) return NextResponse.json({ error: carriers.error }, { status: 400 });

    const fees = parseTable(body.fees ?? {});
    if (!fees.ok) return NextResponse.json({ error: fees.error }, { status: 400 });

    // Own row only — RLS decides, and the id is never taken from the body.
    const { error } = await supabase
        .from('profiles')
        .update({ shipping_carriers: carriers.value, shipping_fees: fees.value } as never)
        .eq('id', user.id);

    if (error) {
        console.error('[FeeTable] Save failed:', error.message);
        return NextResponse.json({ error: 'Không lưu được bảng phí.' }, { status: 500 });
    }

    return NextResponse.json({ data: { carriers: carriers.value, fees: fees.value } });
}

/**
 * Re-quote the recommendation from the seller's pickup address.
 *
 * Also runs on its own whenever the pickup address is saved; this is the button
 * for the rest of the time, since carrier prices move without anybody moving
 * house. Six upstream calls, so it is a press rather than a page load.
 */
export async function POST() {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase
        .from('profiles')
        .select(SHOP_COLUMNS)
        .eq('id', user.id)
        .single();
    if (error) return NextResponse.json({ error: 'Không đọc được hồ sơ.' }, { status: 500 });

    const row = data as unknown as ShopRow;
    if (!row.goship_pickup?.city || !row.goship_pickup?.district) {
        return NextResponse.json(
            { error: 'Cần địa chỉ lấy hàng trước khi tính giá đề xuất.', code: 'pickup_missing' },
            { status: 409 },
        );
    }

    const quoted = await quoteSellerTiers({
        pickup: { city: row.goship_pickup.city, district: row.goship_pickup.district },
        provinceName: row.address_province_name,
        allowedCarriers: QUOTABLE,
    });

    if (Object.keys(quoted).length === 0) {
        // Upstream said nothing usable. Keep the previous table rather than
        // replacing real numbers with an empty object.
        return NextResponse.json(
            { error: 'GoShip chưa trả về giá nào. Thử lại sau.', code: 'quote_empty' },
            { status: 503 },
        );
    }

    const at = new Date().toISOString();
    const service = createServiceSupabaseClient();
    const { error: writeError } = await service
        .from('profiles')
        .update({ goship_tier_fees: quoted, goship_tier_fees_at: at } as never)
        .eq('id', user.id);

    if (writeError) {
        console.error('[FeeTable] Could not store quote:', writeError.message);
        return NextResponse.json({ error: 'Không lưu được giá đề xuất.' }, { status: 500 });
    }

    return NextResponse.json({ data: { recommended: quoted, recommendedAt: at } });
}
