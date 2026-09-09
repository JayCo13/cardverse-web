import { goshipRates, goshipDistricts, type GoshipRate } from '@/lib/goship';
import { getRegion, type ShippingTier, type VnRegion } from '@/lib/shipping-fee';

/**
 * Real carrier prices for the three tiers a listing already advertises.
 *
 * The shop page has always shown a fee per carrier per tier — nội tỉnh, ngoại
 * tỉnh, liên miền — with the seller typing nine numbers they guessed. The tiers
 * are the right shape; only the numbers were invented. This fills them from
 * GoShip instead, so the range on a listing is what the parcel will actually
 * cost rather than what somebody hoped.
 *
 * Three requests, not sixty-three. A quote returns every carrier at once, so
 * one call per tier prices the whole table — which is what makes it cheap
 * enough to refresh whenever a seller moves.
 *
 * The destinations are stand-ins, and that is the honest limit of this: a tier
 * is a band, and a real delivery inside it can cost a little more or less. The
 * exact price is quoted again at checkout against the buyer's own address, and
 * that is the one anybody pays.
 */

/** One well-connected district per region, to price a tier against. */
const ANCHORS: Record<VnRegion, { city: string; district: string; name: string }> = {
    bac:   { city: '100000', district: '100300', name: 'Hà Nội' },
    trung: { city: '550000', district: '550100', name: 'Đà Nẵng' },
    nam:   { city: '700000', district: '700100', name: 'Hồ Chí Minh' },
};

/** A second choice per region, for a seller who lives in the first. */
const ALTERNATES: Record<VnRegion, { city: string; district: string; name: string }> = {
    bac:   { city: '460000', district: '460900', name: 'Nghệ An' },
    trung: { city: '460000', district: '460900', name: 'Nghệ An' },
    nam:   { city: '900000', district: '900100', name: 'Cần Thơ' },
};

/** A slabbed card in a bubble mailer — the parcel this marketplace ships. */
const TIER_PARCEL = { weight: 200, width: 15, height: 3, length: 20 };

export type TierFees = Partial<Record<ShippingTier, number>>;

/**
 * Prices per carrier, keyed by the app's own carrier codes.
 *
 * Carriers GoShip reaches but the app does not offer are dropped here rather
 * than shown: a fee for a carrier a seller cannot pick is noise on a listing.
 */
export type SellerTierPrices = Record<string, TierFees>;

async function quoteTier(
    from: { city: string; district: string },
    to: { city: string; district: string },
    into: SellerTierPrices,
    tier: ShippingTier,
    allowed: ReadonlySet<string>,
) {
    const result = await goshipRates({ from, to, parcel: TIER_PARCEL });
    if (!result.ok) return;
    for (const rate of result.rates as GoshipRate[]) {
        if (!allowed.has(rate.carrierCode)) continue;
        const row = into[rate.carrierCode] ?? (into[rate.carrierCode] = {});
        // Cheapest service wins: a listing advertises what it can be sent for,
        // not what the most expensive option would cost.
        if (row[tier] === undefined || rate.totalFee < (row[tier] as number)) {
            row[tier] = rate.totalFee;
        }
    }
}

/**
 * Price all three tiers for one seller.
 *
 * `intra` needs a second district inside the seller's own city; a city with
 * only one is quoted against itself, which is the right answer for it anyway.
 */
export async function quoteSellerTiers(input: {
    pickup: { city: string; district: string };
    /** The seller's province name, to decide which region they are in. */
    provinceName: string | null | undefined;
    /** Carrier codes the app offers, e.g. ['ghn','vtp','shopee']. */
    allowedCarriers: readonly string[];
}): Promise<SellerTierPrices> {
    const prices: SellerTierPrices = {};
    const allowed = new Set(input.allowedCarriers);
    const from = input.pickup;

    // Region drives which anchors count as "same region" and "another region".
    // An unknown province name falls back to the south, where most sellers are;
    // the tier bands are wide enough that a wrong guess costs accuracy, not
    // correctness, and checkout re-quotes the real route regardless.
    const region: VnRegion = getRegion(input.provinceName) ?? 'nam';

    const districts = await goshipDistricts(from.city);
    const otherDistrict = districts.ok
        ? districts.data.find((d) => String(d.id) !== from.district)
        : undefined;

    const sameRegion = ANCHORS[region].city === from.city ? ALTERNATES[region] : ANCHORS[region];
    const otherRegion = region === 'bac' ? ANCHORS.nam : ANCHORS.bac;

    await Promise.all([
        quoteTier(from, { city: from.city, district: String(otherDistrict?.id ?? from.district) }, prices, 'intra', allowed),
        quoteTier(from, sameRegion, prices, 'inter', allowed),
        quoteTier(from, otherRegion, prices, 'region', allowed),
    ]);

    return prices;
}
