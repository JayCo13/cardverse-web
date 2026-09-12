import 'server-only';
import {
    listingShippingFee,
    resolveShippingTier,
    shopShippingFee,
    type ShopFeeTable,
} from '@/lib/shipping-fee';
import { khaiGiaSurcharge } from '@/lib/khai-gia';
import { booksWithCarrier, carrierServesTier, OFFERABLE_CARRIERS } from '@/lib/shipping-carriers';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * What a buyer is charged to have an order sent.
 *
 * Everything here is read, never taken from the request. The browser may say
 * which cards are being bought and which carrier the buyer picked; what those
 * cost to ship, what the cards are worth, and whether the seller offers that
 * carrier at all are all looked up.
 *
 * Postage comes from three places, in this order:
 *
 *   0. Hand delivery, which is priced before any of this: nothing. Two people
 *      meeting is not a delivery anybody bills for, and unlike free shipping it
 *      leaves nothing to come off the seller's payout either.
 *   1. The listing, when its seller priced it. cards.shipping_fee is a flat
 *      number the seller chose for that card, 0 included, and it wins outright
 *      — all in, khai giá included, because a flat price the buyer was quoted
 *      would not be flat if checkout grew it.
 *   2. The shop's table, at the cell this delivery lands in — carrier and
 *      distance tier. Khai giá is then ADDED to that, from the measured model,
 *      so a seller who leaves the table alone cannot be left short by a dear
 *      card however much it is worth.
 *   3. The platform figure, for a shop that has neither.
 *
 * One fee per seller, not per card: a seller who sold three cards packs one
 * parcel, and charging for three is charging for parcels nobody sends. The
 * dearest of the cards' resolved fees applies, since that is the seller's own
 * estimate of the most postage involved.
 *
 * The seller's pickup province is still required. Not only for the price but
 * because a parcel has to be collected from somewhere, and an order that
 * reaches payment with nowhere to collect from is one the seller cannot book.
 */

type ShippingQuoteInput = {
    sellerId: string;
    /** The listings being bought from this seller. Their fees decide the charge. */
    cardIds: string[];
    /** The carrier the buyer picked, if they picked one. */
    carrier?: string;
    toProvinceId: number;
    toProvinceName: string;
};

type SellerShippingProfile = {
    address_province_id: number | null;
    address_province_name: string | null;
    shipping_carriers: string[] | null;
    shipping_fees: ShopFeeTable | null;
};

/**
 * Carriers a parcel can actually go out with.
 *
 * Retired carriers are excluded, which also filters what a shop saved earlier:
 * a shop that ticked VNPost before it was retired stops being quoted for it,
 * rather than offering a buyer a carrier the seller can no longer book.
 */
const OFFERABLE: readonly string[] = OFFERABLE_CARRIERS.map((c) => c.code);

export class CheckoutShippingError extends Error {
    constructor(
        public readonly code: string,
        public readonly sellerId?: string,
        public readonly sellerName?: string,
    ) {
        super(code);
        this.name = 'CheckoutShippingError';
    }
}

const hasPickupOrigin = (profile: SellerShippingProfile | undefined): boolean =>
    !!profile
    && Number.isSafeInteger(profile.address_province_id)
    && !!profile.address_province_name?.trim();

/**
 * Which carriers this shop offers.
 *
 * A shop that has never opened the shipping setup page has an empty list, and
 * an empty list must not mean "cannot be bought from" — that would take every
 * existing shop offline the moment this shipped. It means "no preference", and
 * the whole bookable set applies until the seller says otherwise.
 *
 * Hand delivery is never part of that default. A shop that has said nothing has
 * not agreed to meet anybody, and it is the one option that cannot be fulfilled
 * by handing a parcel to a courier.
 */
const offeredCarriers = (profile: SellerShippingProfile): string[] => {
    const declared = (profile.shipping_carriers ?? []).filter((c) => OFFERABLE.includes(c));
    return declared.length ? declared : OFFERABLE.filter((c) => c !== 'self');
};

/** One trusted read of both tables; never use browser fee data. */
async function readQuoteInputs(inputs: ShippingQuoteInput[]) {
    const service = createServiceSupabaseClient();
    const cardIds = [...new Set(inputs.flatMap((input) => input.cardIds))];

    const [profiles, cards] = await Promise.all([
        service
            .from('profiles')
            .select('id, display_name, address_province_id, address_province_name, shipping_carriers, shipping_fees')
            .in('id', [...new Set(inputs.map((input) => input.sellerId))])
            .returns<(SellerShippingProfile & { id: string; display_name: string | null })[]>(),
        cardIds.length
            ? service
                .from('cards')
                .select('id, shipping_fee, price')
                .in('id', cardIds)
                .returns<{ id: string; shipping_fee: number | null; price: number | null }[]>()
            : Promise.resolve({ data: [] as { id: string; shipping_fee: number | null; price: number | null }[], error: null }),
    ]);

    // A failed query says nothing about any seller's configuration.
    if (profiles.error || !profiles.data || cards.error || !cards.data) {
        console.error('Checkout shipping read failed:', profiles.error ?? cards.error);
        throw new CheckoutShippingError('shipping_quote_failed');
    }

    return {
        profiles: new Map(profiles.data.map((p) => [p.id, p])),
        fees: new Map(cards.data.map((c) => [c.id, c.shipping_fee])),
        prices: new Map(cards.data.map((c) => [c.id, c.price])),
    };
}

/**
 * Everything one seller's parcel needs, resolved once.
 *
 * Shared by the charge and by the list of options shown before it, so a price a
 * buyer picks from and the price they are billed cannot drift apart: there is
 * one function that turns a carrier into a number, and both call it.
 */
