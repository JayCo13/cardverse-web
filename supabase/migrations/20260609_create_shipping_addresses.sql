-- TikTok-style buyer address book.
--
-- Replaces the single-default model (profiles.default_shipping_*) with a real
-- table so a buyer can save many addresses, mark one default, and add/edit/
-- delete/choose them straight from the checkout modal (no detour through
-- profile settings). The old profiles.default_shipping_* columns are kept for
-- backward compatibility and are backfilled into this table below.

create table if not exists public.shipping_addresses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  recipient_name  text not null,
  phone           text not null,
  province_id     integer not null,
  province_name   text not null,
  district_id     integer not null,
  district_name   text not null,
  ward_code       text not null,
  ward_name       text not null,
  detail          text not null,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists shipping_addresses_user_id_idx
  on public.shipping_addresses(user_id);

-- At most one default address per user.
create unique index if not exists shipping_addresses_one_default_per_user
  on public.shipping_addresses(user_id)
  where is_default;

alter table public.shipping_addresses enable row level security;

-- A user fully owns their own address rows. The buy route runs as the user, so
-- these policies also cover reads/writes during checkout.
create policy "own shipping addresses - select"
  on public.shipping_addresses for select to authenticated
  using (auth.uid() = user_id);

create policy "own shipping addresses - insert"
  on public.shipping_addresses for insert to authenticated
  with check (auth.uid() = user_id);

create policy "own shipping addresses - update"
  on public.shipping_addresses for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own shipping addresses - delete"
  on public.shipping_addresses for delete to authenticated
  using (auth.uid() = user_id);

-- Backfill: seed one default address per user from the existing
-- profiles.default_shipping_* values, where they form a complete address.
insert into public.shipping_addresses (
  user_id, recipient_name, phone,
  province_id, province_name, district_id, district_name,
  ward_code, ward_name, detail, is_default
)
select
  p.id,
  coalesce(p.default_shipping_name, p.display_name, 'Người nhận'),
  coalesce(p.default_shipping_phone, p.phone_number, ''),
  p.default_shipping_province_id,
  coalesce(p.default_shipping_province_name, ''),
  p.default_shipping_district_id,
  coalesce(p.default_shipping_district_name, ''),
  p.default_shipping_ward_code,
  coalesce(p.default_shipping_ward_name, ''),
  coalesce(p.default_shipping_detail, ''),
  true
from public.profiles p
where p.default_shipping_province_id is not null
  and p.default_shipping_district_id is not null
  and p.default_shipping_ward_code is not null
  and not exists (
    select 1 from public.shipping_addresses sa where sa.user_id = p.id
  );
