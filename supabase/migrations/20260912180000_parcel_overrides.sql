-- The parcel is the product kind, and the seller may keep their own numbers.
--
-- 20260912120000 introduced parcel presets named raw/slab/bundle/box. They
-- did not match the six kinds a listing already declares (card, box, pack,
-- deck, accessory, other), so the seller answered the same question twice.
-- Presets are now keyed by product kind, with researched default weights and
-- dimensions in src/lib/parcel.ts, and a seller who packs differently saves
-- their own numbers per kind here. Checkout quotes with those numbers, so the
-- parcel the buyer paid for is the parcel the seller books.

alter table public.profiles
  add column if not exists parcel_overrides jsonb not null default '{}'::jsonb;

comment on column public.profiles.parcel_overrides is
  'Seller-saved parcel per product kind: {"card": {"weight":150,"width":12,"height":2,"length":20}, ...}. Absent kinds use PARCEL_PRESETS in src/lib/parcel.ts.';

-- The shop default is the product kind now; the old preset names collapse to it.
alter table public.profiles alter column parcel_preset set default 'card';
update public.profiles set parcel_preset = 'card'
  where parcel_preset is null or parcel_preset not in ('card', 'box', 'pack', 'deck', 'accessory', 'other');

comment on column public.profiles.parcel_preset is
  'UNUSED since 2026-09-12 18:00: the parcel is the listing''s product_kind plus profiles.parcel_overrides. Kept for the orders that recorded it.';
comment on column public.cards.parcel_preset is
  'UNUSED since 2026-09-12 18:00: the parcel is product_kind. Kept nullable; nothing writes it.';
comment on column public.orders.parcel_preset is
  'Product kind the checkout quote was priced as (card/box/pack/deck/accessory/other; older rows say raw/slab/bundle).';
