import 'server-only';
import { calculateShippingFee, CARD_DEFAULTS } from '@/lib/ghn';
import { cheapestTierFee, isValidShippingFee, resolveShippingTier, type ShopShippingFees } from '@/lib/shipping-fee';
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
 */
export async function quoteCheapestConfiguredShipping(input: CheapestConfiguredShippingQuoteInput): Promise<number> {
  const service = createServiceSupabaseClient();
  const { data, error } = await service
    .from('profiles')
    .select('shipping_carriers, shipping_fees, address_province_id, address_province_name')
    .eq('id', input.sellerId)
    .single<SellerShippingProfile>();

  if (error || !data) throw new Error('seller_shipping_configuration_missing');

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
  const fee = cheapestTierFee(data.shipping_fees, carriers, tier);
  if (fee === null) throw new Error('shipping_fee_not_configured');

  return fee;
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
