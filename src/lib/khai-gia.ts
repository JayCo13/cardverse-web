/**
 * What a carrier charges to insure a parcel for its declared value.
 *
 * Since 2026-09-12 this is NOT part of what the buyer pays. Khai giá is the
 * sender's insurance — the carrier pays the sender if the parcel is lost — and
 * the buyer is already made whole by escrow. So it is the seller's decision at
 * booking, off by default, and what they choose comes off their own payout
 * (see /api/shipping/book). The models below are kept for two jobs: to show a
 * seller what a declaration will cost before they ask GoShip, and as the
 * fallback when a booking cannot quote the same parcel twice to measure it.
 *
 * Khai giá does not move with distance at all, only with what is inside the
 * box. A 200g card costs 15,385–31,450đ to send anywhere in Vietnam; the same
 * card declared at 10,000,000đ costs up to 55,000đ more than that.
 *
 * MEASURED, not documented. Every figure below came from GoShip's live /rates
 * on 2026-09-10, 200g parcel, both Ho Chi Minh City → Hanoi and inside Ho Chi
 * Minh City, at declared values 0 / 200k / 500k / 600k / 700k / 800k / 900k /
 * 950k / 1M / 2M / 2.4M / 2.5M / 2.6M / 2.9M / 3M / 5M / 10M / 10,000,001 /
 * 11M / 15M / 20M / 30M / 50M / 100M. Three facts fell out of that sweep and
 * all of them are load-bearing:
 *
 *   - The surcharge is IDENTICAL on both routes. GHN adds 14,500đ to a 2.9M
 *     parcel whether it crosses the city or the country. So this is a table per
 *     carrier, not per carrier per tier.
 *   - There is a free allowance, and it is a cliff rather than a taper. GHN,
 *     BEST and J&T charge nothing at 950,000đ and charge a percentage of the
 *     FULL value — not of the excess — from 1,000,000đ. SPX charges nothing at
 *     2,900,000đ and a flat 25,000đ from 3,000,000đ, which does not grow after.
 *   - A rate that holds for ten million does not necessarily hold above it.
 *     BEST doubles to 1% one đồng past 10,000,000đ. Sweep the top of the range,
 *     not just the bottom.
 *
 * Re-measure before trusting this a year from now, and re-measure the moment a
 * carrier is added. `scripts/verify-khai-gia.mts` replays the sweep and prints
 * what disagrees.
 */

/**
 * One band of a carrier's declared-value pricing.
 *
 * `from` is inclusive. The band that applies is the last one the value reaches,
 * and a value below every band costs nothing. `rate` is charged on the WHOLE
 * declared value, not on the part above `from` — that is how all four carriers
 * that charge for it actually behave.
 */
export type KhaiGiaBand = {
    from: number;
    /** Fraction of the whole declared value. */
    rate: number;
    /** Flat amount, on top of any rate. */
    flat: number;
};

export type KhaiGiaModel = KhaiGiaBand[];

/** Carriers not listed here charge nothing, the way VNPost does. */
const MODELS: Record<string, KhaiGiaModel> = {
    // Charges nothing at any declared value — 18,010đ at 0đ and at 100,000,000đ.
    // For a marketplace shipping graded cards that is not a rounding detail, it
    // is the cheapest way to send anything valuable in the country, by an order
    // of magnitude once a card is worth millions.
    vnp: [],

    // A step, not a slope: +25,000đ from exactly 3,000,000đ (2,900,000đ is
    // still free), and still +25,000đ at 100,000,000đ.
    shopee: [{ from: 3_000_000, rate: 0, flat: 25_000 }],

    ghn: [{ from: 1_000_000, rate: 0.005, flat: 0 }],

    // BEST doubles its rate above ten million, and the boundary is exact:
    // 10,000,000đ is charged 50,000đ (0.5%) and 10,000,001đ is charged 100,001đ
    // (1%). Hence the odd `from` — the band starts one đồng over, not at the
    // round number. Missing this cost 100,000đ on a 20,000,000đ card, and it was
    // only caught because the verification sweep was extended past 10,000,000đ.
    // Sweep high when adding a carrier; the rate near zero says nothing about
    // the rate at the top.
    best: [
        { from: 1_000_000, rate: 0.005, flat: 0 },
        { from: 10_000_001, rate: 0.01, flat: 0 },
    ],

    // 0.55% flat, checked to 100,000,000đ with no second band. One đồng above
    // the rate at some values and exactly on it at others — 47,401đ where the
    // rate says 47,400đ, matching to the đồng at 1M, 2M, 5M, 10M and beyond.
    // That is J&T rounding its own arithmetic, not a rate wrong here, and a
    // đồng is absorbed by the surplus the platform already keeps. Padding the
    // rate to swallow it would put every other check over.
    jnt: [{ from: 1_000_000, rate: 0.0055, flat: 0 }],
};

