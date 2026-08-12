import 'server-only';
import { calculateShippingFee, CARD_DEFAULTS } from '@/lib/ghn';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

type ShippingQuoteInput = {
  sellerId: string;
  toDistrictId: number;
  toWardCode: string;
  insuranceValue: number;
  itemCount?: number;
};

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
