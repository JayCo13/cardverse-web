import 'server-only';
import { isValidListingShippingFee, roundUp1000 } from '@/lib/shipping-fee';
import { cachedGoshipRates } from '@/lib/goship-rate-cache';
import { shipmentCarriers } from '@/lib/shipment-carriers';
import { heaviestPreset, parcelFor, parcelPresetOr, parseParcelOverrides, type ParcelPreset } from '@/lib/parcel';
import type { CarrierCoverage } from '@/lib/carrier-coverage';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * What a buyer is charged to have an order sent: GoShip's own price.
 *
 * Nothing here is a guess and nothing is taken from the request beyond WHICH
 * cards and WHERE to. The seller's pickup, the carriers they enable, the parcel
 * they pack, and the listing's own fee (if it set one) are all read; the price
 * of moving that parcel to that district is GoShip's answer, declared value 0,
 * rounded up to the thousand. The buyer picks the carrier from what GoShip
 * actually returns for the route — a carrier that does not serve it is simply
 * not on the list, so there is nothing for the seller to be short on later.
 *
 * Khai giá is not in this number. It is the seller's decision at booking and
 * comes off the seller (see /api/shipping/book), because the buyer is already
 * protected by escrow and the carrier's insurance pays the sender.
 *
 * One fee per seller, not per card: a seller who sold three cards packs one
 * parcel. The parcel is sized from the listing's preset (or the shop's) and
 * the card count.
 */

export type GoshipDestination = { city: string; district: string };

type ShippingQuoteInput = {
    sellerId: string;
    /** The listings being bought from this seller. */
    cardIds: string[];
    /**
     * Where the caller wants this answer filed in the settled map. The grid
     * asks about several listings of one shop at once (different presets price
     * differently), so the seller id alone would collide. Defaults to it.
     */
    key?: string;
    /** The carrier the buyer picked, when billing. Ignored for a listing-priced fee. */
    carrier?: string;
    to: GoshipDestination;
};

export type CheckoutShippingQuote = {
    carrier: string;
    /** What the buyer pays, rounded up to the thousand. */
    fee: number;
    /** GoShip's figure before rounding. */
    feeRaw: number;
    /** GoShip's rate token at quote time. Booking re-quotes; this is a record. */
    rateId: string | null;
    expected: string | null;
    successPercent: number | null;
    parcelPreset: ParcelPreset;
    /** The seller priced this listing themselves (free shipping included). */
    listingOverride: boolean;
    /** Where the quote was priced from — the seller's pickup, GoShip ids. */
    from: GoshipDestination;
};

type SellerShippingProfile = {
    id: string;
    display_name: string | null;
    goship_pickup: { city?: string; district?: string } | null;
    shipping_carriers: string[] | null;
    carrier_coverage: CarrierCoverage | null;
    parcel_overrides: unknown;
};

type CardRow = { id: string; seller_id: string; shipping_fee: number | null; parcel_preset: string | null; product_kind: string | null };

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

const GOSHIP_ID = /^[0-9]{1,12}$/;

function assertDestination(inputs: ShippingQuoteInput[]) {
    if (inputs.some((input) => !GOSHIP_ID.test(String(input.to?.city ?? '')) || !GOSHIP_ID.test(String(input.to?.district ?? '')))) {
        throw new CheckoutShippingError('shipping_address_invalid');
    }
}

/** One trusted read of both tables; never use browser data for any of it. */
async function readQuoteInputs(inputs: ShippingQuoteInput[]) {
    const service = createServiceSupabaseClient();
    const cardIds = [...new Set(inputs.flatMap((input) => input.cardIds))];

    const [profiles, cards] = await Promise.all([
        service
            .from('profiles')
            .select('id, display_name, goship_pickup, shipping_carriers, carrier_coverage, parcel_overrides')
            .in('id', [...new Set(inputs.map((input) => input.sellerId))])
            .returns<SellerShippingProfile[]>(),
        cardIds.length
            ? service.from('cards').select('id, seller_id, shipping_fee, parcel_preset, product_kind').in('id', cardIds).returns<CardRow[]>()
            : Promise.resolve({ data: [] as CardRow[], error: null }),
    ]);

    if (profiles.error || !profiles.data || cards.error || !cards.data) {
        console.error('Checkout shipping read failed:', profiles.error ?? cards.error);
        throw new CheckoutShippingError('shipping_quote_failed');
    }

    return {
        profiles: new Map(profiles.data.map((p) => [p.id, p])),
        cards: new Map(cards.data.map((c) => [c.id, c])),
        // One GoShip call per distinct route+parcel within this request, however
        // many listings share it: ten raw cards from one shop are one quote.
        rates: new Map<string, ReturnType<typeof cachedGoshipRates>>(),
    };
}

