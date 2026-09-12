import { khaiGiaSurcharge } from '@/lib/khai-gia';
import { booksWithCarrier, carrierServesTier, OFFERABLE_COURIERS } from '@/lib/shipping-carriers';
import {
    DEFAULT_SHOP_TIER_FEES,
    isValidListingShippingFee,
    shopFeeCell,
    type ShippingTier,
    type ShopFeeTable,
} from '@/lib/shipping-fee';

/**
 * What a listing's shipping might cost, before anybody knows where it is going.
 *
 * A grid cannot name one number and be telling the truth. The price depends on
 * how far the parcel goes and what the card is worth, and neither is known
 * before checkout: the shop's own table already spans three distances, and khai
 * giá adds more on top of each of them for a dear card.
 *
 * So this returns the span, and the exact figure is quoted at checkout against
 * the buyer's own address by the resolver that bills the order. Both read the
 * same cells through the same shopFeeCell, so the span a buyer is shown always
 * contains the number they are charged.
 *
 * Hand delivery was left out of this span for exactly one reason — a 0đ start
 * advertises to the whole country a price only the seller's own province could
 * have — and that reason is why it was retired from checkout altogether on
 * 2026-09-11: the span and the charge could not both be true.
 */

const TIERS: readonly ShippingTier[] = ['intra', 'inter', 'region'];

const COURIERS: readonly string[] = OFFERABLE_COURIERS.map((c) => c.code);

export type ShippingRange = { min: number; max: number };

export function shopShippingRange(input: {
    /** What the seller set, cell by cell; anything absent is the default. */
    set?: ShopFeeTable | null;
    /** The carriers this shop offers; empty means it has expressed no preference. */
    carriers?: readonly string[] | null;
    /** The card's price, which is what khai giá is charged on. */
    declaredValue?: number | null;
}): ShippingRange | null {
    // An empty list is no preference, not no carriers: the whole bookable set
    // applies, the same way checkout resolves it. A shop whose saved list has
    // nothing offerable left in it — everything it ticked has since been
    // retired — lands here too, and for the same reason.
    const offered = (input.carriers ?? []).filter((code) => booksWithCarrier(code) && COURIERS.includes(code));
    const carriers = offered.length ? offered : COURIERS;

    const prices: number[] = [];
    for (const carrier of carriers) {
        const khaiGia = khaiGiaSurcharge(carrier, input.declaredValue ?? 0);
        for (const tier of TIERS) {
            if (!carrierServesTier(carrier, tier)) continue;
            // Every cell has a price now: the seller's, or the fixed default
            // for that distance. There is no longer an unpriced shop, so the
            // grid never has to say "tính khi thanh toán" for want of a quote.
            prices.push((shopFeeCell(input.set, carrier, tier) ?? DEFAULT_SHOP_TIER_FEES[tier]) + khaiGia);
        }
    }

    if (prices.length === 0) return null;
    return { min: Math.min(...prices), max: Math.max(...prices) };
}

/**
 * The same question for one listing, which may have overridden the whole table.
 *
 * A listing with its own flat price has no range — that is the point of setting
 * one — so it comes back as a span of zero width and the caller prints a single
 * figure. Null means nothing can be said yet.
 */
export function listingShippingRange(input: {
    listingFee?: number | null;
    set?: ShopFeeTable | null;
    carriers?: readonly string[] | null;
    declaredValue?: number | null;
}): ShippingRange | null {
    if (isValidListingShippingFee(input.listingFee)) {
        return { min: input.listingFee, max: input.listingFee };
    }
    return shopShippingRange(input);
}

/** `15.400 – 26.200đ`, or `15.400đ` when there is nothing to vary. */
export const formatShippingRange = (
    range: ShippingRange,
    locale: string,
    freeLabel: string,
): string => {
    const money = (n: number) => new Intl.NumberFormat(locale).format(n) + 'đ';
    if (range.min === range.max) return range.min === 0 ? freeLabel : money(range.min);
    return `${new Intl.NumberFormat(locale).format(range.min)} – ${money(range.max)}`;
};

/**
 * The span for one seller's parcel, when several cards are going in it.
 *
 * Same rule the server bills by: one parcel per seller, priced at the dearest
 * of its cards. Applied once per candidate price rather than once overall,
 * because a listing that overrode the table with a flat 30,000đ outranks a
 * cheap carrier and not a dear one — collapsing that first would report a range
 * the checkout will never land in.
 */
export function parcelShippingRange(input: {
    cards: { listingFee?: number | null; price?: number | null }[];
    set?: ShopFeeTable | null;
    carriers?: readonly string[] | null;
}): ShippingRange | null {
    if (input.cards.length === 0) return null;

    // Khai giá is charged on what the whole parcel declares, not per card.
    const declaredValue = input.cards.reduce((sum, card) => sum + Number(card.price ?? 0), 0);
    const overrides = input.cards.map((card) => card.listingFee);

    // Every card priced itself, so no table is consulted and there is no span.
    if (overrides.every((fee) => isValidListingShippingFee(fee))) {
        const fee = Math.max(...(overrides as number[]));
        return { min: fee, max: fee };
    }

    const span = shopShippingRange({ ...input, declaredValue });
    if (!span) return null;

    const atCandidate = (candidate: number) =>
        Math.max(...overrides.map((fee) => (isValidListingShippingFee(fee) ? fee : candidate)));

    return { min: atCandidate(span.min), max: atCandidate(span.max) };
}
