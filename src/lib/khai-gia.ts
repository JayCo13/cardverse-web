/**
 * What a carrier charges to insure a parcel for its declared value.
 *
 * Khai giá is the second half of a shipping bill and the half the tier table
 * cannot see: it does not move with distance at all, only with what is inside
 * the box. A 200g card costs 15,385–31,450đ to send anywhere in Vietnam; the
 * same card declared at 10,000,000đ costs up to 55,000đ more than that.
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
 * Below this declared value, no carrier charges anything.
 *
 * Derived rather than typed, so it cannot drift from the table above. Used by
 * the listing form to decide whether a flat, all-in shipping price is a risk
 * worth warning about.
 */
export const KHAI_GIA_FREE_ALLOWANCE = Math.min(
    ...Object.values(MODELS).flatMap((bands) => (bands.length ? [bands[0].from] : [])),
);

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
