-- The carrier's own ids for a delivery address, beside the country's.
--
-- shipping_addresses already holds what Vietnam has since Nghị quyết
-- 202/2025/QH15 — province and ward, no district. GoShip routes on the pre-2025
-- structure, so booking needs its city/district/ward as well, and the two can
-- never be derived from each other: Ho Chi Minh City now contains wards named
-- Bà Rịa and Vũng Tàu that GoShip still files under a province of their own.
--
-- Only the three ids are stored. Recipient name, phone and street already live
-- on the row and are the authoritative copies; duplicating them into this blob
-- would let a buyer edit their name and leave a waybill printing the old one.
-- That is the difference from profiles.goship_pickup, which has to be
-- self-contained because profiles has no shipping name or street of its own.
alter table public.shipping_addresses
  add column if not exists goship jsonb;

comment on column public.shipping_addresses.goship is
  'GoShip city/district/ward ids for this address. Name, phone and street come from the row itself. Never derived from province_id/ward_code.';

alter table public.shipping_addresses
  drop constraint if exists shipping_addresses_goship_shape;

alter table public.shipping_addresses
  add constraint shipping_addresses_goship_shape check (
    goship is null or (
      jsonb_typeof(goship) = 'object'
      and goship ->> 'city' ~ '^[0-9]{1,12}$'
      and goship ->> 'district' ~ '^[0-9]{1,12}$'
      and goship ->> 'ward' ~ '^[0-9]{1,12}$'
    )
  );

-- The order keeps its own copy, taken at checkout.
--
-- Snapshot, not a reference: an address book entry can be edited or deleted
-- after an order is placed, and a waybill has to be bookable from what the
-- buyer chose at the time. orders.to_* already snapshot the rest for the same
-- reason.
alter table public.orders
  add column if not exists to_goship jsonb;

comment on column public.orders.to_goship is
  'GoShip city/district/ward ids captured at checkout. Snapshot, like to_province_id and to_ward_code beside it.';

alter table public.orders
  drop constraint if exists orders_to_goship_shape;

alter table public.orders
  add constraint orders_to_goship_shape check (
    to_goship is null or (
      jsonb_typeof(to_goship) = 'object'
      and to_goship ->> 'city' ~ '^[0-9]{1,12}$'
      and to_goship ->> 'district' ~ '^[0-9]{1,12}$'
      and to_goship ->> 'ward' ~ '^[0-9]{1,12}$'
    )
  );

-- Orders that can be booked through GoShip, for the prompt that asks a seller
-- to create the waybill.
create index if not exists orders_bookable_idx
  on public.orders (seller_id, status)
  where to_goship is not null and tracking_number is null;