/**
 * The parcel this seller's part of the order goes in: the kind of thing being
 * sold, in the seller's own numbers where they saved any.
 *
 * Several listings take the heaviest kind, since that is the carton the rest
 * fit in; several cards grow the card mailer by the count (parcelFor).
 */
function parcelPresetFor(cards: CardRow[], overrides: ReturnType<typeof parseParcelOverrides>): ParcelPreset {
    const kinds = cards.map((c) => parcelPresetOr(c.product_kind));
    return kinds.length ? heaviestPreset(kinds, overrides) : 'card';
}

async function resolveSeller(input: ShippingQuoteInput, context: Awaited<ReturnType<typeof readQuoteInputs>>): Promise<CheckoutShippingQuote[]> {
    const profile = context.profiles.get(input.sellerId);
    const sellerName = profile?.display_name || undefined;
    if (!profile) throw new CheckoutShippingError('seller_shipping_configuration_missing', input.sellerId);
    const pickup = profile.goship_pickup;
    if (!pickup?.city || !pickup?.district || !GOSHIP_ID.test(pickup.city) || !GOSHIP_ID.test(pickup.district)) {
        throw new CheckoutShippingError('seller_shipping_origin_missing', input.sellerId, sellerName);
    }

    // A card id the read did not return no longer exists; it neither prices
    // nor frees the parcel. Only cards of this seller count — a crafted request
    // naming somebody else's listing must not change what this seller charges.
    const cards = input.cardIds.map((id) => context.cards.get(id)).filter((c): c is CardRow => !!c && c.seller_id === input.sellerId);
    const overrides = parseParcelOverrides(profile.parcel_overrides);
    const preset = parcelPresetFor(cards, overrides);
    const parcel = parcelFor(preset, Math.max(1, cards.length), overrides);

    const query = { from: { city: pickup.city, district: pickup.district }, to: input.to, parcel, declaredValue: 0 };
    const memoKey = JSON.stringify(query);
    let pending = context.rates.get(memoKey);
    if (!pending) { pending = cachedGoshipRates(query); context.rates.set(memoKey, pending); }
    const quoted = await pending;
    if (!quoted.ok) {
        console.error('Checkout GoShip quote failed:', quoted.reason);
        throw new CheckoutShippingError('shipping_quote_failed', input.sellerId, sellerName);
    }

    const allowed = shipmentCarriers(profile.shipping_carriers, profile.carrier_coverage);
    const rates = quoted.rates.filter((r) => allowed.includes(r.carrierCode));
    if (rates.length === 0) throw new CheckoutShippingError('seller_does_not_ship_here', input.sellerId, sellerName);

    const options: CheckoutShippingQuote[] = rates
        .map((r): CheckoutShippingQuote => ({
            carrier: r.carrierCode,
            fee: roundUp1000(r.totalFee),
            feeRaw: r.totalFee,
            rateId: r.id,
            expected: r.expected,
            successPercent: r.successPercent,
            parcelPreset: preset,
            listingOverride: false,
            from: { city: pickup.city as string, district: pickup.district as string },
        }))
        .sort((a, b) => a.feeRaw - b.feeRaw || a.carrier.localeCompare(b.carrier));

    // A listing the seller priced themselves is all-in and leaves the buyer no
    // carrier to choose: the cheapest carrier goes, and whatever GoShip bills
    // above the seller's number is the seller's (that is what "free shipping"
    // means). Only when EVERY card in the parcel is self-priced — mixing one
    // flat fee with GoShip's price for the rest would be neither.
    if (cards.length > 0 && cards.every((c) => isValidListingShippingFee(c.shipping_fee))) {
        const fee = Math.max(...cards.map((c) => c.shipping_fee as number));
        const cheapest = options[0];
        return [{ ...cheapest, fee, feeRaw: fee, listingOverride: true }];
    }

    return options;
}

