-- Receiving addresses are picked in GoShip's geography, like the sender's.
--
-- shipping_addresses used to hold the 2025 structure (34 provinces, no
-- district) with GoShip's ids as an optional extra in `goship`. From now on
-- the buyer picks Tỉnh → Quận/Huyện → Phường/Xã from GoShip's own lists, and
-- /api/shipping-addresses copies the ids and names into province_id/name,
-- district_id/name and ward_code/name — the same thing
-- /api/shipping/pickup-address does for profiles.address_*. Both ends of a
-- waybill now sit in one geography, so resolveShippingTier compares like with
-- like and nothing is ever translated between the two maps.
--
-- Rows saved before this keep their 2025 codes and a null `goship`. The
-- address book flags them and re-picks on edit; PATCH refuses to promote one
-- to default until it has been re-picked.

comment on column public.shipping_addresses.goship is
  'GoShip city/district/ward ids this address was picked in. province_*/district_*/ward_* are copied from GoShip''s lists on save. Null only on rows saved before 2026-09-11, which cannot be booked until re-picked.';
comment on column public.shipping_addresses.district_id is
  'GoShip district id, copied on save. Null on rows saved between the 2025 reorganisation and 2026-09-11.';
comment on column public.shipping_addresses.district_name is
  'GoShip district name, copied on save. Null on rows saved between the 2025 reorganisation and 2026-09-11.';

-- The two-way sync between profiles.address_* and the default receiving
-- address goes. It was written when both were the same 2025 address typed
-- twice; now each is derived from a different GoShip pick and the sync only
-- corrupts:
--
--   * profiles → shipping_addresses copied the seller's pickup columns onto the
--     buyer's default receiving row without touching `goship`, leaving a row
--     whose ids and names disagree — a waybill to one place, a label naming
--     another.
--   * shipping_addresses → profiles overwrote the seller's pickup-derived
--     columns with wherever they happen to receive parcels, so a shop shipping
--     from Hồ Chí Minh was tiered as Cà Mau after its owner bought something.
--
-- profiles.address_* is written by /api/shipping/pickup-address alone.

drop trigger if exists trg_sync_default_address_to_pickup on public.shipping_addresses;
drop function if exists public.sync_default_address_to_pickup();

drop trigger if exists trg_sync_pickup_address_to_default on public.profiles;
drop function if exists public.sync_pickup_address_to_default();
