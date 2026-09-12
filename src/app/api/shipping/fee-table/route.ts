import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { carrierServesTier, OFFERABLE_CARRIERS, OFFERABLE_COURIERS } from '@/lib/shipping-carriers';
import {
    DEFAULT_SHOP_TIER_FEES,
    isValidShopTierFee,
    SHOP_TIER_FEE_MAX,
    SHOP_TIER_FEE_MIN,
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
 * `shipping_fees` is what the seller decided and the only thing this route
 * writes. Everything they did not decide is DEFAULT_SHOP_TIER_FEES — the same
 * fixed 20/22/25k this route offers as the recommendation, so an empty box and
 * a box filled from the suggestion are charged identically and a seller cannot
 * be surprised by the difference.
 *
 * Live GoShip quotes used to fill that role and no longer do. They needed a
 * pickup address before any price could be shown, went missing whenever GoShip
 * was unreachable, and moved a seller's prices without telling them.
 */

const TIERS: readonly ShippingTier[] = ['intra', 'inter', 'region'];

/** Carriers a fee may be set for: every one a seller can still offer. */
const TABLE_CARRIERS = OFFERABLE_COURIERS.map((c) => c.code);

/**
 * What every carrier is recommended at, which is the same fixed table for all
 * of them. Built once here so the page, the placeholder and the fallback at
 * checkout are provably the same three numbers.
 */
const RECOMMENDED: ShopFeeTable = Object.fromEntries(
    TABLE_CARRIERS.map((code) => [
        code,
        Object.fromEntries(
            TIERS.filter((tier) => carrierServesTier(code, tier)).map((tier) => [tier, DEFAULT_SHOP_TIER_FEES[tier]]),
        ),
    ]),
);

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
            return { ok: false, error: `Không hỗ trợ đơn vị vận chuyển "${carrier}".` };
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
            // An empty box is an absent cell, and an absent cell is the
            // default — not a zero. Free shipping is a decision a seller makes
            // per listing, where they can see the card it applies to.
            if (fee === null || fee === '') continue;
            const amount = Number(fee);
            if (!isValidShopTierFee(amount)) {
                return {
                    ok: false,
                    error: `Phí phải từ ${SHOP_TIER_FEE_MIN.toLocaleString('vi-VN')}đ đến ${SHOP_TIER_FEE_MAX.toLocaleString('vi-VN')}đ.`,
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
    const unknown = codes.find((c) => !OFFERABLE_CARRIERS.some((sc) => sc.code === c));
    if (unknown) return { ok: false, error: `Không hỗ trợ "${unknown}".` };

    return { ok: true, value: codes };
}

type ShopRow = {
    shipping_carriers: string[] | null;
    shipping_fees: ShopFeeTable | null;
};

const SHOP_COLUMNS = 'shipping_carriers, shipping_fees';

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

    // Rows written before a carrier was retired still carry it — `vtp` from the
    // first list, `vnp` and `best` since. Both the picker and the price list are
    // filtered on the way out: an unfiltered fee row would be invisible on the
    // page and still ride back up on the next save, where parseTable rejects it
    // and the seller watches a save fail over a carrier they cannot even see.
    const offered = (codes: string[]) => codes.filter(code => OFFERABLE_CARRIERS.some(carrier => carrier.code === code));

    return NextResponse.json({
        data: {
            carriers: offered(row.shipping_carriers ?? []),
            // Cells outside today's band are dropped the same way, and for the
            // same reason: shopFeeCell already refuses to charge them, so
            // showing one would print a number the checkout does not use.
            fees: Object.fromEntries(
                Object.entries(row.shipping_fees ?? {})
                    .filter(([code]) => offered([code]).length)
                    .map(([code, tiers]) => [
                        code,
                        Object.fromEntries(Object.entries(tiers ?? {}).filter(([, fee]) => isValidShopTierFee(fee))),
                    ])
                    .filter(([, tiers]) => Object.keys(tiers).length > 0),
            ),
            recommended: RECOMMENDED,
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
