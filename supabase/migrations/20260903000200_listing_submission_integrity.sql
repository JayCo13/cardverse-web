-- Make listing creation replay-safe and listing edits atomic.
-- Runs after the bundle-offer migration from the same release.

create table if not exists public.listing_create_requests (
  seller_id uuid not null references public.profiles(id) on delete cascade,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  card_id uuid not null references public.cards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (seller_id, idempotency_key),
  unique (card_id)
);

alter table public.listing_create_requests enable row level security;
revoke all on public.listing_create_requests from public, anon, authenticated;

create or replace function public.create_marketplace_listing(
  p_idempotency_key uuid,
  p_request_hash text,
  p_card jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.listing_create_requests%rowtype;
  v_profile public.profiles%rowtype;
  v_card_id uuid;
  v_listing_type text := p_card ->> 'listing_type';
  v_name text := trim(coalesce(p_card ->> 'name', ''));
  v_description text := trim(coalesce(p_card ->> 'description', ''));
  v_quantity integer;
  v_min_offer integer;
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  if p_idempotency_key is null
     or p_request_hash is null
     or p_request_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_card) <> 'object' then
    raise exception 'invalid_listing_request';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('listing-create:' || v_actor::text || ':' || p_idempotency_key::text, 0)
  );

  select * into v_existing
  from public.listing_create_requests
  where seller_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception 'idempotency_conflict';
    end if;
    return jsonb_build_object(
      'success', true,
      'cardId', v_existing.card_id,
      'replayed', true
    );
  end if;

  if not exists (
    select 1 from public.seller_verifications
    where user_id = v_actor and status = 'approved'
  ) then
    raise exception 'seller_verification_required';
  end if;

  select * into v_profile from public.profiles where id = v_actor;
  if not found or v_profile.address_district_id is null or v_profile.address_ward_code is null then
    raise exception 'missing_seller_address';
  end if;
  if not exists (
    select 1
    from unnest(coalesce(v_profile.shipping_carriers, '{}'::text[])) carrier
    where carrier <> 'self'
      and jsonb_typeof(v_profile.shipping_fees -> carrier -> 'intra') = 'number'
      and jsonb_typeof(v_profile.shipping_fees -> carrier -> 'inter') = 'number'
      and jsonb_typeof(v_profile.shipping_fees -> carrier -> 'region') = 'number'
      and (v_profile.shipping_fees -> carrier ->> 'intra')::numeric between 1 and 99999
      and (v_profile.shipping_fees -> carrier ->> 'inter')::numeric between 1 and 99999
      and (v_profile.shipping_fees -> carrier ->> 'region')::numeric between 1 and 99999
      and (v_profile.shipping_fees -> carrier ->> 'intra')::numeric = trunc((v_profile.shipping_fees -> carrier ->> 'intra')::numeric)
      and (v_profile.shipping_fees -> carrier ->> 'inter')::numeric = trunc((v_profile.shipping_fees -> carrier ->> 'inter')::numeric)
      and (v_profile.shipping_fees -> carrier ->> 'region')::numeric = trunc((v_profile.shipping_fees -> carrier ->> 'region')::numeric)
  ) then
    raise exception 'missing_shipping_config';
  end if;

  if length(v_name) < 5 or length(v_name) > 200
     or length(v_description) < 100 or length(v_description) > 3000
     or v_listing_type not in ('sale', 'auction', 'razz')
     or nullif(trim(coalesce(p_card ->> 'category', '')), '') is null
     or nullif(trim(coalesce(p_card ->> 'image_url', '')), '') is null
     or jsonb_typeof(p_card -> 'image_urls') <> 'array'
     or jsonb_array_length(p_card -> 'image_urls') < 1
     or jsonb_array_length(p_card -> 'image_urls') > 4 then
    raise exception 'invalid_listing_payload';
  end if;

  begin
    v_quantity := (p_card ->> 'quantity')::integer;
    v_min_offer := coalesce((p_card ->> 'min_offer_percent')::integer, 0);
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_listing_payload';
  end;
  if v_quantity < 1 or v_quantity > 100 or v_min_offer < 0 or v_min_offer > 100 then
    raise exception 'invalid_listing_payload';
  end if;

  if v_listing_type = 'sale' and (
    jsonb_typeof(p_card -> 'price') <> 'number' or (p_card ->> 'price')::bigint < 1000
  ) then
    raise exception 'invalid_listing_price';
  elsif v_listing_type = 'auction' and (
    jsonb_typeof(p_card -> 'starting_bid') <> 'number'
    or (p_card ->> 'starting_bid')::bigint < 1000
    or nullif(p_card ->> 'auction_ends', '') is null
    or (p_card ->> 'auction_ends')::timestamptz <= now()
  ) then
    raise exception 'invalid_listing_auction';
  elsif v_listing_type = 'razz' and (
    jsonb_typeof(p_card -> 'ticket_price') <> 'number'
    or (p_card ->> 'ticket_price')::bigint < 1000
    or (p_card ->> 'total_tickets')::integer not between 2 and 1000
  ) then
    raise exception 'invalid_listing_razz';
  end if;

  insert into public.cards (
    seller_id, status, name, description, listing_type, category, condition,
    image_url, image_urls, publisher, set_name, season, quantity,
    catalog_product_id, catalog_soccer_id, card_number, language,
    grading_company, grade, finish, accept_offers, min_offer_percent,
    is_bundle, bundle_items, price, current_bid, starting_bid, auction_ends,
    ticket_price, total_tickets, razz_entries
  ) values (
    v_actor, 'active', v_name, v_description, v_listing_type,
    nullif(trim(p_card ->> 'category'), ''), nullif(trim(p_card ->> 'condition'), ''),
    nullif(trim(p_card ->> 'image_url'), ''),
    array(select jsonb_array_elements_text(p_card -> 'image_urls')),
    nullif(trim(p_card ->> 'publisher'), ''), nullif(trim(p_card ->> 'set_name'), ''),
    nullif(trim(p_card ->> 'season'), ''), v_quantity,
    case when jsonb_typeof(p_card -> 'catalog_product_id') = 'number' then (p_card ->> 'catalog_product_id')::bigint else null end,
    case when jsonb_typeof(p_card -> 'catalog_soccer_id') = 'number' then (p_card ->> 'catalog_soccer_id')::bigint else null end,
    nullif(trim(p_card ->> 'card_number'), ''), nullif(trim(p_card ->> 'language'), ''),
    nullif(trim(p_card ->> 'grading_company'), ''),
    case when jsonb_typeof(p_card -> 'grade') = 'number' then (p_card ->> 'grade')::numeric else null end,
    nullif(trim(p_card ->> 'finish'), ''), coalesce((p_card ->> 'accept_offers')::boolean, false),
    v_min_offer, coalesce((p_card ->> 'is_bundle')::boolean, false),
    case when jsonb_typeof(p_card -> 'bundle_items') = 'array' then p_card -> 'bundle_items' else null end,
    case when v_listing_type = 'sale' then (p_card ->> 'price')::bigint else null end,
    case when v_listing_type = 'auction' then (p_card ->> 'starting_bid')::bigint else null end,
    case when v_listing_type = 'auction' then (p_card ->> 'starting_bid')::bigint else null end,
    case when v_listing_type = 'auction' then (p_card ->> 'auction_ends')::timestamptz else null end,
    case when v_listing_type = 'razz' then (p_card ->> 'ticket_price')::bigint else null end,
    case when v_listing_type = 'razz' then (p_card ->> 'total_tickets')::integer else null end,
    case when v_listing_type = 'razz' then 0 else null end
  ) returning id into v_card_id;

  insert into public.listing_create_requests (seller_id, idempotency_key, request_hash, card_id)
  values (v_actor, p_idempotency_key, p_request_hash, v_card_id);

  return jsonb_build_object('success', true, 'cardId', v_card_id, 'replayed', false);
