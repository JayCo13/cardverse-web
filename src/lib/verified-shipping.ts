import 'server-only';
import { PLATFORM_SHIPPING_FEE } from '@/lib/shipping-fee';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * What a buyer is charged to have an order sent.
 *
 * One flat price the platform sets, not a table the seller fills in. The three
 * tiers this replaced sorted guesses by distance, and distance does not move
 * what a 200g card costs to send — see the measurements in shipping-fee.ts.
 *
 * The browser still never supplies the amount. It is read from here on every
 * path that takes money, so a tampered payload cannot change what is charged
 * any more than it could before.
 *
 * The seller's pickup province is still required. Not for the price now, but
 * because a parcel has to be collected from somewhere, and an order that
 * reaches payment with nowhere to collect from is one the seller cannot book.
 */

type ConfiguredShippingQuoteInput = {
  sellerId: string;
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
 * Nobody chooses one here any more: the seller picks from GoShip's live rates
 * when booking, and that choice overwrites this. It is kept because orders
 * carry a carrier column that predates the change and readers still fall back
 * to it before a shipment exists.
 */
const CARRIER_AT_CHECKOUT = 'goship';

const readSellerProfile = async (sellerIds: string[]) => {
  const service = createServiceSupabaseClient();
  const { data, error } = await service
    .from('profiles')
    .select('id, display_name, address_province_id, address_province_name')
    .in('id', [...new Set(sellerIds)])
    .returns<(SellerShippingProfile & { id: string; display_name: string | null })[]>();
  if (error || !data) {
    // A failed query says nothing about any seller's configuration.
    console.error('Checkout shipping profile read failed:', error);
    throw new CheckoutShippingError('shipping_quote_failed');
  }
  return new Map(data.map((profile) => [profile.id, profile]));
};

const hasPickupOrigin = (profile: SellerShippingProfile | undefined): boolean =>
  !!profile
  && Number.isSafeInteger(profile.address_province_id)
  && !!profile.address_province_name?.trim();

export async function quoteConfiguredShipping(input: ConfiguredShippingQuoteInput): Promise<number> {
  const profiles = await readSellerProfile([input.sellerId]);
  const profile = profiles.get(input.sellerId);
  if (!profile) throw new Error('seller_shipping_configuration_missing');
  if (!hasPickupOrigin(profile)) throw new Error('seller_shipping_configuration_missing');
  return PLATFORM_SHIPPING_FEE;
}

export async function quoteCheapestConfiguredShipping(
  input: Omit<ConfiguredShippingQuoteInput, 'carrier'>,
): Promise<{ carrier: string; fee: number }> {
  const fee = await quoteConfiguredShipping(input);
  return { carrier: CARRIER_AT_CHECKOUT, fee };
}

/** One trusted profile read for the whole cart; never use browser fee data. */
export async function quoteCheapestConfiguredShippingBatch(
  inputs: Omit<ConfiguredShippingQuoteInput, 'carrier'>[],
): Promise<Map<string, { carrier: string; fee: number }>> {
  return quoteCheckoutConfiguredShippingBatch(inputs);
}

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

export async function quoteCheckoutConfiguredShippingBatch(
  inputs: ConfiguredShippingQuoteInput[],
): Promise<Map<string, { carrier: string; fee: number }>> {
  if (inputs.length === 0) return new Map();
  if (inputs.some((input) => !Number.isSafeInteger(Number(input.toProvinceId))
    || Number(input.toProvinceId) <= 0 || !input.toProvinceName?.trim())) {
    throw new CheckoutShippingError('shipping_address_invalid');
  }

  const profiles = await readSellerProfile(inputs.map((input) => input.sellerId));

  return new Map(inputs.map((input) => {
    const profile = profiles.get(input.sellerId);
    const sellerName = profile?.display_name || undefined;
    if (!profile) throw new CheckoutShippingError('seller_shipping_configuration_missing', input.sellerId);
    if (!hasPickupOrigin(profile)) {
      throw new CheckoutShippingError('seller_shipping_origin_missing', input.sellerId, sellerName);
    }
    return [input.sellerId, { carrier: CARRIER_AT_CHECKOUT, fee: PLATFORM_SHIPPING_FEE }];
  }));
}
