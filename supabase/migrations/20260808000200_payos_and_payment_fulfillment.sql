-- Withdrawal verification and verified-fund provenance.
-- Phase 2/5: PayOS inbox, payment fulfillment, subscriptions and scan credits.

-- 6. Atomic payment, spend and verified credit primitives
-- ---------------------------------------------------------------------------

alter table public.payment_orders
  add column if not exists currency text not null default 'VND',
  add column if not exists server_idempotency_key uuid,
  add column if not exists server_request_hash text,
  add column if not exists link_creation_claim_id uuid,
  add column if not exists link_creation_started_at timestamptz;

create unique index if not exists payment_orders_server_idempotency_idx
  on public.payment_orders (user_id, server_idempotency_key)
  where server_idempotency_key is not null;

alter table public.wallet_fund_allocations
  add column if not exists group_idempotency_key uuid,
  add column if not exists occurred_at timestamptz not null default now();

create index if not exists wallet_fund_allocations_group_idx
  on public.wallet_fund_allocations (user_id, group_idempotency_key);

create or replace function public.stable_financial_uuid(p_value text)
returns uuid
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select (
    substr(md5(p_value), 1, 8) || '-' ||
    substr(md5(p_value), 9, 4) || '-' ||
    substr(md5(p_value), 13, 4) || '-' ||
    substr(md5(p_value), 17, 4) || '-' ||
    substr(md5(p_value), 21, 12)
  )::uuid;
$$;

