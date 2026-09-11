import { khaiGiaSurcharge } from '@/lib/khai-gia';
import { booksWithCarrier, carrierServesTier, SHIPPING_CARRIERS } from '@/lib/shipping-carriers';
import { isValidListingShippingFee, type ShippingTier, type ShopFeeTable } from '@/lib/shipping-fee';

/**
 * What a listing's shipping might cost, before anybody knows where it is going.
 *
 * A grid cannot name one number and be telling the truth. The price depends on
 * how far the parcel goes, which carrier the buyer picks, and what the card is
 * worth — and only the last of those is known before checkout. Printing the
 * platform default instead was a number nobody would be charged: measured
 * against GoShip, a 200g card leaves Ho Chi Minh City for 15,385đ and reaches
 * Hanoi for 15,700–31,450đ depending on carrier, none of which is 25,000đ.
 *
 * So this returns the span, and the exact figure is quoted at checkout against
 * the buyer's own address by the resolver that bills the order.
 *
 * Hand delivery is left out on purpose. It is free, but only for a buyer in the
 * seller's own province, and a range starting at 0đ would advertise to everyone
 * a price most of them cannot have. A buyer who can gets it as a cheaper option
 * at checkout, which is the right direction for a surprise to run.
 */

const TIERS: readonly ShippingTier[] = ['intra', 'inter', 'region'];

const COURIERS: readonly string[] = SHIPPING_CARRIERS.filter((c) => c.booksWithCarrier).map((c) => c.code);

export type ShippingRange = { min: number; max: number };

export function shopShippingRange(input: {
    /** What the seller set, cell by cell. */
    set?: ShopFeeTable | null;
    /** What GoShip quoted for their pickup address. */
    quoted?: ShopFeeTable | null;
    /** The carriers this shop offers; empty means it has expressed no preference. */
    carriers?: readonly string[] | null;
    /** The card's price, which is what khai giá is charged on. */
    declaredValue?: number | null;
}): ShippingRange | null {
    const offered = (input.carriers ?? []).filter((code) => booksWithCarrier(code) && COURIERS.includes(code));
    const carriers = offered.length ? offered : COURIERS;

    const prices: number[] = [];
    for (const carrier of carriers) {
        const khaiGia = khaiGiaSurcharge(carrier, input.declaredValue ?? 0);
        for (const tier of TIERS) {
            if (!carrierServesTier(carrier, tier)) continue;
            // Only cells somebody actually priced. Falling back to the platform
            // figure here would put a number in the range that no carrier
            // quoted, which is the thing this exists to stop.
            const cell = input.set?.[carrier]?.[tier] ?? input.quoted?.[carrier]?.[tier];
            if (!isValidListingShippingFee(cell)) continue;
            prices.push(cell + khaiGia);
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
    quoted?: ShopFeeTable | null;
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
    quoted?: ShopFeeTable | null;
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