export const khaiGiaModel = (carrier: string): KhaiGiaModel => MODELS[carrier] ?? [];

/**
 * What a declaration actually buys, per carrier, and what proof it takes.
 *
 * Read from the carriers' published compensation policies on 2026-09-12 (SPX's
 * current one took effect 2026-06-27). Every carrier pays the declared value
 * for a lost parcel, but each caps it and each wants a different kind of proof
 * of what the parcel was worth — and that is the part a card seller has to
 * know, because a marketplace order with a bank receipt is proof to SPX, weak
 * proof to J&T, and no proof at all to GHN or BEST, which want an invoice.
 *
 *   - `invoice`      cap when a VAT / sales invoice is produced
 *   - `transaction`  cap when the proof is a transaction screenshot or bank
 *                    receipt matching sender, receiver, goods and value;
 *                    null = not accepted, treated as no proof
 *   - `noProof`      cap with a declaration but nothing to show for it;
 *                    'fee_x4' = four times the postage
 *   - `undeclared`   what a parcel declared at 0 gets
 *
 * Shown to the seller next to the fee so the choice is an informed one — a
 * 50,000đ premium on a 10,000,000đ card that GHN will settle at 5,000,000đ,
 * and only against an invoice, is a decision, not a default.
 */
export type CompensationCap = number | 'fee_x4' | null;

export type CarrierCompensation = {
    invoice: number | null;
    transaction: number | null;
    noProof: CompensationCap;
    undeclared: CompensationCap;
    source: string;
    checkedAt: string;
};

export const CARRIER_COMPENSATION: Record<string, CarrierCompensation> = {
    ghn: {
        invoice: 5_000_000, transaction: null, noProof: 'fee_x4', undeclared: 'fee_x4',
        source: 'https://ghn.vn/pages/chinh-sach-boi-thuong-cua-ghn', checkedAt: '2026-09-12',
    },
    shopee: {
        invoice: 20_000_000, transaction: 20_000_000, noProof: 2_000_000, undeclared: 'fee_x4',
        source: 'https://spx.vn/en/shipping/quy-dinh-boi-thuong.html', checkedAt: '2026-09-12',
    },
    jnt: {
        invoice: 30_000_000, transaction: 1_000_000, noProof: 500_000, undeclared: 'fee_x4',
        source: 'https://jtexpress.vn/vi/chinh-sach', checkedAt: '2026-09-12',
    },
    best: {
        invoice: 10_000_000, transaction: null, noProof: 'fee_x4', undeclared: 1_000_000,
        source: 'https://giaohangtotnhat.vn/chinh-sach-boi-thuong/', checkedAt: '2026-09-12',
    },
};

export const carrierCompensation = (carrier: string): CarrierCompensation | null => CARRIER_COMPENSATION[carrier] ?? null;

/**
 * What the seller would get back for this parcel, by the proof they can show.
 *
 * `declared` is what they typed; `postage` is the carrier's fee, for the
 * "four times the fee" floors. Each figure is min(declared, cap) — a carrier
 * never pays more than was declared.
 */
export function compensationFor(carrier: string, declared: number, postage: number): {
    invoice: number | null; transaction: number | null; noProof: number | null; undeclared: number | null;
} | null {
    const policy = carrierCompensation(carrier);
    if (!policy) return null;
    const value = Math.max(0, Math.round(declared));
    const settle = (cap: CompensationCap, atMostDeclared: boolean): number | null =>
        cap === null ? null
            : cap === 'fee_x4' ? Math.round(postage * 4)
                : atMostDeclared ? Math.min(value, cap) : cap;
    return {
        invoice: policy.invoice === null ? null : Math.min(value, policy.invoice),
        transaction: policy.transaction === null ? null : Math.min(value, policy.transaction),
        noProof: settle(policy.noProof, true),
        undeclared: settle(policy.undeclared, false),
    };
}

/** The band a parcel of this value falls in, or null when it is below them all. */
export const khaiGiaBand = (carrier: string, declaredValue: number): KhaiGiaBand | null => {
    let found: KhaiGiaBand | null = null;
    for (const band of khaiGiaModel(carrier)) {
        if (declaredValue >= band.from) found = band;
    }
    return found;
};

export const khaiGiaSurcharge = (carrier: string, declaredValue: number | null | undefined): number => {
    const value = Math.max(0, Math.round(Number(declaredValue) || 0));
    const band = khaiGiaBand(carrier, value);
    return band ? Math.ceil(value * band.rate) + band.flat : 0;
};

/** Does this carrier ever charge for declared value? Drives what the UI says. */
export const chargesForDeclaredValue = (carrier: string): boolean =>
    khaiGiaModel(carrier).length > 0;
