import 'server-only';
import { calculateShippingFee, CARD_DEFAULTS } from '@/lib/ghn';
import { cheapestTierOption, isValidShippingFee, resolveShippingTier, type ShopShippingFees } from '@/lib/shipping-fee';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

type ShippingQuoteInput = {
  sellerId: string;
  toDistrictId: number;
  toWardCode: string;
  insuranceValue: number;
  itemCount?: number;
};

type ConfiguredShippingQuoteInput = {
  sellerId: string;
  carrier: string;
  toProvinceId: number;
  toProvinceName: string;
};

type CheapestConfiguredShippingQuoteInput = Omit<ConfiguredShippingQuoteInput, 'carrier'>;

type SellerShippingProfile = {
  shipping_carriers: string[] | null;
  shipping_fees: ShopShippingFees | null;
  address_province_id: number | null;
  address_province_name: string | null;
};

/**
 * Recalculate a marketplace fee from the seller's stored checkout settings.
 * The browser may choose a carrier, but it never supplies the amount charged.
 */
export async function quoteConfiguredShipping(input: ConfiguredShippingQuoteInput): Promise<number> {
  const service = createServiceSupabaseClient();
  const { data, error } = await service
    .from('profiles')
    .select('shipping_carriers, shipping_fees, address_province_id, address_province_name')
    .eq('id', input.sellerId)
    .single<SellerShippingProfile>();

  if (error || !data) throw new Error('seller_shipping_configuration_missing');

  return configuredShippingFromProfile(input, data);
}

function configuredShippingFromProfile(input: ConfiguredShippingQuoteInput, data: SellerShippingProfile): number {
  const carrier = String(input.carrier || '').trim();
  const enabledCarriers = Array.isArray(data.shipping_carriers) ? data.shipping_carriers : [];
  if (!carrier || carrier === 'self' || !enabledCarriers.includes(carrier)) {
    throw new Error('invalid_shipping_carrier');
  }

  const toProvinceId = Number(input.toProvinceId);
  if (!Number.isSafeInteger(toProvinceId) || !input.toProvinceName
      || !Number.isSafeInteger(data.address_province_id) || !data.address_province_name) {
    throw new Error('seller_shipping_configuration_missing');
  }

  const tier = resolveShippingTier(
    {
      provinceId: data.address_province_id,
      provinceName: data.address_province_name,
    },
    {
      provinceId: toProvinceId,
      provinceName: input.toProvinceName,
    },
  );
  const fee = data.shipping_fees?.[carrier]?.[tier];
  // Same bounds the shop form enforces. A row outside them predates the rule
  // (or was written around the form) and must not become a buyer's charge.
  if (!isValidShippingFee(fee)) {
    throw new Error('shipping_fee_not_configured');
  }

  return fee;
}

/**
 * Quote the checkout-page default: the cheapest enabled carrier configured by
 * the seller for the buyer's delivery tier. This deliberately does not use a
 * live GHN quote; the seller's saved shipping table is the buyer's charge.
 *
 * Returns the carrier as well as the fee. The buyer is never asked to pick one
 * on this path, so the carrier this quote settled on IS the agreed carrier, and
 * the order has to carry it — the seller's ship action requires one.
 */
export async function quoteCheapestConfiguredShipping(
  input: CheapestConfiguredShippingQuoteInput,
): Promise<{ carrier: string; fee: number }> {
  const service = createServiceSupabaseClient();
  const { data, error } = await service
    .from('profiles')
    .select('shipping_carriers, shipping_fees, address_province_id, address_province_name')
    .eq('id', input.sellerId)
    .single<SellerShippingProfile>();

  if (error || !data) throw new Error('seller_shipping_configuration_missing');

  return cheapestConfiguredShippingFromProfile(input, data);
}

