alter table public.profiles
  add column if not exists default_shipping_name text,
  add column if not exists default_shipping_phone text,
  add column if not exists default_shipping_address text,
  add column if not exists default_shipping_province_id integer,
  add column if not exists default_shipping_province_name text,
  add column if not exists default_shipping_district_id integer,
  add column if not exists default_shipping_district_name text,
  add column if not exists default_shipping_ward_code text,
  add column if not exists default_shipping_ward_name text,
  add column if not exists default_shipping_detail text;

update public.profiles
set
  default_shipping_name = coalesce(default_shipping_name, display_name),
  default_shipping_phone = coalesce(default_shipping_phone, phone_number),
  default_shipping_address = coalesce(default_shipping_address, address),
  default_shipping_province_id = coalesce(default_shipping_province_id, address_province_id),
  default_shipping_province_name = coalesce(default_shipping_province_name, address_province_name),
  default_shipping_district_id = coalesce(default_shipping_district_id, address_district_id),
  default_shipping_district_name = coalesce(default_shipping_district_name, address_district_name),
  default_shipping_ward_code = coalesce(default_shipping_ward_code, address_ward_code),
  default_shipping_ward_name = coalesce(default_shipping_ward_name, address_ward_name),
  default_shipping_detail = coalesce(default_shipping_detail, address_detail)
where
  default_shipping_name is null
  or default_shipping_phone is null
  or default_shipping_address is null
  or default_shipping_province_id is null
  or default_shipping_district_id is null
  or default_shipping_ward_code is null
  or default_shipping_detail is null;

alter table public.payment_orders
  drop constraint if exists payment_orders_package_type_check;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payment_orders_package_type_check'
      and conrelid = 'public.payment_orders'::regclass
  ) then
    alter table public.payment_orders
      add constraint payment_orders_package_type_check
      check (package_type in ('day_pass', 'credit_pack', 'vip_pro', 'deposit', 'marketplace_order'));
  end if;
end $$;
