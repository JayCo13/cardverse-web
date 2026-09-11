import { goshipRates, goshipDistricts, type GoshipRate } from '@/lib/goship';
import { getRegion, type ShippingTier, type ShopFeeTable, type VnRegion } from '@/lib/shipping-fee';

/**
 * Real carrier postage for the three cells a shop's fee table holds.
 *
 * Nội tỉnh, liên tỉnh, liên miền. The tiers are the shape the shop page has
 * always shown; what changed is that the numbers are quoted rather than typed.
 *
 * Quoted at declared value ZERO, deliberately. These are postage, and khai giá
 * is added on top at checkout from the measured model in khai-gia.ts — it
 * depends on what is in the parcel rather than where it goes, so folding it in
 * here would price every card as if it were worth the same.
 *
 * There is no speed dimension because GoShip does not sell one. Quoting /rates
 * for a 200g parcel returns exactly one service per carrier, on every route and
 * every weight tried — "Nhanh" and "Tiêu chuẩn" are two carriers' product names,
 * not two options a buyer picks between. A hoả tốc column here would have to be
 * invented, which is what got the previous fee table deleted.
 *
 * Three requests, not fifteen. A quote returns every carrier at once, so one
 * call per tier prices the whole table — cheap enough to refresh whenever a
 * seller moves.
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

async function quoteCell(
    from: { city: string; district: string },
    to: { city: string; district: string },
    into: ShopFeeTable,
    tier: ShippingTier,
    allowed: ReadonlySet<string>,
) {
    const result = await goshipRates({ from, to, parcel: TIER_PARCEL, declaredValue: 0 });
    if (!result.ok) return;
    for (const rate of result.rates as GoshipRate[]) {
        if (!allowed.has(rate.carrierCode)) continue;
        const carrier = into[rate.carrierCode] ?? (into[rate.carrierCode] = {});
        // Cheapest wins, for the day a carrier does return more than one
        // service: a shop advertises what a parcel can be sent for.
        if (carrier[tier] === undefined || rate.totalFee < (carrier[tier] as number)) {
            carrier[tier] = rate.totalFee;
        }
    }
}

/**
 * Price a whole shop table for one seller.
 *
 * `intra` needs a second district inside the seller's own city; a city with
 * only one is quoted against itself, which is the right answer for it anyway.
 */
export async function quoteSellerTiers(input: {
    pickup: { city: string; district: string };
    /** The seller's province name, to decide which region they are in. */
    provinceName: string | null | undefined;
    /** Carrier codes the app offers, e.g. ['ghn','vnp','shopee','best','jnt']. */
    allowedCarriers: readonly string[];
}): Promise<ShopFeeTable> {
    const prices: ShopFeeTable = {};
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

    const destinations: Record<ShippingTier, { city: string; district: string }> = {
        intra: { city: from.city, district: String(otherDistrict?.id ?? from.district) },
        inter: ANCHORS[region].city === from.city ? ALTERNATES[region] : ANCHORS[region],
        region: region === 'bac' ? ANCHORS.nam : ANCHORS.bac,
    };

    const tiers: ShippingTier[] = ['intra', 'inter', 'region'];
    await Promise.all(tiers.map(tier => quoteCell(from, destinations[tier], prices, tier, allowed)));

    return prices;
}