end;
$$;

create or replace function public.update_own_sale_listing(
  p_listing_id uuid,
  p_name text,
  p_description text,
  p_price bigint,
  p_accept_offers boolean,
  p_min_offer_percent integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_card public.cards%rowtype;
  v_description_changed boolean;
  v_commercial_changed boolean;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'unauthorized'; end if;

  select * into v_card from public.cards where id = p_listing_id for update;
  if not found or v_card.seller_id <> v_actor then raise exception 'listing_not_found'; end if;
  if v_card.status <> 'active' or v_card.listing_type <> 'sale' then
    raise exception 'listing_not_editable';
  end if;

  v_description_changed := trim(coalesce(p_description, '')) <> trim(coalesce(v_card.description, ''));
  if p_price is null or p_accept_offers is null or p_min_offer_percent is null
     or length(trim(coalesce(p_name, ''))) < 5 or length(trim(p_name)) > 200
     or length(trim(coalesce(p_description, ''))) > 3000
     or (v_description_changed and length(trim(coalesce(p_description, ''))) < 100)
     or p_price < 1000
     or p_min_offer_percent not between 0 and 100 then
    raise exception 'invalid_listing_payload';
  end if;

  v_commercial_changed := p_price <> coalesce(v_card.price, 0)
    or p_accept_offers <> coalesce(v_card.accept_offers, false)
    or (case when p_accept_offers then p_min_offer_percent else 0 end) <> coalesce(v_card.min_offer_percent, 0);
  if v_commercial_changed and exists (
    select 1 from public.offers
    where card_id = p_listing_id and status in ('pending', 'accepted', 'chosen')
  ) then
    raise exception 'open_offers_locked';
  end if;

  update public.cards
  set name = trim(p_name), description = trim(p_description), price = p_price,
      accept_offers = p_accept_offers,
      min_offer_percent = case when p_accept_offers then p_min_offer_percent else 0 end,
      updated_at = now()
  where id = p_listing_id
  returning jsonb_build_object(
    'id', id, 'name', name, 'description', description, 'price', price,
    'quantity', quantity, 'accept_offers', accept_offers,
    'min_offer_percent', min_offer_percent
  ) into v_result;

  return jsonb_build_object('listing', v_result);
end;
$$;

revoke all on function public.create_marketplace_listing(uuid, text, jsonb) from public, anon;
revoke all on function public.update_own_sale_listing(uuid, text, text, bigint, boolean, integer) from public, anon;
grant execute on function public.create_marketplace_listing(uuid, text, jsonb) to authenticated;
grant execute on function public.update_own_sale_listing(uuid, text, text, bigint, boolean, integer) to authenticated;