/** One trusted profile read for the whole cart; never use browser fee data. */
export async function quoteCheapestConfiguredShippingBatch(
  inputs: CheapestConfiguredShippingQuoteInput[],
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

/** Quote explicit choices or legacy defaults with one trusted profile read. */
export async function quoteCheckoutConfiguredShippingBatch(
  inputs: (CheapestConfiguredShippingQuoteInput & { carrier?: string })[],
): Promise<Map<string, { carrier: string; fee: number }>> {
  if (inputs.length === 0) return new Map();
  if (inputs.some(input => !Number.isSafeInteger(Number(input.toProvinceId))
    || Number(input.toProvinceId) <= 0 || !input.toProvinceName?.trim())) {
    throw new CheckoutShippingError('shipping_address_invalid');
  }
  const service = createServiceSupabaseClient();
  const { data, error } = await service
    .from('profiles')
    .select('id, display_name, shipping_carriers, shipping_fees, address_province_id, address_province_name')
    .in('id', [...new Set(inputs.map(input => input.sellerId))])
    .returns<(SellerShippingProfile & { id: string; display_name: string | null })[]>();
  // A failed query says nothing about any seller's configuration.
  if (error || !data) {
    console.error('Checkout shipping profile read failed:', error);
    throw new CheckoutShippingError('shipping_quote_failed');
  }
  const profiles = new Map(data.map(profile => [profile.id, profile]));
  return new Map(inputs.map(input => {
    const profile = profiles.get(input.sellerId);
    const sellerName = profile?.display_name || undefined;
    if (!profile) throw new CheckoutShippingError('seller_shipping_configuration_missing', input.sellerId);
    if (!Number.isSafeInteger(profile.address_province_id)
      || !profile.address_province_name?.trim()) {
      throw new CheckoutShippingError('seller_shipping_origin_missing', input.sellerId, sellerName);
    }
    try {
      const quote = input.carrier === undefined
        ? cheapestConfiguredShippingFromProfile(input, profile)
        : { carrier: input.carrier, fee: configuredShippingFromProfile({ ...input, carrier: input.carrier }, profile) };
      return [input.sellerId, quote];
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (['invalid_shipping_carrier', 'shipping_fee_not_configured', 'seller_shipping_configuration_missing'].includes(code)) {
        throw new CheckoutShippingError(code, input.sellerId, sellerName);
      }
      throw error;
    }
  }));
}

function cheapestConfiguredShippingFromProfile(
  input: CheapestConfiguredShippingQuoteInput,
  data: SellerShippingProfile,
): { carrier: string; fee: number } {
  const toProvinceId = Number(input.toProvinceId);
  if (!Number.isSafeInteger(toProvinceId) || !input.toProvinceName
      || !Number.isSafeInteger(data.address_province_id) || !data.address_province_name) {
    throw new Error('seller_shipping_configuration_missing');
  }

  const tier = resolveShippingTier(
    {
      provinceId: data.address_province_id,
      provinceName: data.address_province_name,
    },
    {
      provinceId: toProvinceId,
      provinceName: input.toProvinceName,
    },
  );
  const carriers = (Array.isArray(data.shipping_carriers) ? data.shipping_carriers : [])
    .filter((carrier): carrier is string => typeof carrier === 'string' && carrier !== 'self');
  const option = cheapestTierOption(data.shipping_fees, carriers, tier);
  if (option === null) throw new Error('shipping_fee_not_configured');

  return option;
}

export async function quoteVerifiedShipping(input: ShippingQuoteInput): Promise<number> {
  const service = createServiceSupabaseClient();
  const { data, error } = await service
    .from('profiles')
    .select('default_shipping_district_id, default_shipping_ward_code, address_district_id, address_ward_code')
    .eq('id', input.sellerId)
    .single<{
      default_shipping_district_id: number | null;
      default_shipping_ward_code: string | null;
      address_district_id: number | null;
      address_ward_code: string | null;
    }>();
  if (error || !data) throw new Error('seller_shipping_origin_missing');

  const fromDistrictId = data.default_shipping_district_id || data.address_district_id;
  const fromWardCode = data.default_shipping_ward_code || data.address_ward_code;
  const toDistrictId = Number(input.toDistrictId);
  const toWardCode = String(input.toWardCode || '');
  if (!Number.isSafeInteger(fromDistrictId) || !fromWardCode
      || !Number.isSafeInteger(toDistrictId) || !toWardCode) {
    throw new Error('seller_shipping_origin_missing');
  }
  const verifiedFromDistrictId = Number(fromDistrictId);

  const itemCount = Math.max(1, Math.min(100, Math.floor(input.itemCount || 1)));
  const fee = await calculateShippingFee({
    fromDistrictId: verifiedFromDistrictId,
    fromWardCode,
    toDistrictId,
    toWardCode,
    insuranceValue: Math.min(500_000, Math.max(0, Math.floor(input.insuranceValue))),
    weight: CARD_DEFAULTS.weight * itemCount,
  });
  if (!Number.isSafeInteger(fee.total) || fee.total < 0) {
    throw new Error('shipping_quote_invalid');
  }
  return fee.total;
}
