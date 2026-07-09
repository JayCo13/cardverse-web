-- Seller-declared shipping. A shop picks which carriers it uses, and for EACH
-- carrier declares three tiered fees based on the buyer↔seller province:
--   intra  = same province (nội tỉnh)
--   inter  = different province, same region (ngoại tỉnh, cùng miền)
--   region = different region — North/Central/South (liên miền)
-- Stored per-carrier in shipping_fees jsonb:
--   { "ghn": {"intra":15000,"inter":25000,"region":40000}, "vtp": {...} }
-- Checkout resolves the tier from the seller's saved province vs the buyer's
-- delivery province and charges the cheapest carrier's fee for that tier.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS shipping_carriers text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS shipping_fees jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Clean up columns/constraints from earlier iterations of this migration, if any.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_shipping_fee_range_check;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_shipping_fee_tiers_check;
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS shipping_fee_min,
  DROP COLUMN IF EXISTS shipping_fee_max,
  DROP COLUMN IF EXISTS shipping_fee_intra,
  DROP COLUMN IF EXISTS shipping_fee_inter,
  DROP COLUMN IF EXISTS shipping_fee_region;

COMMENT ON COLUMN public.profiles.shipping_carriers IS
  'Carrier codes the shop ships with (see src/lib/shipping-carriers.ts): ghn, vtp, shopee, self.';
COMMENT ON COLUMN public.profiles.shipping_fees IS
  'Per-carrier tiered fees (VND): { "<carrier>": { "intra": int, "inter": int, "region": int } }.';
