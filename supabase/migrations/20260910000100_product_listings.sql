begin;
alter table public.cards
  add column if not exists product_kind text not null default 'card',
  add column if not exists product_type_label text,
  add column if not exists product_details jsonb not null default '{}'::jsonb;

create or replace function public.valid_product_details(p_details jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(p_details) = 'object' then
    not exists (select 1 from jsonb_each(p_details) e where
      e.key not in ('brand','edition','language','product_code')
      or jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 100)
    else false end
$$;

-- Re-runnable: a constraint cannot be added twice, and this migration has not
-- reached any environment yet, so dropping first costs nothing.
alter table public.cards
  drop constraint if exists cards_product_kind_check,
  drop constraint if exists cards_product_details_check,
  drop constraint if exists cards_other_type_check,
  drop constraint if exists cards_product_identity_check;

alter table public.cards add constraint cards_product_kind_check
  check (product_kind in ('card','box','pack','deck','accessory','other')),
  add constraint cards_product_details_check check (public.valid_product_details(product_details)),
  add constraint cards_other_type_check check (product_kind <> 'other' or length(trim(coalesce(product_type_label,''))) between 2 and 80),
  add constraint cards_product_identity_check check (product_kind = 'card' or (
    listing_type = 'sale' and not is_bundle and quantity = 1
    and catalog_product_id is null and catalog_soccer_id is null
    and card_number is null and grading_company is null and grade is null and finish is null
    and condition is not null and condition in ('sealed','new','opened','used')));

-- Extend the existing guarded function, preserving account, KYC, pickup,
-- idempotency and all current insert fields (including shipping_fee).
do $$
declare d text; a text := 'seller_id, status, name, description, listing_type, category, condition,';
  b text := 'v_actor, ''active'', v_name, v_description, v_listing_type,';
begin
  d := pg_get_functiondef('public.create_marketplace_listing(uuid,text,jsonb)'::regprocedure);
  if position('product_kind' in d) > 0 then return; end if;
  if position(a in d) = 0 or position(b in d) = 0 then
    raise exception 'Unexpected create_marketplace_listing definition';
  end if;
  d := replace(d, a, 'product_kind, product_type_label, product_details, ' || a);
  d := replace(d, b, 'coalesce(p_card ->> ''product_kind'', ''card''), nullif(trim(p_card ->> ''product_type_label''), ''''), coalesce(p_card -> ''product_details'', ''{}''::jsonb), ' || b);
  execute d;
end $$;

-- The patch above rewrites a function by string surgery. If a future migration
-- reshapes that insert, the anchors stop matching and the seller would silently
-- lose the product columns; fail the deploy instead.
do $$
begin
  if pg_get_functiondef('public.create_marketplace_listing(uuid,text,jsonb)'::regprocedure)
     not like '%product_kind%' then
    raise exception 'create_marketplace_listing does not carry product_kind';
  end if;
end $$;

create or replace function public.guard_product_listing_update() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.product_kind is distinct from old.product_kind or
     (old.product_kind <> 'card' and new.category is distinct from old.category) then
    raise exception 'product_identity_locked';
  end if;
  if old.product_kind <> 'card' and (
    row(new.name,new.description,new.price,new.condition,new.product_details,new.product_type_label,new.shipping_fee,new.image_urls,new.image_url,new.accept_offers,new.min_offer_percent)
    is distinct from row(old.name,old.description,old.price,old.condition,old.product_details,old.product_type_label,old.shipping_fee,old.image_urls,old.image_url,old.accept_offers,old.min_offer_percent)
  ) then
    if old.status <> 'active' or exists (
      select 1 from public.offers where card_id=old.id and status in ('pending','accepted','chosen','on_hold')
    ) then raise exception 'open_offers_locked'; end if;
    if exists (select 1 from public.orders where card_id=old.id and status not in ('cancelled','completed')) then
      raise exception 'listing_not_editable';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_product_listing_update on public.cards;
create trigger guard_product_listing_update before update on public.cards
for each row execute function public.guard_product_listing_update();

-- A separate RPC avoids overloading the legacy edit signature used by old clients.
create or replace function public.update_own_product_listing(p_listing_id uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.cards%rowtype; result jsonb;
begin
  perform public.assert_account_session();
  select * into c from public.cards where id=p_listing_id for update;
  if not found or auth.uid() is null or c.seller_id <> auth.uid() then raise exception 'listing_not_found'; end if;
  if c.product_kind='card' then raise exception 'listing_not_editable'; end if;
  if not public.valid_product_details(p_data -> 'product_details')
     or jsonb_typeof(p_data -> 'shipping_fee') is distinct from 'number'
     or (p_data ->> 'shipping_fee')::numeric <> trunc((p_data ->> 'shipping_fee')::numeric)
     or (p_data ->> 'shipping_fee')::numeric not between 0 and 99999 then
    raise exception 'invalid_listing_payload';
  end if;
  result := public.update_own_sale_listing(p_listing_id, p_data ->> 'name', p_data ->> 'description',
    (p_data ->> 'price')::bigint, (p_data ->> 'acceptOffers')::boolean, (p_data ->> 'minOfferPercent')::integer);
  update public.cards set condition=p_data ->> 'condition', product_details=p_data -> 'product_details',
    product_type_label=nullif(trim(p_data ->> 'product_type_label'),''), shipping_fee=(p_data ->> 'shipping_fee')::integer
    where id=p_listing_id;
  return result;
end $$;
revoke all on function public.update_own_product_listing(uuid,jsonb) from public, anon;
grant execute on function public.update_own_product_listing(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