function resolveSeller(
    input: ShippingQuoteInput,
    context: Awaited<ReturnType<typeof readQuoteInputs>>,
): { offered: string[]; feeFor: (carrier: string) => number; sellerName?: string } {
    const profile = context.profiles.get(input.sellerId);
    const sellerName = profile?.display_name || undefined;
    if (!profile) throw new CheckoutShippingError('seller_shipping_configuration_missing', input.sellerId);
    if (!hasPickupOrigin(profile)) {
        throw new CheckoutShippingError('seller_shipping_origin_missing', input.sellerId, sellerName);
    }

    const tier = resolveShippingTier(
        { provinceId: profile.address_province_id, provinceName: profile.address_province_name },
        { provinceId: Number(input.toProvinceId), provinceName: input.toProvinceName },
    );

    // Hand delivery is the reason this filter exists: two people meeting
    // somewhere they agreed on is a same-province arrangement, and offering it
    // to a buyer in Hanoi is offering a delivery nobody can make. Applied to
    // every carrier rather than special-casing one, so the rule lives in the
    // carrier definition where the next one can declare its own.
    const offered = offeredCarriers(profile).filter((code) => carrierServesTier(code, tier));
    if (offered.length === 0) {
        throw new CheckoutShippingError('seller_does_not_ship_here', input.sellerId, sellerName);
    }

    // Declared value is what the parcel is worth to the carrier, and the listing
    // price is the only figure here that was not supplied by the person paying.
    // An accepted offer ships for less than list, so this can price khai giá a
    // little high — erring towards the seller, who carries any shortfall.
    const declaredValue = input.cardIds.reduce((sum, id) => sum + Number(context.prices.get(id) ?? 0), 0);

    const feeFor = (carrier: string) => {
        // Meeting someone costs nothing to either side, and that is not a fee
        // of zero that a listing or a shop table could argue with — there is no
        // carrier, so there is no bill for anybody to pay or be docked for. It
        // returns before any of the pricing below for exactly that reason.
        if (!booksWithCarrier(carrier)) return 0;

        // Postage from the table, insurance from the carrier's own model. Kept
        // as two terms because they answer different questions: one is how far
        // the parcel goes, the other is what is inside it.
        const shopFee = shopShippingFee({
            set: profile.shipping_fees,
            carrier,
            tier,
        }) + khaiGiaSurcharge(carrier, declaredValue);
        // A card id the read did not return is one that no longer exists, and
        // its absence must not become free shipping — it falls to the shop cell
        // like any other listing whose seller set no price of its own.
        return input.cardIds.length === 0
            ? shopFee
            : Math.max(...input.cardIds.map((id) => listingShippingFee(context.fees.get(id), shopFee)));
    };

    return { offered, feeFor, sellerName };
}

function assertDestination(inputs: ShippingQuoteInput[]) {
    if (inputs.some((input) => !Number.isSafeInteger(Number(input.toProvinceId))
        || Number(input.toProvinceId) <= 0 || !input.toProvinceName?.trim())) {
        throw new CheckoutShippingError('shipping_address_invalid');
    }
}

export async function quoteCheckoutConfiguredShippingBatch(
    inputs: ShippingQuoteInput[],
): Promise<Map<string, { carrier: string; fee: number }>> {
    if (inputs.length === 0) return new Map();
    assertDestination(inputs);

    const context = await readQuoteInputs(inputs);

    return new Map(inputs.map((input) => {
        const { offered, feeFor, sellerName } = resolveSeller(input, context);

        const asked = input.carrier?.trim();
        if (asked && !offered.includes(asked)) {
            throw new CheckoutShippingError('invalid_shipping_carrier', input.sellerId, sellerName);
        }

        // Without a stated carrier, the cheapest the shop offers. A buyer who
        // did not choose should not be charged as if they had chosen worst.
        const carrier = asked
            ?? offered.reduce((best, code) => (feeFor(code) < feeFor(best) ? code : best), offered[0]);

        return [input.sellerId, { carrier, fee: feeFor(carrier) }];
    }));
}

/**
 * Every carrier each seller offers, priced.
 *
 * What the checkout page shows before anything is charged. Same reads, same
 * arithmetic, so the row a buyer clicks is the row the server bills.
 */
export async function listCheckoutShippingOptions(
    inputs: ShippingQuoteInput[],
): Promise<Map<string, { carrier: string; fee: number }[]>> {
    if (inputs.length === 0) return new Map();
    assertDestination(inputs);

    const context = await readQuoteInputs(inputs);

    return new Map(inputs.map((input) => {
        const { offered, feeFor } = resolveSeller(input, context);
        const options = offered
            .map((carrier) => ({ carrier, fee: feeFor(carrier) }))
            .sort((a, b) => a.fee - b.fee || a.carrier.localeCompare(b.carrier));
        return [input.sellerId, options];
    }));
}

/** One seller, one order. Same rules, same reads. */
export async function quoteConfiguredShipping(input: ShippingQuoteInput): Promise<number> {
    const quotes = await quoteCheckoutConfiguredShippingBatch([input]);
    const quote = quotes.get(input.sellerId);
    if (!quote) throw new Error('seller_shipping_configuration_missing');
    return quote.fee;
}

export async function quoteCheapestConfiguredShipping(
    input: ShippingQuoteInput,
): Promise<{ carrier: string; fee: number }> {
    const quotes = await quoteCheckoutConfiguredShippingBatch([input]);
    const quote = quotes.get(input.sellerId);
    if (!quote) throw new CheckoutShippingError('seller_shipping_configuration_missing', input.sellerId);
    return quote;
}

export async function quoteCheapestConfiguredShippingBatch(
    inputs: ShippingQuoteInput[],
): Promise<Map<string, { carrier: string; fee: number }>> {
    return quoteCheckoutConfiguredShippingBatch(inputs);
}