/**
 * Every carrier each seller offers on this route, priced, cheapest first.
 *
 * What the checkout shows before anything is charged. Same reads, same GoShip
 * call, so the row a buyer picks is the row the server bills.
 */
export async function listCheckoutShippingOptions(inputs: ShippingQuoteInput[]): Promise<Map<string, CheckoutShippingQuote[]>> {
    if (inputs.length === 0) return new Map();
    assertDestination(inputs);
    const context = await readQuoteInputs(inputs);
    const resolved = await Promise.all(inputs.map(async (input) => [input.sellerId, await resolveSeller(input, context)] as const));
    return new Map(resolved);
}

/**
 * The same, but one shop's failure does not blank the others.
 *
 * A grid page names a dozen shops; the one with no pickup address yet should
 * read "cannot quote" on its own cards and nowhere else.
 */
export async function listCheckoutShippingOptionsSettled(inputs: ShippingQuoteInput[]): Promise<{
    data: Record<string, CheckoutShippingQuote[]>;
    errors: Record<string, { code: string; seller_name: string | null }>;
}> {
    if (inputs.length === 0) return { data: {}, errors: {} };
    assertDestination(inputs);
    const context = await readQuoteInputs(inputs);
    const data: Record<string, CheckoutShippingQuote[]> = {};
    const errors: Record<string, { code: string; seller_name: string | null }> = {};
    await Promise.all(inputs.map(async (input) => {
        const key = input.key ?? input.sellerId;
        try {
            data[key] = await resolveSeller(input, context);
        } catch (error) {
            const known = error instanceof CheckoutShippingError;
            if (!known) console.error('Shipping options failed:', error);
            errors[key] = { code: known ? error.code : 'shipping_quote_failed', seller_name: known ? (error.sellerName || null) : null };
        }
    }));
    return { data, errors };
}

/**
 * The one option per seller that an order is billed at.
 *
 * The buyer's carrier is required unless the listing priced itself. No silent
 * "cheapest" fallback: an order that names no carrier is a client that did not
 * show the choice, and it should fail loudly rather than bill a guess.
 */
export async function quoteCheckoutShipping(inputs: ShippingQuoteInput[]): Promise<Map<string, CheckoutShippingQuote>> {
    if (inputs.length === 0) return new Map();
    assertDestination(inputs);
    const context = await readQuoteInputs(inputs);

    const resolved = await Promise.all(inputs.map(async (input) => {
        const options = await resolveSeller(input, context);
        const profile = context.profiles.get(input.sellerId);
        if (options[0]?.listingOverride) return [input.sellerId, options[0]] as const;
        const asked = input.carrier?.trim();
        const chosen = asked ? options.find((o) => o.carrier === asked) : undefined;
        if (!chosen) throw new CheckoutShippingError('invalid_shipping_carrier', input.sellerId, profile?.display_name || undefined);
        return [input.sellerId, chosen] as const;
    }));
    return new Map(resolved);
}

/** The cheapest option per seller, for paths with no carrier picker (an accepted offer paid from its thread). */
export async function quoteCheapestCheckoutShipping(inputs: ShippingQuoteInput[]): Promise<Map<string, CheckoutShippingQuote>> {
    const options = await listCheckoutShippingOptions(inputs);
    return new Map([...options].map(([sellerId, list]) => [sellerId, list[0]]));
}

/** What an order stores about the quote it was billed from. */
export const shippingQuoteRecord = (quote: CheckoutShippingQuote, to: GoshipDestination) => ({
    rate_id: quote.rateId,
    fee_raw: quote.feeRaw,
    quoted_at: new Date().toISOString(),
    from: quote.from,
    to,
    listing_override: quote.listingOverride,
});
