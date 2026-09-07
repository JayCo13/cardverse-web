-- Keep a seller's pickup address aligned with their default receiving address.
-- Non-default receiving addresses remain independent.

create or replace function public.sync_default_address_to_pickup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_default and exists (
    select 1
    from public.profiles p
    where p.id = new.user_id
      and row(
        p.address_province_id,
        p.address_province_name,
        p.address_district_id,
        p.address_district_name,
        p.address_ward_code,
        p.address_ward_name,
        p.address_detail
      ) is distinct from row(
        new.province_id,
        new.province_name,
        null::integer,
        null::text,
        new.ward_code,
        new.ward_name,
        new.detail
      )
  ) then
    update public.profiles
    set address_province_id = new.province_id,
        address_province_name = new.province_name,
        address_district_id = null,
        address_district_name = null,
        address_ward_code = new.ward_code,
        address_ward_name = new.ward_name,
        address_detail = new.detail,
        updated_at = now()
    where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_default_address_to_pickup on public.shipping_addresses;
create trigger trg_sync_default_address_to_pickup
after insert or update of is_default, province_id, province_name, ward_code, ward_name, detail
on public.shipping_addresses
for each row
execute function public.sync_default_address_to_pickup();

create or replace function public.sync_pickup_address_to_default()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  if new.address_province_id is null
     or new.address_ward_code is null
     or nullif(trim(coalesce(new.address_detail, '')), '') is null then
    return new;
  end if;

  update public.shipping_addresses
  set province_id = new.address_province_id,
      province_name = coalesce(new.address_province_name, ''),
      district_id = null,
      district_name = null,
      ward_code = new.address_ward_code,
      ward_name = coalesce(new.address_ward_name, ''),
      detail = new.address_detail,
      updated_at = now()
  where user_id = new.id
    and is_default
    and (
      province_id,
      province_name,
      district_id,
      district_name,
      ward_code,
      ward_name,
      detail
    ) is distinct from (
      new.address_province_id,
      coalesce(new.address_province_name, ''),
      null::integer,
      null::text,
      new.address_ward_code,
      coalesce(new.address_ward_name, ''),
      new.address_detail
    );
  get diagnostics v_updated = row_count;

  if v_updated = 0 and not exists (
    select 1 from public.shipping_addresses
    where user_id = new.id and is_default
  ) then
    insert into public.shipping_addresses (
      user_id,
      recipient_name,
      phone,
      province_id,
      province_name,
      district_id,
      district_name,
      ward_code,
      ward_name,
      detail,
      is_default
    ) values (
      new.id,
      coalesce(nullif(trim(new.display_name), ''), 'Người nhận'),
      coalesce(new.phone_number, ''),
      new.address_province_id,
      coalesce(new.address_province_name, ''),
      null,
      null,
      new.address_ward_code,
      coalesce(new.address_ward_name, ''),
      new.address_detail,
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_pickup_address_to_default on public.profiles;
create trigger trg_sync_pickup_address_to_default
after update of
  address_province_id,
  address_province_name,
  address_district_id,
  address_district_name,
  address_ward_code,
  address_ward_name,
  address_detail
on public.profiles
for each row
when (
  old.address_province_id is distinct from new.address_province_id
  or old.address_province_name is distinct from new.address_province_name
  or old.address_district_id is distinct from new.address_district_id
  or old.address_district_name is distinct from new.address_district_name
  or old.address_ward_code is distinct from new.address_ward_code
  or old.address_ward_name is distinct from new.address_ward_name
  or old.address_detail is distinct from new.address_detail
)
execute function public.sync_pickup_address_to_default();

-- The current UI and address schema accept province + ward, but the listing RPC
-- introduced before the two-level migration still requires a district. Patch
-- only that known clause and fail loudly if the live definition has drifted.
do $$
declare
  v_fn regprocedure := to_regprocedure(
    'public.create_marketplace_listing(uuid,text,jsonb)'
  );
  v_def text;
  v_old constant text := 'v_profile.address_district_id is null or v_profile.address_ward_code is null';
  v_new constant text := 'v_profile.address_province_id is null or v_profile.address_ward_code is null';
begin
  if v_fn is null then
    raise exception 'create_marketplace_listing was not found';
  end if;

  select pg_get_functiondef(v_fn::oid) into v_def;
  if position(v_old in v_def) > 0 then
    execute replace(v_def, v_old, v_new);
  elsif position(v_new in v_def) = 0 then
    raise exception 'create_marketplace_listing address check has drifted; verify it manually';
  end if;
end
$$;
