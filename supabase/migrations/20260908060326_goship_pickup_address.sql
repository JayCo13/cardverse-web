-- Where a courier collects from, in the courier's own geography.
--
-- Kept apart from address_province_id / address_ward_code on purpose. Those are
-- the 2025 structure this country has — 34 provinces, no districts, per Nghị
-- quyết 202/2025/QH15 — and address-picker.tsx marks the district fields
-- deprecated for exactly that reason. GoShip still routes on the pre-2025
-- structure: 63 provinces with districts under them.
--
-- The two must never be joined or translated. Ho Chi Minh City now contains
-- wards named Bà Rịa and Vũng Tàu that GoShip still files under a province of
-- their own, so matching by name books a pickup in the wrong city and reports
-- success. One JSONB column, filled only from GoShip's own lists, makes that
-- mistake impossible to make by accident: there is no province_id here to join
-- the wrong thing to.
--
-- One address per seller rather than per shipment: a seller ships from the same
-- place every time, and asking again per order is how a booking flow loses
-- people.
alter table public.profiles
  add column if not exists goship_pickup jsonb;

comment on column public.profiles.goship_pickup is
  'Pickup address in GoShip''s pre-2025 geography (city/district/ward are GoShip ids). Never joined with address_* columns, which hold the 2025 structure.';

-- Shape is enforced here rather than trusted from the route: this feeds a real
-- courier dispatch, and a null slipping into `ward` surfaces as a driver at the
-- wrong door rather than as an error anyone sees.
alter table public.profiles
  drop constraint if exists profiles_goship_pickup_shape;

alter table public.profiles
  add constraint profiles_goship_pickup_shape check (
    goship_pickup is null or (
      jsonb_typeof(goship_pickup) = 'object'
      and goship_pickup ? 'city'
      and goship_pickup ? 'district'
      and goship_pickup ? 'ward'
      and goship_pickup ? 'street'
      and goship_pickup ? 'name'
      and goship_pickup ? 'phone'
      -- GoShip ids are digit strings; anything else means a value came from the
      -- app's own address tables, which is the failure this guards against.
      and goship_pickup ->> 'city' ~ '^[0-9]{1,12}$'
      and goship_pickup ->> 'district' ~ '^[0-9]{1,12}$'
      and goship_pickup ->> 'ward' ~ '^[0-9]{1,12}$'
      and length(coalesce(goship_pickup ->> 'street', '')) between 1 and 255
      and length(coalesce(goship_pickup ->> 'name', '')) between 1 and 120
      -- Vietnamese mobile numbers, the only kind a carrier will call.
      and goship_pickup ->> 'phone' ~ '^0[0-9]{8,10}$'
    )
  );

-- Sellers with a pickup address are the ones a booking flow can serve; the
-- partial index keeps that lookup off the rest of the table.
create index if not exists profiles_goship_pickup_idx
  on public.profiles (id)
  where goship_pickup is not null;