create or replace function public.ensure_wallet_for_user(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet_id uuid;
begin
  if p_user_id is null then
    raise exception 'unauthorized';
  end if;

  insert into public.wallets (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select id into v_wallet_id
  from public.wallets
  where user_id = p_user_id;

  return v_wallet_id;
end;
$$;

create or replace function public.create_server_payment_order(
  p_user_id uuid,
  p_order_code bigint,
  p_package_type text,
  p_amount bigint,
  p_currency text,
  p_idempotency_key uuid
)
returns public.payment_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.payment_orders%rowtype;
begin
  perform public.assert_financial_mutations_enabled();

  if p_user_id is null
     or p_amount is null or p_amount <= 0
     or p_order_code is null
     or p_idempotency_key is null
     or coalesce(trim(p_currency), '') <> 'VND'
     or p_package_type not in ('day_pass', 'credit_pack', 'vip_pro', 'deposit', 'marketplace_order') then
    raise exception 'invalid_payment_order';
  end if;

  select * into v_order
  from public.payment_orders
  where user_id = p_user_id and server_idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_order.amount <> p_amount
       or v_order.package_type <> p_package_type
       or v_order.currency <> p_currency then
      raise exception 'idempotency_conflict';
    end if;
    return v_order;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('payment-order-user:' || p_user_id::text, 0));
  select * into v_order
  from public.payment_orders
  where user_id = p_user_id and server_idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_order.amount <> p_amount
       or v_order.package_type <> p_package_type
       or v_order.currency <> p_currency then
      raise exception 'idempotency_conflict';
    end if;
    return v_order;
  end if;
  if (select count(*) from public.payment_orders
      where user_id = p_user_id and created_at >= now() - interval '1 minute') >= 5 then
    raise exception 'payment_rate_limited';
  end if;

  insert into public.payment_orders (
    user_id, order_code, package_type, amount, currency, status,
    server_idempotency_key
  ) values (
    p_user_id, p_order_code, p_package_type, p_amount, p_currency, 'pending',
    p_idempotency_key
  )
  on conflict (user_id, server_idempotency_key)
    where server_idempotency_key is not null
  do nothing
  returning * into v_order;

  if not found then
    select * into v_order
    from public.payment_orders
    where user_id = p_user_id and server_idempotency_key = p_idempotency_key
    for update;
    if not found
       or v_order.amount <> p_amount
       or v_order.package_type <> p_package_type
       or v_order.currency <> p_currency then
      raise exception 'idempotency_conflict';
    end if;
  end if;

  return v_order;
end;
$$;

create or replace function public.claim_payos_payment_link_creation(
  p_user_id uuid,
  p_order_code bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.payment_orders%rowtype;
  v_claim_id uuid;
begin
  perform public.assert_financial_mutations_enabled();
  select * into v_order
  from public.payment_orders
  where user_id = p_user_id and order_code = p_order_code
  for update;
  if not found then raise exception 'payment_order_not_found'; end if;

  if v_order.payos_checkout_url is not null then
    return jsonb_build_object(
      'ok', true, 'claimed', false, 'attached', true,
      'checkout_url', v_order.payos_checkout_url
    );
  end if;
  if v_order.status <> 'pending' then
    raise exception 'payment_order_not_pending';
  end if;
  if v_order.link_creation_claim_id is not null then
    return jsonb_build_object(
      'ok', true, 'claimed', false, 'attached', false,
      'recovery_required', true
    );
  end if;

  v_claim_id := gen_random_uuid();
  update public.payment_orders
  set link_creation_claim_id = v_claim_id,
      link_creation_started_at = now(),
      updated_at = now()
  where id = v_order.id;
  return jsonb_build_object('ok', true, 'claimed', true, 'claim_id', v_claim_id);
end;
$$;

create or replace function public.attach_claimed_payos_payment_link(
  p_user_id uuid,
  p_order_code bigint,
  p_claim_id uuid,
  p_payment_link_id text,
  p_checkout_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.payment_orders%rowtype;
begin
  perform public.assert_financial_mutations_enabled();
  if p_claim_id is null
     or coalesce(trim(p_payment_link_id), '') = ''
     or coalesce(trim(p_checkout_url), '') = '' then
    raise exception 'invalid_payos_link';
  end if;
  select * into v_order
  from public.payment_orders
  where user_id = p_user_id and order_code = p_order_code
  for update;
  if not found then raise exception 'payment_order_not_found'; end if;

  if v_order.payos_payment_link_id is not null then
    if v_order.payos_payment_link_id <> p_payment_link_id
       or v_order.payos_checkout_url <> p_checkout_url then
      raise exception 'payment_link_conflict';
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'payment_order_id', v_order.id);
  end if;
  if v_order.status <> 'pending'
     or v_order.link_creation_claim_id is distinct from p_claim_id then
    raise exception 'payment_link_claim_mismatch';
  end if;

  update public.payment_orders
  set payos_payment_link_id = p_payment_link_id,
      payos_checkout_url = p_checkout_url,
      updated_at = now()
  where id = v_order.id;
  return jsonb_build_object('ok', true, 'replayed', false, 'payment_order_id', v_order.id);
end;
$$;

create or replace function public.attach_payos_payment_link(
  p_user_id uuid,
  p_order_code bigint,
  p_payment_link_id text,
  p_checkout_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.payment_orders%rowtype;
begin
  perform public.assert_financial_mutations_enabled();

  if coalesce(trim(p_payment_link_id), '') = ''
     or coalesce(trim(p_checkout_url), '') = '' then
    raise exception 'invalid_payos_link';
  end if;

  select * into v_order
  from public.payment_orders
  where order_code = p_order_code and user_id = p_user_id
  for update;

  if not found then
    raise exception 'payment_order_not_found';
  end if;

  if v_order.status <> 'pending' then
    raise exception 'payment_order_not_pending';
  end if;

  if v_order.payos_payment_link_id is not null then
    if v_order.payos_payment_link_id <> p_payment_link_id
       or v_order.payos_checkout_url <> p_checkout_url then
      raise exception 'payment_link_conflict';
    end if;
  else
    update public.payment_orders
    set payos_payment_link_id = p_payment_link_id,
        payos_checkout_url = p_checkout_url,
        updated_at = now()
    where id = v_order.id;
  end if;

  return jsonb_build_object('ok', true, 'payment_order_id', v_order.id);
end;
$$;

-- Multiset subtraction for bundle inventory. JSONB containment alone ignores
-- duplicate multiplicity, so pair equal elements by occurrence number and
-- fail closed unless every selected item has one exact source item.
create or replace function public.subtract_bundle_selection(
  p_items jsonb,
  p_selection jsonb
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_selected_count integer;
  v_matched_count integer;
  v_remaining jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_typeof(p_selection) <> 'array'
     or jsonb_array_length(p_selection) = 0 then
    raise exception 'bundle_selection_invalid';
  end if;

  v_selected_count := jsonb_array_length(p_selection);
  with current_items as (
    select value, ordinality,
      row_number() over (partition by value order by ordinality) as occurrence
    from jsonb_array_elements(p_items) with ordinality
  ), selected_items as (
    select value, ordinality,
      row_number() over (partition by value order by ordinality) as occurrence
    from jsonb_array_elements(p_selection) with ordinality
  ), matched as (
    select s.ordinality
    from selected_items s
    join current_items c using (value, occurrence)
  )
  select count(*) into v_matched_count from matched;

  if v_matched_count <> v_selected_count then
    raise exception 'bundle_selection_invalid';
  end if;

  with current_items as (
    select value, ordinality,
      row_number() over (partition by value order by ordinality) as occurrence
    from jsonb_array_elements(p_items) with ordinality
  ), selected_items as (
    select value,
      row_number() over (partition by value order by ordinality) as occurrence
    from jsonb_array_elements(p_selection) with ordinality
  )
  select coalesce(jsonb_agg(c.value order by c.ordinality), '[]'::jsonb)
  into v_remaining
  from current_items c
  left join selected_items s using (value, occurrence)
  where s.value is null;

  return v_remaining;
end;
$$;

-- Atomically stage all database state needed by a direct-PayOS marketplace
-- checkout.  Creating the provider link remains an external call, but no
-- payment is recognized here and a crash cannot leave a payment order detached
-- from its marketplace orders or inventory reservation.
create or replace function public.stage_payos_marketplace_checkout(
  p_user_id uuid,
  p_order_code bigint,
  p_orders jsonb,
  p_idempotency_key uuid,
  p_reserved_until timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.payment_orders%rowtype;
  v_spec jsonb;
  v_card public.cards%rowtype;
  v_offer public.offers%rowtype;
  v_transaction public.transactions%rowtype;
  v_order_id uuid;
  v_card_id uuid;
  v_seller_id uuid;
  v_offer_id uuid;
  v_transaction_id uuid;
  v_amount bigint;
  v_shipping_fee bigint;
  v_total_paid bigint;
  v_checkout_total bigint := 0;
  v_request_hash text;
  v_result_orders jsonb := '[]'::jsonb;
  v_existing_count integer;
  v_bundle_before jsonb;
  v_bundle_selection jsonb;
  v_expected_remaining jsonb;
begin
  perform public.assert_financial_mutations_enabled();

  if p_user_id is null or p_order_code is null or p_idempotency_key is null
     or p_reserved_until is null or p_reserved_until <= now()
     or p_reserved_until > now() + interval '1 hour'
     or jsonb_typeof(p_orders) <> 'array'
     or jsonb_array_length(p_orders) < 1
     or jsonb_array_length(p_orders) > 100 then
    raise exception 'invalid_payos_marketplace_checkout';
  end if;

  if (
    select count(*) <> count(distinct item ->> 'order_id')
        or count(*) <> count(distinct item ->> 'card_id')
    from jsonb_array_elements(p_orders) item
  ) then
    raise exception 'duplicate_payos_marketplace_order';
  end if;

  v_request_hash := encode(digest(p_orders::text, 'sha256'), 'hex');

  -- Existing requests are resolved before looking at mutable card state. This
  -- is what makes a retry safe after cards have moved to in_transaction.
  select * into v_payment
  from public.payment_orders
  where user_id = p_user_id and server_idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_payment.package_type <> 'marketplace_order'
       or v_payment.server_request_hash is distinct from v_request_hash then
      raise exception 'idempotency_conflict';
    end if;
    select count(*), coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
    into v_existing_count, v_result_orders
    from public.orders o
    where o.payment_order_id = v_payment.id and o.buyer_id = p_user_id;
    if v_existing_count <> jsonb_array_length(p_orders)
       or (select coalesce(sum(total_paid), 0) from public.orders
           where payment_order_id = v_payment.id) <> v_payment.amount then
      raise exception 'payos_marketplace_replay_inconsistent';
    end if;
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'payment_order', to_jsonb(v_payment),
      'orders', v_result_orders
    );
  end if;

  for v_spec in
    select item from jsonb_array_elements(p_orders) item order by item ->> 'card_id'
  loop
    begin
      v_card_id := (v_spec ->> 'card_id')::uuid;
    exception when others then raise exception 'payos_marketplace_card_id_invalid'; end;
    select * into v_card from public.cards where id = v_card_id for update;
    if not found then raise exception 'payos_marketplace_card_not_found'; end if;
  end loop;

  for v_spec in select item from jsonb_array_elements(p_orders) item
  loop
    begin
      v_order_id := (v_spec ->> 'order_id')::uuid;
      v_card_id := (v_spec ->> 'card_id')::uuid;
      v_seller_id := (v_spec ->> 'seller_id')::uuid;
      v_offer_id := nullif(v_spec ->> 'offer_id', '')::uuid;
      v_transaction_id := nullif(v_spec ->> 'transaction_id', '')::uuid;
      v_amount := (v_spec ->> 'amount')::bigint;
      v_shipping_fee := coalesce((v_spec ->> 'shipping_fee')::bigint, 0);
      v_total_paid := (v_spec ->> 'total_paid')::bigint;
    exception when others then raise exception 'payos_marketplace_order_shape_invalid'; end;

    if v_amount <= 0 or v_shipping_fee < 0 or v_shipping_fee > 2147483647
       or v_total_paid <> v_amount + v_shipping_fee
       or v_seller_id = p_user_id then
      raise exception 'payos_marketplace_amount_or_party_invalid';
    end if;
    if coalesce(trim(v_spec ->> 'to_name'), '') = ''
       or coalesce(trim(v_spec ->> 'to_phone'), '') = ''
       or coalesce(trim(v_spec ->> 'to_district_name'), '') = ''
       or coalesce(trim(v_spec ->> 'to_province_name'), '') = ''
       or coalesce(trim(v_spec ->> 'to_ward_code'), '') = ''
       or coalesce(trim(v_spec ->> 'to_ward_name'), '') = ''
       or coalesce(trim(v_spec ->> 'to_address_detail'), '') = '' then
      raise exception 'payos_marketplace_shipping_invalid';
    end if;

    select * into v_card from public.cards where id = v_card_id for update;
    if v_card.seller_id <> v_seller_id or v_card.listing_type <> 'sale' then
      raise exception 'payos_marketplace_card_binding_invalid';
    end if;

    if v_transaction_id is not null then
      select * into v_transaction
      from public.transactions where id = v_transaction_id for update;
      if not found or v_transaction.status <> 'active'
         or v_transaction.expires_at <= now()
         or v_transaction.buyer_id <> p_user_id
         or v_transaction.seller_id <> v_seller_id
         or v_transaction.card_id <> v_card_id
         or v_transaction.offer_id is distinct from v_offer_id
         or v_transaction.price <> v_amount
         or v_card.status not in ('active', 'in_transaction') then
        raise exception 'payos_marketplace_transaction_binding_invalid';
      end if;
    elsif v_offer_id is not null then
      select * into v_offer from public.offers where id = v_offer_id for update;
      if not found or v_offer.status <> 'chosen'
         or v_offer.buyer_id <> p_user_id or v_offer.card_id <> v_card_id
         or v_offer.price <> v_amount
         or v_card.status not in ('active', 'in_transaction') then
        raise exception 'payos_marketplace_offer_binding_invalid';
      end if;
    elsif v_card.status <> 'active' then
      raise exception 'payos_marketplace_card_unavailable';
    end if;

    if not coalesce(v_card.is_bundle, false) then
      if v_offer_id is null and v_transaction_id is null and v_card.price <> v_amount then
        raise exception 'payos_marketplace_price_changed';
      end if;
      if exists (
        select 1 from public.orders o where o.card_id = v_card_id
          and o.status in ('pending_payment', 'paid', 'shipping', 'delivered', 'completed')
      ) then
        raise exception 'payos_marketplace_card_already_ordered';
      end if;
    else
      if v_offer_id is not null or v_transaction_id is not null then
        raise exception 'payos_marketplace_bundle_offer_unsupported';
      end if;
      v_bundle_before := coalesce(v_spec -> 'bundle_items_before', '[]'::jsonb);
      v_bundle_selection := coalesce(v_spec #> '{metadata,bundle_selection}', '[]'::jsonb);
      if jsonb_typeof(v_bundle_before) <> 'array'
         or jsonb_typeof(v_bundle_selection) <> 'array'
         or v_card.bundle_items is distinct from v_bundle_before
         or jsonb_array_length(v_bundle_selection) = 0 then
        raise exception 'payos_marketplace_bundle_snapshot_invalid';
      end if;
      v_expected_remaining := public.subtract_bundle_selection(
        v_bundle_before, v_bundle_selection
      );
      if (select coalesce(sum((value ->> 'price')::bigint), 0)
          from jsonb_array_elements(v_bundle_selection)) <> v_amount then
        raise exception 'payos_marketplace_bundle_selection_invalid';
      end if;
    end if;

    if exists (select 1 from public.orders where id = v_order_id) then
      raise exception 'payos_marketplace_order_id_conflict';
    end if;
    v_checkout_total := v_checkout_total + v_total_paid;
  end loop;

  v_payment := public.create_server_payment_order(
    p_user_id, p_order_code, 'marketplace_order', v_checkout_total, 'VND',
    p_idempotency_key
  );
  update public.payment_orders
  set server_request_hash = v_request_hash, updated_at = now()
  where id = v_payment.id
  returning * into v_payment;

  for v_spec in select item from jsonb_array_elements(p_orders) item
  loop
    v_order_id := (v_spec ->> 'order_id')::uuid;
    v_card_id := (v_spec ->> 'card_id')::uuid;
    v_seller_id := (v_spec ->> 'seller_id')::uuid;
    v_offer_id := nullif(v_spec ->> 'offer_id', '')::uuid;
    v_shipping_fee := coalesce((v_spec ->> 'shipping_fee')::bigint, 0);
    insert into public.orders (
      id, card_id, seller_id, buyer_id, offer_id, amount, platform_fee,
      total_paid, shipping_fee, payment_method, payment_order_id, status,
      metadata, shipping_address, to_name, to_phone, to_district_id,
      to_district_name, to_province_id, to_province_name, to_ward_code,
      to_ward_name, to_address_detail
    ) values (
      v_order_id, v_card_id, v_seller_id, p_user_id, v_offer_id,
      (v_spec ->> 'amount')::bigint, 0, (v_spec ->> 'total_paid')::bigint,
      v_shipping_fee::integer, 'direct_payos', v_payment.id, 'pending_payment',
      coalesce(v_spec -> 'metadata', '{}'::jsonb)
        || case when nullif(v_spec ->> 'transaction_id', '') is null
             then '{}'::jsonb
             else jsonb_build_object('transaction_id', v_spec ->> 'transaction_id') end,
      nullif(v_spec ->> 'shipping_address', ''), v_spec ->> 'to_name',
      v_spec ->> 'to_phone', (v_spec ->> 'to_district_id')::integer,
      v_spec ->> 'to_district_name', (v_spec ->> 'to_province_id')::integer,
      v_spec ->> 'to_province_name', v_spec ->> 'to_ward_code',
      v_spec ->> 'to_ward_name', v_spec ->> 'to_address_detail'
    );
    update public.cards
    set status = 'in_transaction', reserved_until = p_reserved_until,
        updated_at = now()
    where id = v_card_id;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
  into v_result_orders from public.orders o where o.payment_order_id = v_payment.id;
  return jsonb_build_object(
    'ok', true, 'replayed', false, 'payment_order', to_jsonb(v_payment),
    'orders', v_result_orders
  );
end;
$$;

create or replace function public.apply_payos_webhook_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.payment_webhook_events%rowtype;
  v_order public.payment_orders%rowtype;
  v_wallet_id uuid;
  v_new_balance bigint;
  v_expected_amount bigint;
  v_order_total bigint;
  v_result jsonb;
  v_source_id uuid;
  v_market_order public.orders%rowtype;
  v_market_card public.cards%rowtype;
  v_selection jsonb;
  v_remaining jsonb;
  v_transaction_id uuid;
  v_inventory_ok boolean := true;
  v_inventory_error text;
begin
  select * into v_event
  from public.payment_webhook_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'webhook_event_not_found';
  end if;

  if v_event.status = 'processed' then
    return coalesce(v_event.result, jsonb_build_object('ok', true, 'replayed', true));
  end if;

  if not v_event.signature_verified then
    update public.payment_webhook_events
    set status = 'rejected', processed_at = now(),
        result = jsonb_build_object('ok', false, 'error', 'invalid_signature')
    where id = v_event.id;
    return jsonb_build_object('ok', false, 'error', 'invalid_signature');
  end if;

  select * into v_order
  from public.payment_orders
  where order_code = v_event.order_code
  for update;

  if not found then
    update public.payment_webhook_events
    set status = 'review_required', processed_at = now(),
        result = jsonb_build_object('ok', false, 'error', 'payment_order_not_found')
    where id = v_event.id;
    return jsonb_build_object('ok', false, 'error', 'payment_order_not_found');
  end if;

  if v_event.event_code <> '00' then
    if v_order.status = 'pending' then
      update public.payment_orders
      set status = 'cancelled', updated_at = now()
      where id = v_order.id;

      if v_order.package_type = 'marketplace_order' then
        update public.orders
        set status = 'cancelled', updated_at = now()
        where payment_order_id = v_order.id and status = 'pending_payment';

        update public.cards c
        set status = 'active', reserved_until = null, updated_at = now()
        where c.status = 'in_transaction'
          and exists (
            select 1 from public.orders o
            where o.payment_order_id = v_order.id and o.card_id = c.id
              and o.status = 'cancelled'
          )
          and not exists (
            select 1 from public.orders active_order
            where active_order.card_id = c.id
              and active_order.payment_order_id <> v_order.id
              and active_order.status in (
                'pending_payment', 'paid', 'shipping', 'delivered', 'completed'
              )
          );
      end if;
    elsif v_order.status = 'paid' then
      v_result := jsonb_build_object(
        'ok', true,
        'payment_order_id', v_order.id,
        'order_type', v_order.package_type,
        'payment_status', 'paid',
        'first_processing', false,
        'ignored_out_of_order_event', true
      );
      update public.payment_webhook_events
      set status = 'processed', processed_at = now(), result = v_result,
          post_processing_status = 'completed'
      where id = v_event.id;
      return v_result;
    else
      v_result := jsonb_build_object(
        'ok', false, 'error', 'invalid_payment_state',
        'payment_status', v_order.status
      );
      update public.payment_webhook_events
      set status = 'review_required', processed_at = now(), result = v_result
      where id = v_event.id;
      return v_result;
    end if;

    v_result := jsonb_build_object(
      'ok', true,
      'payment_order_id', v_order.id,
      'order_type', v_order.package_type,
      'payment_status', 'cancelled',
      'first_processing', true
    );
    update public.payment_webhook_events
    set status = 'processed', processed_at = now(), result = v_result
    where id = v_event.id;
    return v_result;
  end if;

  v_expected_amount := v_order.amount;
  if v_event.amount is distinct from v_expected_amount
     or v_event.currency <> v_order.currency then
    if v_order.status = 'pending' then
      update public.payment_orders
      set status = 'fraud_suspected', updated_at = now()
      where id = v_order.id;
    end if;
    v_result := jsonb_build_object('ok', false, 'error', 'amount_or_currency_mismatch');
    update public.payment_webhook_events
    set status = 'rejected', processed_at = now(), result = v_result
    where id = v_event.id;
    return v_result;
  end if;

  if v_order.status = 'paid' then
    v_result := jsonb_build_object(
      'ok', true,
      'payment_order_id', v_order.id,
      'order_type', v_order.package_type,
      'payment_status', 'paid',
      'first_processing', false
    );
    update public.payment_webhook_events
    set status = 'processed', processed_at = now(), result = v_result
    where id = v_event.id;
    return v_result;
  end if;

  if v_order.status <> 'pending' then
    v_result := jsonb_build_object('ok', false, 'error', 'invalid_payment_state');
    update public.payment_webhook_events
    set status = 'review_required', processed_at = now(), result = v_result
    where id = v_event.id;
    return v_result;
  end if;

  update public.payment_orders
  set status = 'paid', paid_at = now(), updated_at = now()
  where id = v_order.id;

  if v_order.package_type = 'deposit' then
    v_wallet_id := public.ensure_wallet_for_user(v_order.user_id);

    insert into public.wallet_fund_sources (
      user_id, wallet_id, source_type, source_id, original_amount,
      remaining_amount, verification_status, credits_wallet, evidence,
      occurred_at
    ) values (
      v_order.user_id, v_wallet_id, 'payos_deposit', v_order.id::text,
      v_order.amount, v_order.amount, 'verified', true,
      jsonb_build_object(
        'provider', 'payos',
        'order_code', v_order.order_code,
        'webhook_event_id', v_event.id
      ),
      coalesce(v_event.provider_occurred_at, now())
    )
    on conflict (user_id, source_type, source_id) do nothing
    returning id into v_source_id;

    if v_source_id is not null then
      update public.wallets
      set available_balance = available_balance + v_order.amount,
          total_deposited = total_deposited + v_order.amount,
          updated_at = now()
      where id = v_wallet_id
      returning available_balance into v_new_balance;

      insert into public.wallet_transactions (
        wallet_id, user_id, type, amount, balance_after, description,
        reference_id, reference_type, fund_source_id, idempotency_key
      ) values (
        v_wallet_id, v_order.user_id, 'deposit', v_order.amount, v_new_balance,
        'PayOS wallet deposit', v_order.order_code::text, 'payment_order',
        v_source_id, public.stable_financial_uuid('payos-deposit:' || v_order.id::text)
      );
    end if;
  elsif v_order.package_type = 'marketplace_order' then
    select coalesce(sum(total_paid), 0)::bigint
    into v_order_total
    from public.orders
    where payment_order_id = v_order.id;

    if v_order_total <> v_order.amount
       or exists (
         select 1
         from public.orders o
         where o.payment_order_id = v_order.id
           and (
             o.buyer_id <> v_order.user_id
             or o.payment_method <> 'direct_payos'
             or o.status <> 'pending_payment'
           )
       ) then
      update public.payment_webhook_events
      set status = 'review_required', processed_at = now(),
          result = jsonb_build_object('ok', false, 'error', 'marketplace_order_binding_mismatch')
      where id = v_event.id;
      update public.payment_orders
      set status = 'fraud_suspected', updated_at = now()
      where id = v_order.id;
      return jsonb_build_object('ok', false, 'error', 'marketplace_order_binding_mismatch');
    end if;

    insert into public.marketplace_order_funding (
      order_id, buyer_id, seller_id, funding_method, gross_amount,
      verified_amount, unverified_amount, classification, payment_order_id,
      provider_evidence_event_id, evidence
    )
    select
      o.id, o.buyer_id, o.seller_id, 'direct_payos', o.total_paid,
      o.total_paid, 0, 'native_verified_escrow', v_order.id, v_event.id,
      jsonb_build_object('provider', 'payos', 'order_code', v_order.order_code)
    from public.orders o
    where o.payment_order_id = v_order.id
    on conflict (order_id) do update
    set verified_amount = excluded.verified_amount,
        unverified_amount = 0,
        classification = case
          when public.marketplace_order_funding.classification = 'disputed_frozen'
            then 'disputed_frozen'
          else 'native_verified_escrow'
        end,
        provider_evidence_event_id = excluded.provider_evidence_event_id,
        evidence = excluded.evidence,
        updated_at = now();

    update public.orders
    set status = 'paid',
        ship_deadline = coalesce(ship_deadline, now() + interval '24 hours'),
        updated_at = now()
    where payment_order_id = v_order.id and status = 'pending_payment';

    -- Inventory and accepted-offer transaction finalization are part of the
    -- same transaction as provider evidence and escrow funding.  If current
    -- inventory cannot match the frozen order snapshot, roll back only this
    -- finalization block and freeze the verified escrow for recovery; never
    -- erase or make the externally paid payment unrecordable.
    begin
      for v_market_order in
        select * from public.orders
        where payment_order_id = v_order.id
        order by card_id, id
        for update
      loop
        select * into v_market_card
        from public.cards where id = v_market_order.card_id for update;
        if not found or v_market_card.status <> 'in_transaction' then
          raise exception 'payos_inventory_state_invalid';
        end if;

        v_selection := coalesce(
          v_market_order.metadata -> 'bundle_selection', '[]'::jsonb
        );
        if jsonb_typeof(v_selection) <> 'array' then
          raise exception 'payos_bundle_selection_invalid';
        end if;

        if jsonb_array_length(v_selection) > 0 then
          v_remaining := public.subtract_bundle_selection(
            coalesce(v_market_card.bundle_items, '[]'::jsonb), v_selection
          );
          if jsonb_array_length(v_remaining) > 0 then
            update public.cards
            set bundle_items = v_remaining, status = 'active',
                reserved_until = null, updated_at = now()
            where id = v_market_card.id;
          else
            update public.cards
            set bundle_items = '[]'::jsonb, status = 'sold',
                reserved_until = null, updated_at = now()
            where id = v_market_card.id;
          end if;
        else
          update public.cards
          set status = 'sold', reserved_until = null, updated_at = now()
          where id = v_market_card.id;
        end if;

        v_transaction_id := nullif(
          v_market_order.metadata ->> 'transaction_id', ''
        )::uuid;
        if v_transaction_id is not null then
          update public.transactions
          set status = 'completed', completed_at = now()
          where id = v_transaction_id and status = 'active'
            and buyer_id = v_market_order.buyer_id
            and seller_id = v_market_order.seller_id
            and card_id = v_market_order.card_id;
          if not found and not exists (
            select 1 from public.transactions
            where id = v_transaction_id and status = 'completed'
              and buyer_id = v_market_order.buyer_id
              and seller_id = v_market_order.seller_id
              and card_id = v_market_order.card_id
          ) then
            raise exception 'payos_transaction_finalize_invalid';
          end if;
        end if;
      end loop;
    exception when others then
      v_inventory_ok := false;
      get stacked diagnostics v_inventory_error = message_text;
    end;

    if not v_inventory_ok then
      update public.marketplace_order_funding
      set classification = 'disputed_frozen',
          evidence = evidence || jsonb_build_object(
            'inventory_recovery_required', true,
            'inventory_error', v_inventory_error
          ),
          updated_at = now()
      where payment_order_id = v_order.id;
      update public.orders
      set status = 'disputed',
          dispute_reason = 'PAYOS_INVENTORY_RECOVERY_REQUIRED',
          updated_at = now()
      where payment_order_id = v_order.id;

      v_result := jsonb_build_object(
        'ok', true,
        'payment_order_id', v_order.id,
        'order_type', v_order.package_type,
        'payment_status', 'paid',
        'first_processing', true,
        'user_id', v_order.user_id,
        'amount', v_order.amount,
        'inventory_recovery_required', true,
        'error', v_inventory_error
      );
      update public.payment_webhook_events
      set status = 'review_required', processed_at = now(), result = v_result,
          post_processing_status = 'failed',
          post_processing_error = v_inventory_error
      where id = v_event.id;
      return v_result;
    end if;
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'payment_order_id', v_order.id,
    'order_type', v_order.package_type,
    'payment_status', 'paid',
    'first_processing', true,
    'user_id', v_order.user_id,
    'amount', v_order.amount
  );

  update public.payment_webhook_events
  set status = 'processed', processed_at = now(), result = v_result
  where id = v_event.id;

  return v_result;
end;
$$;

create or replace function public.record_payos_webhook(
  p_provider_event_key text,
  p_order_code bigint,
  p_event_code text,
  p_amount bigint,
  p_currency text,
  p_signature_verified boolean,
  p_payload_sanitized jsonb,
  p_provider_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.payment_webhook_events%rowtype;
  v_maintenance boolean;
  v_result jsonb;
begin
  if coalesce(trim(p_provider_event_key), '') = '' then
    raise exception 'provider_event_key_required';
  end if;

  insert into public.payment_webhook_events (
    provider, provider_event_key, order_code, event_code, amount, currency,
    signature_verified, payload_sanitized, status, provider_occurred_at
  ) values (
    'payos', p_provider_event_key, p_order_code, p_event_code, p_amount,
    coalesce(nullif(trim(p_currency), ''), 'VND'), p_signature_verified,
    coalesce(p_payload_sanitized, '{}'::jsonb), 'received', p_provider_occurred_at
  )
  on conflict (provider, provider_event_key) do nothing;

  select * into v_event
  from public.payment_webhook_events
  where provider = 'payos' and provider_event_key = p_provider_event_key
  for update;

  if v_event.order_code is distinct from p_order_code
     or v_event.event_code is distinct from p_event_code
     or v_event.amount is distinct from p_amount
     or v_event.currency is distinct from coalesce(nullif(trim(p_currency), ''), 'VND') then
    raise exception 'webhook_idempotency_conflict';
  end if;

  if v_event.status in ('processed', 'rejected', 'review_required') then
    return coalesce(v_event.result, jsonb_build_object('ok', false, 'status', v_event.status));
  end if;

  select maintenance_active into v_maintenance
  from public.financial_system_state
  where singleton;

  if coalesce(v_maintenance, true) then
    update public.payment_webhook_events
    set status = 'deferred'
    where id = v_event.id;
    return jsonb_build_object('ok', true, 'status', 'deferred', 'event_id', v_event.id);
  end if;

  v_result := public.apply_payos_webhook_event(v_event.id);
  return v_result || jsonb_build_object('event_id', v_event.id);
end;
$$;

-- Operator-only ingestion for independently verified historical PayOS exports.
-- It records evidence for cutover classification without replaying the live
-- webhook mutation path, so money that is already in the stored wallet cannot
-- be credited a second time.
create or replace function public.record_legacy_payos_evidence(
  p_provider_event_key text,
  p_order_code bigint,
  p_amount bigint,
  p_currency text,
  p_payload_sanitized jsonb,
  p_provider_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.payment_orders%rowtype;
  v_event public.payment_webhook_events%rowtype;
  v_previous_bypass text;
begin
  if coalesce(trim(p_provider_event_key), '') = ''
     or p_order_code is null or p_amount is null or p_amount <= 0
     or coalesce(trim(p_currency), '') <> 'VND'
     or p_provider_occurred_at is null then
    raise exception 'invalid_legacy_payos_evidence';
  end if;
  v_previous_bypass := current_setting('cardverse.maintenance_bypass', true);
  perform set_config('cardverse.maintenance_bypass', 'on', true);

  select * into v_order
  from public.payment_orders where order_code = p_order_code for update;
  if not found or v_order.amount <> p_amount or v_order.currency <> p_currency then
    raise exception 'legacy_payos_evidence_order_mismatch';
  end if;

  insert into public.payment_webhook_events (
    provider, provider_event_key, order_code, event_code, amount, currency,
    signature_verified, payload_sanitized, status, result,
    provider_occurred_at, processed_at, post_processing_status
  ) values (
    'payos', trim(p_provider_event_key), p_order_code, '00', p_amount, p_currency,
    true, coalesce(p_payload_sanitized, '{}'::jsonb), 'processed',
    jsonb_build_object(
      'ok', true, 'legacy_evidence_only', true,
      'payment_order_id', v_order.id, 'order_type', v_order.package_type,
      'payment_status', 'paid'
    ),
    p_provider_occurred_at, now(), 'completed'
  )
  on conflict (provider, provider_event_key) do nothing;

  select * into v_event
  from public.payment_webhook_events
  where provider = 'payos' and provider_event_key = trim(p_provider_event_key)
  for update;
  if v_event.order_code is distinct from p_order_code
     or v_event.amount is distinct from p_amount
     or v_event.currency is distinct from p_currency
     or not v_event.signature_verified then
    raise exception 'legacy_payos_evidence_idempotency_conflict';
  end if;
  perform set_config('cardverse.maintenance_bypass', coalesce(v_previous_bypass, ''), true);
  return jsonb_build_object('ok', true, 'event_id', v_event.id,
    'payment_order_id', v_order.id);
end;
$$;

create or replace function public.claim_payos_webhook_post_processing(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.payment_webhook_events%rowtype;
  v_claim_id uuid;
begin
  select * into v_event
  from public.payment_webhook_events
  where id = p_event_id
  for update;

  if not found or v_event.status <> 'processed' then
    return jsonb_build_object('ok', false, 'error', 'event_not_processed');
  end if;
  if v_event.post_processing_status = 'completed' then
    return jsonb_build_object('ok', true, 'claimed', false, 'completed', true);
  end if;
  if v_event.post_processing_status = 'processing'
     and v_event.post_processing_claimed_at > now() - interval '5 minutes' then
    return jsonb_build_object('ok', true, 'claimed', false, 'completed', false);
  end if;

  v_claim_id := gen_random_uuid();
  update public.payment_webhook_events
  set post_processing_status = 'processing',
      post_processing_claim_id = v_claim_id,
      post_processing_claimed_at = now(),
      post_processing_error = null
  where id = p_event_id;

  return jsonb_build_object(
    'ok', true, 'claimed', true, 'claim_id', v_claim_id,
    'event_id', p_event_id, 'result', v_event.result
  );
end;
$$;

create or replace function public.finish_payos_webhook_post_processing(
  p_event_id uuid,
  p_claim_id uuid,
  p_success boolean,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.payment_webhook_events
  set post_processing_status = case when p_success then 'completed' else 'failed' end,
      post_processing_error = case when p_success then null else left(coalesce(p_error, 'unknown'), 1000) end,
      post_processing_claim_id = null,
      post_processing_claimed_at = null
  where id = p_event_id
    and post_processing_status = 'processing'
    and post_processing_claim_id = p_claim_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'post_processing_claim_mismatch');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fulfill_subscription_payment(p_payment_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.payment_orders%rowtype;
  v_fulfillment_id uuid;
  v_subscription public.user_subscriptions%rowtype;
  v_wallet_id uuid;
  v_balance bigint;
begin
  -- Fulfillment is a financial/value mutation and must remain closed while the
  -- database maintenance gate is active. Deferred webhooks are drained only
  -- after reconciliation and after the gate has been disabled.
  perform public.assert_financial_mutations_enabled();

  select * into v_order
  from public.payment_orders
  where id = p_payment_order_id
  for update;

  if not found or v_order.status <> 'paid'
     or v_order.package_type not in ('day_pass', 'credit_pack', 'vip_pro') then
    raise exception 'subscription_payment_not_fulfillable';
  end if;

  insert into public.payment_fulfillments (payment_order_id, fulfillment_type)
  values (v_order.id, 'subscription')
  on conflict (payment_order_id, fulfillment_type) do nothing
  returning id into v_fulfillment_id;

  if v_fulfillment_id is null then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;

  if v_order.package_type = 'day_pass' then
    insert into public.user_subscriptions (
      user_id, package_type, status, starts_at, expires_at, payment_reference
    ) values (
      v_order.user_id, 'day_pass', 'active', now(),
      now() + interval '24 hours', v_order.order_code::text
    );
  elsif v_order.package_type = 'credit_pack' then
    select * into v_subscription
    from public.user_subscriptions
    where user_id = v_order.user_id
      and package_type = 'credit_pack'
      and status = 'active'
      and coalesce(scan_credits_remaining, 0) > 0
    order by created_at desc
    for update
    limit 1;

    if found then
      update public.user_subscriptions
      set scan_credits_remaining = coalesce(scan_credits_remaining, 0) + 100,
          updated_at = now()
      where id = v_subscription.id;
    else
      insert into public.user_subscriptions (
        user_id, package_type, status, scan_credits_remaining, payment_reference
      ) values (
        v_order.user_id, 'credit_pack', 'active', 100, v_order.order_code::text
      );
    end if;
  else
    select * into v_subscription
    from public.user_subscriptions
    where user_id = v_order.user_id
      and package_type = 'vip_pro'
      and status = 'active'
      and expires_at >= now()
    order by expires_at desc
    for update
    limit 1;

    if found then
      update public.user_subscriptions
      set expires_at = expires_at + interval '30 days', updated_at = now()
      where id = v_subscription.id;
    else
      insert into public.user_subscriptions (
        user_id, package_type, status, starts_at, expires_at, payment_reference
      ) values (
        v_order.user_id, 'vip_pro', 'active', now(),
        now() + interval '30 days', v_order.order_code::text
      );
    end if;
  end if;

  v_wallet_id := public.ensure_wallet_for_user(v_order.user_id);
  select available_balance into v_balance from public.wallets where id = v_wallet_id;
  insert into public.wallet_transactions (
    wallet_id, user_id, type, amount, balance_after, description,
    reference_id, reference_type, idempotency_key, affects_balance
  ) values (
    v_wallet_id, v_order.user_id,
    case when v_order.package_type = 'vip_pro' then 'vip_subscription' else 'scan_purchase' end,
    -v_order.amount, v_balance,
    'Purchased ' || replace(v_order.package_type, '_', ' '),
    v_order.order_code::text, 'payment_order',
    public.stable_financial_uuid('subscription:' || v_order.id::text), false
  );

  update public.payment_fulfillments
  set result = jsonb_build_object('ok', true, 'package_type', v_order.package_type)
  where id = v_fulfillment_id;

  return jsonb_build_object('ok', true, 'replayed', false,
    'package_type', v_order.package_type);
end;
$$;

create or replace function public.grant_admin_subscription_package(
  p_user_id uuid,
  p_package_type text,
  p_actor_id text,
  p_actor_role text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.admin_subscription_grant_requests%rowtype;
  v_subscription public.user_subscriptions%rowtype;
  v_result jsonb;
begin
  perform public.assert_financial_mutations_enabled();
  if p_user_id is null or p_idempotency_key is null
     or p_package_type not in ('day_pass', 'credit_pack', 'vip_pro')
     or p_actor_role not in ('admin', 'moderator')
     or coalesce(trim(p_actor_id), '') = '' then
    raise exception 'invalid_subscription_grant_request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into v_existing
  from public.admin_subscription_grant_requests
  where idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.user_id <> p_user_id
       or v_existing.package_type <> p_package_type
       or v_existing.actor_id <> p_actor_id
       or v_existing.actor_role <> p_actor_role then
      raise exception 'idempotency_conflict';
    end if;
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;

  -- Lock the target account so concurrent package grants serialize even when
  -- they use different request keys.
  perform 1 from auth.users where id = p_user_id for update;
  if not found then raise exception 'user_not_found'; end if;

  if p_package_type = 'credit_pack' then
    select * into v_subscription
    from public.user_subscriptions
    where user_id = p_user_id and package_type = 'credit_pack' and status = 'active'
    order by created_at desc
    for update limit 1;
    if found then
      update public.user_subscriptions
      set scan_credits_remaining = coalesce(scan_credits_remaining, 0) + 100,
          updated_at = now()
      where id = v_subscription.id
      returning * into v_subscription;
    else
      insert into public.user_subscriptions (
        user_id, package_type, status, starts_at, scan_credits_remaining
      ) values (p_user_id, 'credit_pack', 'active', now(), 100)
      returning * into v_subscription;
    end if;
  elsif p_package_type = 'vip_pro' then
    select * into v_subscription
    from public.user_subscriptions
    where user_id = p_user_id and package_type = 'vip_pro' and status = 'active'
      and expires_at >= now()
    order by expires_at desc
    for update limit 1;
    if found then
      update public.user_subscriptions
      set expires_at = expires_at + interval '30 days', updated_at = now()
      where id = v_subscription.id
      returning * into v_subscription;
    else
      insert into public.user_subscriptions (
        user_id, package_type, status, starts_at, expires_at
      ) values (p_user_id, 'vip_pro', 'active', now(), now() + interval '30 days')
      returning * into v_subscription;
    end if;
  else
    insert into public.user_subscriptions (
      user_id, package_type, status, starts_at, expires_at
    ) values (p_user_id, 'day_pass', 'active', now(), now() + interval '24 hours')
    returning * into v_subscription;
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'subscription', jsonb_build_object(
      'id', v_subscription.id,
      'user_id', v_subscription.user_id,
      'package_type', v_subscription.package_type,
      'status', v_subscription.status,
      'starts_at', v_subscription.starts_at,
      'expires_at', v_subscription.expires_at,
      'scan_credits_remaining', v_subscription.scan_credits_remaining
    )
  );
  insert into public.admin_subscription_grant_requests (
    idempotency_key, actor_id, actor_role, user_id, package_type, result
  ) values (
    p_idempotency_key, trim(p_actor_id), p_actor_role, p_user_id, p_package_type, v_result
  );
  return v_result;
end;
$$;

create or replace function public.perform_offer_action(
  p_offer_id uuid,
  p_action text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.offer_action_requests%rowtype;
  v_offer public.offers%rowtype;
  v_card public.cards%rowtype;
  v_losers jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  perform public.assert_financial_mutations_enabled();
  if v_actor is null then raise exception 'unauthorized'; end if;
  if p_offer_id is null or p_idempotency_key is null
     or p_action not in ('accept', 'reject') then
    raise exception 'invalid_offer_action';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_idempotency_key::text, 0));
  select * into v_existing
  from public.offer_action_requests
  where actor_id = v_actor and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.offer_id <> p_offer_id or v_existing.action <> p_action then
      raise exception 'idempotency_conflict';
    end if;
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;

  select * into v_offer from public.offers where id = p_offer_id for update;
  if not found then raise exception 'offer_not_found'; end if;
  select * into v_card from public.cards where id = v_offer.card_id for update;
  if not found then raise exception 'card_not_found'; end if;
  if v_card.seller_id <> v_actor then raise exception 'offer_forbidden'; end if;
  if v_offer.status <> 'pending' then raise exception 'offer_not_pending'; end if;

  if p_action = 'accept' then
    if v_card.status <> 'active' then raise exception 'card_unavailable'; end if;
    update public.cards
    set status = 'in_transaction', reserved_until = now() + interval '2 hours', updated_at = now()
    where id = v_card.id;
    update public.offers set status = 'chosen' where id = v_offer.id;

    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'buyer_id', buyer_id)), '[]'::jsonb)
    into v_losers
    from public.offers
    where card_id = v_card.id and id <> v_offer.id and status = 'pending';
    update public.offers
    set status = 'rejected'
    where card_id = v_card.id and id <> v_offer.id and status = 'pending';

    insert into public.notifications (user_id, type, title, message, card_id, offer_id, read)
    values (
      v_offer.buyer_id, 'offer_accepted', 'Offer accepted!',
      'The seller accepted your offer. Continue to checkout to complete payment.',
      v_card.id, v_offer.id, false
    );
    insert into public.notifications (user_id, type, title, message, card_id, offer_id, read)
    select
      (item ->> 'buyer_id')::uuid, 'offer_rejected', 'Offer not selected',
      'The seller accepted another offer for this card.',
      v_card.id, (item ->> 'id')::uuid, false
    from jsonb_array_elements(v_losers) item;
  else
    update public.offers set status = 'rejected' where id = v_offer.id;
    insert into public.notifications (user_id, type, title, message, card_id, offer_id, read)
    values (
      v_offer.buyer_id, 'offer_rejected', 'Offer rejected',
      'The seller rejected your offer.', v_card.id, v_offer.id, false
    );
  end if;

  v_result := jsonb_build_object(
    'ok', true, 'replayed', false, 'action', p_action,
    'offer_id', v_offer.id, 'card_id', v_card.id, 'card_name', v_card.name,
    'buyer_id', v_offer.buyer_id, 'seller_id', v_card.seller_id,
    'price', v_offer.price, 'losers', v_losers
  );
  insert into public.offer_action_requests (
    offer_id, actor_id, action, idempotency_key, result
  ) values (v_offer.id, v_actor, p_action, p_idempotency_key, v_result);
  return v_result;
end;
$$;

create or replace function public.consume_scan_credit(
  p_user_id uuid,
  p_subscription_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.scan_credit_consumptions%rowtype;
  v_subscription public.user_subscriptions%rowtype;
  v_remaining integer;
begin
  perform public.assert_financial_mutations_enabled();
  if p_user_id is null or p_subscription_id is null or p_idempotency_key is null then
    raise exception 'invalid_scan_credit_request';
  end if;

  select * into v_existing
  from public.scan_credit_consumptions
  where user_id = p_user_id and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.subscription_id <> p_subscription_id then
      raise exception 'idempotency_conflict';
    end if;
    return jsonb_build_object(
      'ok', true, 'replayed', true,
      'credits_remaining', v_existing.remaining_after
    );
  end if;

  select * into v_subscription
  from public.user_subscriptions
  where id = p_subscription_id and user_id = p_user_id
  for update;
  if not found or v_subscription.status <> 'active'
     or v_subscription.package_type <> 'credit_pack'
     or coalesce(v_subscription.scan_credits_remaining, 0) <= 0 then
    raise exception 'scan_credit_not_available';
  end if;

  update public.user_subscriptions
  set scan_credits_remaining = scan_credits_remaining - 1,
      updated_at = now()
  where id = v_subscription.id
  returning scan_credits_remaining into v_remaining;

  insert into public.scan_credit_consumptions (
    user_id, subscription_id, idempotency_key, remaining_after
  ) values (p_user_id, p_subscription_id, p_idempotency_key, v_remaining);

  return jsonb_build_object(
    'ok', true, 'replayed', false, 'credits_remaining', v_remaining
  );
end;
$$;

create or replace function public.drain_deferred_payos_webhooks(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event record;
  v_results jsonb := '[]'::jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'invalid_limit';
  end if;

  -- Inbox writes continue during cutover, but application/fulfillment must not
  -- race the reconciliation snapshot. Operators disable maintenance only after
  -- reconciliation, then drain this queue.
  perform public.assert_financial_mutations_enabled();

  for v_event in
    select id
    from public.payment_webhook_events
    where status = 'deferred'
    order by provider_occurred_at nulls last, received_at, id
    for update skip locked
    limit p_limit
  loop
    v_results := v_results || jsonb_build_array(
      public.apply_payos_webhook_event(v_event.id) || jsonb_build_object('event_id', v_event.id)
    );
  end loop;

  return jsonb_build_object('ok', true, 'results', v_results);
end;
$$;
