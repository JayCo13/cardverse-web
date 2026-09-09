import 'server-only';
import { parcelShippingFee } from '@/lib/shipping-fee';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * What a buyer is charged to have an order sent.
 *
 * The seller sets it, on the listing, and it is read from the listing here —
 * never from the request. The browser may say which cards are being bought;
 * what they cost to ship is looked up, the same as their price is.
 *
 * One fee per seller, not per card: a seller who sold three cards packs one
 * parcel, and charging for three is charging for parcels nobody sends. The
 * dearest of their listings' fees is the one that applies, since that is the
 * seller's own estimate of the most postage involved.
 *
 * The seller's pickup province is still required. Not for the price — it does
 * not vary by distance — but because a parcel has to be collected from
 * somewhere, and an order that reaches payment with nowhere to collect from is
 * one the seller cannot book.
 */

type ShippingQuoteInput = {
  sellerId: string;
  /** The listings being bought from this seller. Their fees decide the charge. */
  cardIds: string[];
  carrier?: string;
  toProvinceId: number;
  toProvinceName: string;
};

type SellerShippingProfile = {
  address_province_id: number | null;
  address_province_name: string | null;
};

/**
 * The carrier recorded at checkout.
 *
 * Nobody chooses one here: the seller picks from GoShip's live rates when
 * booking, and that choice overwrites this. It is kept because orders carry a
 * carrier column that predates the change and readers fall back to it before a
 * shipment exists.
 */
const CARRIER_AT_CHECKOUT = 'goship';

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

/** One trusted read of both tables; never use browser fee data. */
async function readQuoteInputs(inputs: ShippingQuoteInput[]) {
  const service = createServiceSupabaseClient();
  const cardIds = [...new Set(inputs.flatMap((input) => input.cardIds))];

  const [profiles, cards] = await Promise.all([
    service
      .from('profiles')
      .select('id, display_name, address_province_id, address_province_name')
      .in('id', [...new Set(inputs.map((input) => input.sellerId))])
      .returns<(SellerShippingProfile & { id: string; display_name: string | null })[]>(),
    cardIds.length
      ? service
        .from('cards')
        .select('id, shipping_fee')
        .in('id', cardIds)
        .returns<{ id: string; shipping_fee: number | null }[]>()
      : Promise.resolve({ data: [] as { id: string; shipping_fee: number | null }[], error: null }),
  ]);

  // A failed query says nothing about any seller's configuration.
  if (profiles.error || !profiles.data || cards.error || !cards.data) {
    console.error('Checkout shipping read failed:', profiles.error ?? cards.error);
    throw new CheckoutShippingError('shipping_quote_failed');
  }

  return {
    profiles: new Map(profiles.data.map((p) => [p.id, p])),
    fees: new Map(cards.data.map((c) => [c.id, c.shipping_fee])),
  };
}

export async function quoteCheckoutConfiguredShippingBatch(
  inputs: ShippingQuoteInput[],
): Promise<Map<string, { carrier: string; fee: number }>> {
  if (inputs.length === 0) return new Map();
  if (inputs.some((input) => !Number.isSafeInteger(Number(input.toProvinceId))
    || Number(input.toProvinceId) <= 0 || !input.toProvinceName?.trim())) {
    throw new CheckoutShippingError('shipping_address_invalid');
  }

  const { profiles, fees } = await readQuoteInputs(inputs);

  return new Map(inputs.map((input) => {
    const profile = profiles.get(input.sellerId);
    const sellerName = profile?.display_name || undefined;
    if (!profile) throw new CheckoutShippingError('seller_shipping_configuration_missing', input.sellerId);
    if (!hasPickupOrigin(profile)) {
      throw new CheckoutShippingError('seller_shipping_origin_missing', input.sellerId, sellerName);
    }
    // A card id the read did not return is one that no longer exists, and its
    // absence must not become free shipping — parcelShippingFee falls back to
    // the platform figure for anything it cannot price.
    const fee = parcelShippingFee(input.cardIds.map((id) => fees.get(id)));
    return [input.sellerId, { carrier: CARRIER_AT_CHECKOUT, fee }];
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
  return { carrier: CARRIER_AT_CHECKOUT, fee: await quoteConfiguredShipping(input) };
}

export async function quoteCheapestConfiguredShippingBatch(
  inputs: ShippingQuoteInput[],
): Promise<Map<string, { carrier: string; fee: number }>> {
  return quoteCheckoutConfiguredShippingBatch(inputs);
}
