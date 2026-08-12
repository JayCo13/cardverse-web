-- Withdrawal verification and verified-fund provenance.
-- Phase 3/5: verified wallet spending and marketplace money paths.

create or replace function public.spend_verified_wallet(
  p_user_id uuid,
  p_purposes jsonb,
  p_idempotency_key uuid,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet public.wallets%rowtype;
  v_existing public.wallet_transactions%rowtype;
  v_purpose jsonb;
  v_purpose_id text;
  v_purpose_amount bigint;
  v_total bigint := 0;
  v_remaining bigint;
  v_source public.wallet_fund_sources%rowtype;
  v_take bigint;
  v_allocation_key uuid;
  v_new_balance bigint;
  v_verified_available bigint;
begin
  perform public.assert_financial_mutations_enabled();

  if p_user_id is null or p_idempotency_key is null
     or jsonb_typeof(p_purposes) <> 'array'
     or jsonb_array_length(p_purposes) = 0 then
    raise exception 'invalid_wallet_spend';
  end if;

  select * into v_existing
  from public.wallet_transactions
  where user_id = p_user_id and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.type <> 'marketplace_buy'
       or v_existing.metadata -> 'purposes' <> p_purposes then
      raise exception 'idempotency_conflict';
    end if;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'balance_after', v_existing.balance_after,
      'amount', -v_existing.amount
    );
  end if;

  for v_purpose in select value from jsonb_array_elements(p_purposes)
  loop
    v_purpose_id := v_purpose ->> 'purpose_id';
    v_purpose_amount := (v_purpose ->> 'amount')::bigint;
    if coalesce(v_purpose_id, '') = '' or v_purpose_amount is null or v_purpose_amount <= 0 then
      raise exception 'invalid_wallet_spend_purpose';
    end if;
    if v_purpose_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'wallet_spend_purpose_id_invalid';
    end if;
    if exists (
      select 1 from public.marketplace_order_funding f
      where f.order_id::text = v_purpose_id and f.classification <> 'cancelled'
    ) then
      raise exception 'wallet_spend_order_already_funded';
    end if;
    v_total := v_total + v_purpose_amount;
  end loop;

  select * into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'wallet_not_found';
  end if;

  select coalesce(sum(remaining_amount), 0)::bigint
  into v_verified_available
  from public.wallet_fund_sources
  where user_id = p_user_id and verification_status = 'verified';

  if v_wallet.available_balance < v_total or v_verified_available < v_total then
    raise exception 'insufficient_verified_balance'
      using detail = jsonb_build_object(
        'stored_available', v_wallet.available_balance,
        'verified_available', v_verified_available,
        'required', v_total
      )::text;
  end if;

  for v_purpose in select value from jsonb_array_elements(p_purposes)
  loop
    v_purpose_id := v_purpose ->> 'purpose_id';
    v_purpose_amount := (v_purpose ->> 'amount')::bigint;
    v_remaining := v_purpose_amount;

    while v_remaining > 0 loop
      select * into v_source
      from public.wallet_fund_sources
      where user_id = p_user_id
        and verification_status = 'verified'
        and remaining_amount > 0
      order by occurred_at, id
      for update
      limit 1;

      if not found then
        raise exception 'verified_source_exhausted';
      end if;

      v_take := least(v_remaining, v_source.remaining_amount);
      v_allocation_key := public.stable_financial_uuid(
        p_idempotency_key::text || ':' || v_purpose_id || ':' || v_source.id::text
      );

      update public.wallet_fund_sources
      set remaining_amount = remaining_amount - v_take, updated_at = now()
      where id = v_source.id;

      insert into public.wallet_fund_allocations (
        fund_source_id, user_id, purpose_type, purpose_id, amount, status,
        idempotency_key, group_idempotency_key, consumed_at
      ) values (
        v_source.id, p_user_id, 'wallet_purchase', v_purpose_id, v_take,
        'consumed', v_allocation_key, p_idempotency_key, now()
      );

      v_remaining := v_remaining - v_take;
    end loop;

    insert into public.marketplace_order_funding (
      order_id, buyer_id, seller_id, funding_method, gross_amount,
      verified_amount, unverified_amount, classification, evidence
    )
    select
      o.id, o.buyer_id, o.seller_id, 'wallet', v_purpose_amount,
      v_purpose_amount, 0, 'native_verified_escrow',
      jsonb_build_object('wallet_spend_idempotency_key', p_idempotency_key)
    from public.orders o
    where o.id::text = v_purpose_id
    on conflict (order_id) do nothing;
  end loop;

  update public.wallets
  set available_balance = available_balance - v_total,
      updated_at = now()
  where id = v_wallet.id
  returning available_balance into v_new_balance;

  insert into public.wallet_transactions (
    wallet_id, user_id, type, amount, balance_after, description,
    reference_id, reference_type, idempotency_key, metadata
  ) values (
    v_wallet.id, p_user_id, 'marketplace_buy', -v_total, v_new_balance,
    coalesce(nullif(trim(p_description), ''), 'Wallet order payment'),
    p_idempotency_key::text, 'wallet_purchase_group', p_idempotency_key,
    jsonb_build_object('purposes', p_purposes)
  );

  perform public.assert_wallet_fund_integrity(p_user_id);

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'balance_after', v_new_balance,
    'amount', v_total
  );
end;
$$;

create or replace function public.bind_verified_wallet_spend(
  p_user_id uuid,
  p_spend_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_spend public.wallet_transactions%rowtype;
  v_purpose jsonb;
  v_order public.orders%rowtype;
  v_amount bigint;
begin
  perform public.assert_financial_mutations_enabled();

  select * into v_spend
  from public.wallet_transactions
  where user_id = p_user_id
    and idempotency_key = p_spend_idempotency_key
    and type = 'marketplace_buy'
  for update;
  if not found then
    raise exception 'wallet_spend_not_found';
  end if;

  for v_purpose in select value from jsonb_array_elements(v_spend.metadata -> 'purposes')
  loop
    v_amount := (v_purpose ->> 'amount')::bigint;
    select * into v_order
    from public.orders
    where id::text = (v_purpose ->> 'purpose_id')
    for update;

    if not found
       or v_order.buyer_id <> p_user_id
       or v_order.payment_method <> 'wallet'
       or v_order.total_paid <> v_amount then
      raise exception 'wallet_spend_order_binding_invalid';
    end if;

    if (select coalesce(sum(amount), 0)::bigint
        from public.wallet_fund_allocations
        where purpose_type = 'wallet_purchase'
          and purpose_id = v_order.id::text
          and group_idempotency_key = p_spend_idempotency_key
          and status = 'consumed') <> v_amount then
      raise exception 'wallet_spend_allocation_binding_invalid';
    end if;

    insert into public.marketplace_order_funding (
      order_id, buyer_id, seller_id, funding_method, gross_amount,
      verified_amount, unverified_amount, classification, evidence
    ) values (
      v_order.id, v_order.buyer_id, v_order.seller_id, 'wallet', v_amount,
      v_amount, 0, 'native_verified_escrow',
      jsonb_build_object('wallet_spend_idempotency_key', p_spend_idempotency_key)
    )
    on conflict (order_id) do update
    set updated_at = now()
    where public.marketplace_order_funding.verified_amount = excluded.verified_amount
      and public.marketplace_order_funding.funding_method = 'wallet';
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.reverse_verified_wallet_spend(
  p_user_id uuid,
  p_spend_idempotency_key uuid,
  p_refund_idempotency_key uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet public.wallets%rowtype;
  v_spend public.wallet_transactions%rowtype;
  v_existing public.wallet_transactions%rowtype;
  v_allocation record;
  v_amount bigint;
  v_reversible bigint;
  v_new_balance bigint;
begin
  perform public.assert_financial_mutations_enabled();

  if p_user_id is null or p_spend_idempotency_key is null or p_refund_idempotency_key is null then
    raise exception 'invalid_wallet_spend_reversal';
  end if;

  select * into v_existing
  from public.wallet_transactions
  where user_id = p_user_id and idempotency_key = p_refund_idempotency_key
  for update;
  if found then
    return jsonb_build_object('ok', true, 'replayed', true, 'balance_after', v_existing.balance_after);
  end if;

  select * into v_spend
  from public.wallet_transactions
  where user_id = p_user_id and idempotency_key = p_spend_idempotency_key
    and type = 'marketplace_buy'
  for update;

  if not found then
    raise exception 'wallet_spend_not_found';
  end if;

  select * into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;

  v_amount := -v_spend.amount;

  select coalesce(sum(amount), 0)::bigint into v_reversible
  from public.wallet_fund_allocations
  where user_id = p_user_id
    and group_idempotency_key = p_spend_idempotency_key
    and status = 'consumed';

  if v_reversible = 0 and exists (
    select 1 from public.wallet_fund_allocations
    where user_id = p_user_id
      and group_idempotency_key = p_spend_idempotency_key
      and status = 'released'
  ) then
    return jsonb_build_object('ok', true, 'replayed', true,
      'balance_after', v_wallet.available_balance);
  end if;
  if v_reversible <> v_amount then
    raise exception 'wallet_spend_reversal_allocation_mismatch';
  end if;

  for v_allocation in
    select *
    from public.wallet_fund_allocations
    where user_id = p_user_id
      and group_idempotency_key = p_spend_idempotency_key
      and status = 'consumed'
    order by created_at, id
    for update
  loop
    update public.wallet_fund_sources
    set remaining_amount = remaining_amount + v_allocation.amount,
        updated_at = now()
    where id = v_allocation.fund_source_id;

    update public.wallet_fund_allocations
    set status = 'released', released_at = now()
    where id = v_allocation.id;

    update public.marketplace_order_funding
    set verified_amount = 0,
        unverified_amount = gross_amount,
        classification = 'cancelled',
        updated_at = now()
    where order_id::text = v_allocation.purpose_id;
  end loop;

  update public.wallets
  set available_balance = available_balance + v_amount,
      updated_at = now()
  where id = v_wallet.id
  returning available_balance into v_new_balance;

  insert into public.wallet_transactions (
    wallet_id, user_id, type, amount, balance_after, description,
    reference_id, reference_type, idempotency_key, metadata
  ) values (
    v_wallet.id, p_user_id, 'refund', v_amount, v_new_balance,
    coalesce(nullif(trim(p_reason), ''), 'Wallet payment reversal'),
    p_spend_idempotency_key::text, 'wallet_purchase_reversal',
    p_refund_idempotency_key,
    jsonb_build_object('reverses_idempotency_key', p_spend_idempotency_key)
  );

  perform public.assert_wallet_fund_integrity(p_user_id);
  return jsonb_build_object('ok', true, 'replayed', false, 'balance_after', v_new_balance);
end;
$$;

-- Create wallet-funded marketplace orders and consume their verified funding
-- in one database transaction.  The route may perform read-only quoting, but
-- price/ownership/inventory are revalidated under row locks here so a process
-- crash can never leave an orphan debit or a paid order without provenance.
create or replace function public.create_verified_wallet_marketplace_orders(
  p_user_id uuid,
  p_orders jsonb,
  p_idempotency_key uuid,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet public.wallets%rowtype;
  v_existing_spend public.wallet_transactions%rowtype;
  v_spec jsonb;
  v_card public.cards%rowtype;
  v_offer public.offers%rowtype;
  v_transaction public.transactions%rowtype;
  v_order public.orders%rowtype;
  v_order_id uuid;
  v_card_id uuid;
  v_seller_id uuid;
  v_offer_id uuid;
  v_transaction_id uuid;
  v_amount bigint;
  v_shipping_fee bigint;
  v_total_paid bigint;
  v_purposes jsonb := '[]'::jsonb;
  v_result_orders jsonb := '[]'::jsonb;
  v_existing_count integer;
  v_bundle_before jsonb;
  v_bundle_remaining jsonb;
  v_bundle_selection jsonb;
  v_bundle_selected_total bigint;
  v_ship_deadline timestamptz;
begin
  perform public.assert_financial_mutations_enabled();

  if p_user_id is null or p_idempotency_key is null
     or jsonb_typeof(p_orders) <> 'array'
     or jsonb_array_length(p_orders) < 1
     or jsonb_array_length(p_orders) > 100 then
    raise exception 'invalid_wallet_marketplace_orders';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_orders) item
    where coalesce(item ->> 'order_id', '') = ''
       or coalesce(item ->> 'card_id', '') = ''
       or coalesce(item ->> 'seller_id', '') = ''
  ) or (
    select count(*) <> count(distinct item ->> 'order_id')
    from jsonb_array_elements(p_orders) item
  ) or (
    select count(*) <> count(distinct item ->> 'card_id')
    from jsonb_array_elements(p_orders) item
  ) then
    raise exception 'duplicate_or_invalid_wallet_marketplace_order';
  end if;

  -- The wallet lock is the per-user serialization point for both first calls
  -- and concurrent retries using the same idempotency key.
  select * into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;

  select * into v_existing_spend
  from public.wallet_transactions
  where user_id = p_user_id and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing_spend.type <> 'marketplace_buy'
       or v_existing_spend.metadata -> 'order_specs' is distinct from p_orders then
      raise exception 'idempotency_conflict';
    end if;

    select count(*), coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
    into v_existing_count, v_result_orders
    from public.orders o
    join jsonb_array_elements(p_orders) item
      on o.id::text = item ->> 'order_id'
    where o.buyer_id = p_user_id and o.payment_method = 'wallet';

    if v_existing_count <> jsonb_array_length(p_orders) then
      raise exception 'wallet_marketplace_replay_inconsistent';
    end if;

    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'orders', v_result_orders,
      'balance_after', v_existing_spend.balance_after
    );
  end if;

  -- Lock cards in one deterministic order before validating any order.  This
  -- prevents two multi-card checkouts from deadlocking or selling one card
  -- twice with different purpose IDs.
  for v_spec in
    select item
    from jsonb_array_elements(p_orders) item
    order by item ->> 'card_id'
  loop
    begin
      v_card_id := (v_spec ->> 'card_id')::uuid;
    exception when others then
      raise exception 'wallet_marketplace_card_id_invalid';
    end;

    select * into v_card from public.cards where id = v_card_id for update;
    if not found then raise exception 'wallet_marketplace_card_not_found'; end if;
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
      v_ship_deadline := coalesce(
        nullif(v_spec ->> 'ship_deadline', '')::timestamptz,
        now() + interval '24 hours'
      );
    exception when others then
      raise exception 'wallet_marketplace_order_shape_invalid';
    end;

    if v_amount <= 0 or v_shipping_fee < 0
       or v_shipping_fee > 2147483647
       or v_total_paid <> v_amount + v_shipping_fee then
      raise exception 'wallet_marketplace_amount_invalid';
    end if;
    if v_seller_id = p_user_id then
      raise exception 'wallet_marketplace_self_purchase';
    end if;
    if coalesce(trim(v_spec ->> 'to_name'), '') = ''
       or coalesce(trim(v_spec ->> 'to_phone'), '') = ''
       or coalesce(trim(v_spec ->> 'to_district_name'), '') = ''
       or coalesce(trim(v_spec ->> 'to_province_name'), '') = ''
       or coalesce(trim(v_spec ->> 'to_ward_code'), '') = ''
       or coalesce(trim(v_spec ->> 'to_ward_name'), '') = ''
       or coalesce(trim(v_spec ->> 'to_address_detail'), '') = '' then
      raise exception 'wallet_marketplace_shipping_invalid';
    end if;

    select * into v_card from public.cards where id = v_card_id for update;
    if v_card.seller_id <> v_seller_id or v_card.listing_type <> 'sale' then
      raise exception 'wallet_marketplace_card_binding_invalid';
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
        raise exception 'wallet_marketplace_transaction_binding_invalid';
      end if;
    elsif v_offer_id is not null then
      select * into v_offer from public.offers where id = v_offer_id for update;
      if not found or v_offer.status <> 'chosen'
         or v_offer.buyer_id <> p_user_id
         or v_offer.card_id <> v_card_id
         or v_offer.price <> v_amount
         or v_card.status not in ('active', 'in_transaction') then
        raise exception 'wallet_marketplace_offer_binding_invalid';
      end if;
    else
      if v_card.status <> 'active' then
        raise exception 'wallet_marketplace_card_unavailable';
      end if;
    end if;

    if not coalesce(v_card.is_bundle, false) then
      if v_offer_id is null and v_transaction_id is null and v_card.price <> v_amount then
        raise exception 'wallet_marketplace_price_changed';
      end if;
      if exists (
        select 1 from public.orders o
        where o.card_id = v_card_id and o.id <> v_order_id
          and o.status in ('pending_payment', 'paid', 'shipping', 'delivered', 'completed')
      ) then
        raise exception 'wallet_marketplace_card_already_ordered';
      end if;
    else
      if v_offer_id is not null or v_transaction_id is not null then
        raise exception 'wallet_marketplace_bundle_offer_unsupported';
      end if;

      v_bundle_before := coalesce(v_spec -> 'bundle_items_before', '[]'::jsonb);
      v_bundle_remaining := coalesce(v_spec -> 'bundle_remaining', '[]'::jsonb);
      v_bundle_selection := coalesce(v_spec #> '{metadata,bundle_selection}', '[]'::jsonb);
      if jsonb_typeof(v_bundle_before) <> 'array'
         or jsonb_typeof(v_bundle_remaining) <> 'array'
         or jsonb_typeof(v_bundle_selection) <> 'array'
         or v_card.bundle_items is distinct from v_bundle_before
         or jsonb_array_length(v_bundle_selection) = 0 then
        raise exception 'wallet_marketplace_bundle_snapshot_invalid';
      end if;

      if public.subtract_bundle_selection(v_bundle_before, v_bundle_selection)
           is distinct from v_bundle_remaining then
        raise exception 'wallet_marketplace_bundle_selection_invalid';
      end if;
      begin
        select coalesce(sum((value ->> 'price')::bigint), 0)::bigint
        into v_bundle_selected_total
        from jsonb_array_elements(v_bundle_selection);
      exception when others then
        raise exception 'wallet_marketplace_bundle_price_invalid';
      end;

      if v_bundle_selected_total <> v_amount then
        raise exception 'wallet_marketplace_bundle_selection_invalid';
      end if;
    end if;

    if exists (select 1 from public.orders where id = v_order_id) then
      raise exception 'wallet_marketplace_order_id_conflict';
    end if;

    insert into public.orders (
      id, card_id, seller_id, buyer_id, offer_id, amount, platform_fee,
      total_paid, shipping_fee, payment_method, status, ship_deadline,
      metadata, shipping_address, to_name, to_phone, to_district_id,
      to_district_name, to_province_id, to_province_name, to_ward_code,
      to_ward_name, to_address_detail
    ) values (
      v_order_id, v_card_id, v_seller_id, p_user_id, v_offer_id, v_amount, 0,
      v_total_paid, v_shipping_fee::integer, 'wallet', 'paid', v_ship_deadline,
      coalesce(v_spec -> 'metadata', '{}'::jsonb)
        || case when v_transaction_id is null then '{}'::jsonb
             else jsonb_build_object('transaction_id', v_transaction_id) end,
      nullif(v_spec ->> 'shipping_address', ''), v_spec ->> 'to_name',
      v_spec ->> 'to_phone', (v_spec ->> 'to_district_id')::integer,
      v_spec ->> 'to_district_name', (v_spec ->> 'to_province_id')::integer,
      v_spec ->> 'to_province_name', v_spec ->> 'to_ward_code',
      v_spec ->> 'to_ward_name', v_spec ->> 'to_address_detail'
    ) returning * into v_order;

    v_purposes := v_purposes || jsonb_build_array(jsonb_build_object(
      'purpose_id', v_order_id,
      'amount', v_total_paid
    ));
  end loop;

  perform public.spend_verified_wallet(
    p_user_id, v_purposes, p_idempotency_key, p_description
  );

  update public.wallet_transactions
  set metadata = metadata || jsonb_build_object('order_specs', p_orders)
  where user_id = p_user_id and idempotency_key = p_idempotency_key
    and type = 'marketplace_buy';

  for v_spec in select item from jsonb_array_elements(p_orders) item
  loop
    v_order_id := (v_spec ->> 'order_id')::uuid;
    v_card_id := (v_spec ->> 'card_id')::uuid;
    v_transaction_id := nullif(v_spec ->> 'transaction_id', '')::uuid;
    v_bundle_remaining := coalesce(v_spec -> 'bundle_remaining', 'null'::jsonb);

    if v_bundle_remaining is not null
       and jsonb_typeof(v_bundle_remaining) = 'array'
       and jsonb_array_length(v_bundle_remaining) > 0 then
      update public.cards
      set bundle_items = v_bundle_remaining, status = 'active',
          reserved_until = null, updated_at = now()
      where id = v_card_id;
    else
      update public.cards
      set status = 'sold', reserved_until = null, updated_at = now()
      where id = v_card_id;
    end if;

    if v_transaction_id is not null then
      update public.transactions
      set status = 'completed', completed_at = now()
      where id = v_transaction_id and status = 'active';
      if not found then
        raise exception 'wallet_marketplace_transaction_finalize_failed';
      end if;
    end if;
  end loop;

  perform public.bind_verified_wallet_spend(p_user_id, p_idempotency_key);
  perform public.assert_wallet_fund_integrity(p_user_id);

  select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
  into v_result_orders
  from public.orders o
  join jsonb_array_elements(p_orders) item on o.id::text = item ->> 'order_id';

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'orders', v_result_orders,
    'balance_after', (select available_balance from public.wallets where id = v_wallet.id)
  );
end;
$$;

-- Route-level replay lookup runs before mutable card/offer/transaction checks.
-- This lets a timed-out request replay its committed result after the first
-- transaction has already sold/reserved the card, while a different payload
-- using the same key still fails closed.
create or replace function public.get_marketplace_checkout_replay(
  p_user_id uuid,
  p_idempotency_key uuid,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_spend public.wallet_transactions%rowtype;
  v_payment public.payment_orders%rowtype;
  v_orders jsonb;
begin
  if p_user_id is null or p_idempotency_key is null
     or coalesce(length(p_request_hash), 0) <> 64 then
    raise exception 'invalid_checkout_replay_request';
  end if;

  select * into v_spend
  from public.wallet_transactions
  where user_id = p_user_id and idempotency_key = p_idempotency_key
  limit 1;

  select * into v_payment
  from public.payment_orders
  where user_id = p_user_id and server_idempotency_key = p_idempotency_key
  limit 1;

  if v_spend.id is not null and v_payment.id is not null then
    raise exception 'checkout_idempotency_structural_conflict';
  end if;

  if v_spend.id is not null then
    if v_spend.type <> 'marketplace_buy'
       or jsonb_typeof(v_spend.metadata -> 'order_specs') <> 'array'
       or jsonb_array_length(v_spend.metadata -> 'order_specs') < 1
       or exists (
         select 1
         from jsonb_array_elements(v_spend.metadata -> 'order_specs') spec
         where spec #>> '{metadata,api_request_hash}' is distinct from p_request_hash
       ) then
      raise exception 'idempotency_conflict';
    end if;

    select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
    into v_orders
    from public.orders o
    where o.id in (
      select (spec ->> 'order_id')::uuid
      from jsonb_array_elements(v_spend.metadata -> 'order_specs') spec
    );

    if jsonb_array_length(v_orders) <> jsonb_array_length(v_spend.metadata -> 'order_specs') then
      raise exception 'checkout_replay_inconsistent';
    end if;

    return jsonb_build_object(
      'ok', true, 'found', true, 'replayed', true,
      'payment_method', 'wallet', 'orders', v_orders
    );
  end if;

  if v_payment.id is not null then
    if v_payment.package_type <> 'marketplace_order' then
      raise exception 'idempotency_conflict';
    end if;

    select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
    into v_orders
    from public.orders o
    where o.payment_order_id = v_payment.id;

    if jsonb_array_length(v_orders) < 1
       or exists (
         select 1
         from public.orders o
         where o.payment_order_id = v_payment.id
           and o.metadata ->> 'api_request_hash' is distinct from p_request_hash
       ) then
      raise exception 'idempotency_conflict';
    end if;

    return jsonb_build_object(
      'ok', true, 'found', true, 'replayed', true,
      'payment_method', 'direct_payos',
      'payment_order', jsonb_build_object(
        'id', v_payment.id,
        'order_code', v_payment.order_code,
        'amount', v_payment.amount,
        'currency', v_payment.currency,
        'status', v_payment.status,
        'checkout_url', v_payment.payos_checkout_url
      ),
      'orders', v_orders
    );
  end if;

  return jsonb_build_object('ok', true, 'found', false, 'replayed', false);
end;
$$;

-- Keep the existing signature so current marketplace routes remain compatible,
-- but make the operation provenance-checked and idempotent by type/reference.
create or replace function public.credit_wallet(
  p_user_id uuid,
  p_amount bigint,
  p_type text,
  p_description text,
  p_reference_id text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet_id uuid;
  v_new_balance bigint;
  v_funding public.marketplace_order_funding%rowtype;
  v_order public.orders%rowtype;
  v_source_type text;
  v_source_id uuid;
  v_idempotency_key uuid;
begin
  perform public.assert_financial_mutations_enabled();

  if p_amount is null or p_amount <= 0 or p_user_id is null then
    raise exception 'credit_wallet_invalid_amount';
  end if;

  if p_type not in ('marketplace_sale', 'refund') then
    raise exception 'credit_wallet_unapproved_source_type';
  end if;

  select * into v_order
  from public.orders
  where id::text = p_reference_id
  for update;

  if not found then
    raise exception 'credit_wallet_order_not_found';
  end if;

  select * into v_funding
  from public.marketplace_order_funding
  where order_id = v_order.id
  for update;

  if not found or v_funding.verified_amount < p_amount
     or v_funding.classification not in ('native_verified_escrow', 'backfilled_verified_escrow', 'disputed_frozen') then
    raise exception 'credit_wallet_unverified_parent';
  end if;

  if p_type = 'marketplace_sale' then
    if v_order.seller_id <> p_user_id
       or v_order.status <> 'completed'
       or p_amount > v_order.amount
       or v_funding.classification = 'disputed_frozen' then
      raise exception 'marketplace_sale_binding_invalid';
    end if;
    v_source_type := 'marketplace_sale';
  else
    if v_order.buyer_id <> p_user_id
       or v_order.status not in ('cancelled', 'refunded')
       or p_amount > v_order.total_paid then
      raise exception 'refund_binding_invalid';
    end if;
    v_source_type := 'refund';
  end if;

  v_idempotency_key := public.stable_financial_uuid(
    'credit:' || p_type || ':' || p_reference_id || ':' || p_user_id::text
  );
  v_wallet_id := public.ensure_wallet_for_user(p_user_id);

  insert into public.wallet_fund_sources (
    user_id, wallet_id, source_type, source_id, original_amount,
    remaining_amount, verification_status, credits_wallet, evidence
  ) values (
    p_user_id, v_wallet_id, v_source_type, p_reference_id, p_amount,
    p_amount, 'verified', true,
    jsonb_build_object('order_id', v_order.id, 'funding_id', v_funding.id)
  )
  on conflict (user_id, source_type, source_id) do nothing
  returning id into v_source_id;

  if v_source_id is null then
    select available_balance into v_new_balance
    from public.wallets where id = v_wallet_id;
    return v_new_balance;
  end if;

  update public.wallets
  set available_balance = available_balance + p_amount,
      updated_at = now()
  where id = v_wallet_id
  returning available_balance into v_new_balance;

  insert into public.wallet_transactions (
    wallet_id, user_id, type, amount, balance_after, description,
    reference_id, reference_type, fund_source_id, idempotency_key
  ) values (
    v_wallet_id, p_user_id, p_type, p_amount, v_new_balance,
    p_description, p_reference_id, 'marketplace_order', v_source_id,
    v_idempotency_key
  );

  update public.marketplace_order_funding
  set classification = case when p_type = 'marketplace_sale' then 'released' else 'cancelled' end,
      updated_at = now()
  where id = v_funding.id;

  perform public.assert_wallet_fund_integrity(p_user_id);
  return v_new_balance;
end;
$$;

create or replace function public.resolve_marketplace_dispute(
  p_order_id uuid,
  p_action text,
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
  v_order public.orders%rowtype;
  v_funding public.marketplace_order_funding%rowtype;
  v_existing public.marketplace_dispute_actions%rowtype;
  v_result jsonb;
begin
  perform public.assert_financial_mutations_enabled();
  if p_action not in ('refund_buyer', 'release_seller')
     or p_idempotency_key is null
     or coalesce(trim(p_actor_id), '') = ''
     or p_actor_role not in ('admin', 'moderator') then
    raise exception 'invalid_dispute_action';
  end if;

  select * into v_existing
  from public.marketplace_dispute_actions
  where order_id = p_order_id and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.action <> p_action then raise exception 'idempotency_conflict'; end if;
    return v_existing.result || jsonb_build_object('replayed', true);
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.status <> 'disputed' then raise exception 'order_not_disputed'; end if;
  select * into v_funding from public.marketplace_order_funding where order_id = p_order_id for update;
  if not found or v_funding.verified_amount < v_order.total_paid then
    raise exception 'dispute_funding_not_verified';
  end if;

  insert into public.marketplace_dispute_actions (
    order_id, action, actor_id, actor_role, idempotency_key
  ) values (p_order_id, p_action, p_actor_id, p_actor_role, p_idempotency_key)
  returning * into v_existing;

  if p_action = 'refund_buyer' then
    update public.orders set status = 'refunded', updated_at = now() where id = p_order_id;
    perform public.credit_wallet(
      v_order.buyer_id, v_order.total_paid, 'refund',
      'Dispute refund - Order #' || left(p_order_id::text, 8), p_order_id::text
    );
    update public.cards set status = 'active', updated_at = now() where id = v_order.card_id;
    insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
    values
      (v_order.buyer_id, 'dispute_resolved', 'Dispute resolved',
        'The funds were refunded to your wallet.', v_order.card_id, v_order.id, false),
      (v_order.seller_id, 'dispute_resolved', 'Dispute resolved',
        'An administrator refunded the buyer. The card will be restored.',
        v_order.card_id, v_order.id, false);
    v_result := jsonb_build_object('ok', true, 'status', 'refunded',
      'buyer_id', v_order.buyer_id, 'seller_id', v_order.seller_id);
  else
    update public.marketplace_order_funding
    set classification = 'native_verified_escrow', updated_at = now()
    where id = v_funding.id;
    update public.orders set status = 'completed', updated_at = now() where id = p_order_id;
    perform public.credit_wallet(
      v_order.seller_id, v_order.amount, 'marketplace_sale',
      'Card sale (dispute resolved) - Order #' || left(p_order_id::text, 8), p_order_id::text
    );
    insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
    values
      (v_order.seller_id, 'dispute_resolved', 'Dispute resolved',
        'The funds were released to the seller wallet.', v_order.card_id, v_order.id, false),
      (v_order.buyer_id, 'dispute_resolved', 'Dispute resolved',
        'An administrator determined that the transaction remains valid.', v_order.card_id, v_order.id, false);
    v_result := jsonb_build_object('ok', true, 'status', 'completed',
      'buyer_id', v_order.buyer_id, 'seller_id', v_order.seller_id,
      'seller_payout', v_order.amount);
  end if;

  update public.marketplace_dispute_actions set result = v_result where id = v_existing.id;
  return v_result;
end;
$$;

create or replace function public.complete_verified_marketplace_order(
  p_order_id uuid,
  p_buyer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_funding public.marketplace_order_funding%rowtype;
  v_balance bigint;
  v_selection jsonb;
  v_bundle_items jsonb;
begin
  perform public.assert_financial_mutations_enabled();
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.buyer_id <> p_buyer_id then raise exception 'order_buyer_mismatch'; end if;

  select * into v_funding
  from public.marketplace_order_funding where order_id = p_order_id for update;
  if not found or v_funding.verified_amount <> v_order.total_paid
     or v_funding.classification not in ('native_verified_escrow', 'backfilled_verified_escrow', 'released') then
    raise exception 'marketplace_completion_funding_not_verified';
  end if;

  if v_order.status = 'completed' then
    if v_funding.classification <> 'released' then
      raise exception 'marketplace_completion_inconsistent';
    end if;
    select available_balance into v_balance from public.wallets where user_id = v_order.seller_id;
    return jsonb_build_object('ok', true, 'replayed', true,
      'seller_id', v_order.seller_id, 'seller_payout', v_order.amount,
      'balance_after', v_balance);
  end if;
  if v_order.status not in ('shipping', 'delivered') then
    raise exception 'order_not_completable';
  end if;
  if v_funding.classification = 'released' then
    raise exception 'marketplace_completion_inconsistent';
  end if;

  update public.orders
  set status = 'completed', buyer_confirmed_at = now(), updated_at = now()
  where id = p_order_id;
  v_balance := public.credit_wallet(
    v_order.seller_id, v_order.amount, 'marketplace_sale',
    'Card sale - Order #' || left(p_order_id::text, 8), p_order_id::text
  );
  return jsonb_build_object('ok', true, 'replayed', false,
    'seller_id', v_order.seller_id, 'seller_payout', v_order.amount,
    'balance_after', v_balance);
end;
$$;

create or replace function public.perform_marketplace_order_action(
  p_order_id uuid,
  p_action text,
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.marketplace_order_action_requests%rowtype;
  v_order public.orders%rowtype;
  v_funding public.marketplace_order_funding%rowtype;
  v_hash text;
  v_result jsonb;
  v_payout jsonb;
  v_provider text;
  v_tracking text;
  v_reason text;
  v_auto_complete_at timestamptz;
begin
  perform public.assert_financial_mutations_enabled();
  if p_order_id is null or p_actor_id is null or p_idempotency_key is null
     or p_action not in ('ship', 'confirm_received', 'open_dispute') then
    raise exception 'invalid_marketplace_order_action';
  end if;

  v_hash := jsonb_build_object(
    'version', 1, 'order_id', p_order_id, 'action', p_action,
    'actor_id', p_actor_id, 'payload', coalesce(p_payload, '{}'::jsonb)
  )::text;
  insert into public.marketplace_order_action_requests (
    order_id, actor_id, action, idempotency_key, request_hash, request_payload
  ) values (
    p_order_id, p_actor_id, p_action, p_idempotency_key, v_hash,
    coalesce(p_payload, '{}'::jsonb)
  ) on conflict (order_id, idempotency_key) do nothing;

  select * into v_request
  from public.marketplace_order_action_requests
  where order_id = p_order_id and idempotency_key = p_idempotency_key
  for update;
  if v_request.request_hash <> v_hash then raise exception 'idempotency_conflict'; end if;
  if v_request.result is not null then
    return v_request.result || jsonb_build_object('replayed', true);
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  if p_action = 'ship' then
    v_provider := nullif(trim(p_payload ->> 'shipping_provider'), '');
    v_tracking := nullif(trim(p_payload ->> 'tracking_number'), '');
    begin
      v_auto_complete_at := (p_payload ->> 'auto_complete_at')::timestamptz;
    exception when others then
      raise exception 'invalid_shipping_payload';
    end;
    if v_order.seller_id <> p_actor_id or v_order.status <> 'paid'
       or v_provider is null or (v_provider <> 'self' and v_tracking is null)
       or v_auto_complete_at <= now()
       or v_auto_complete_at > now() + interval '30 days' then
      raise exception 'order_not_shippable';
    end if;
    update public.orders
    set status = 'shipping', tracking_number = v_tracking,
        shipping_provider = v_provider, auto_complete_at = v_auto_complete_at,
        updated_at = now()
    where id = v_order.id;
    insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
    values (
      v_order.buyer_id, 'order_shipped', 'Order shipped!',
      case when v_tracking is null then 'The seller is delivering your order directly.'
        else 'Tracking number: ' || v_tracking end,
      v_order.card_id, v_order.id, false
    );
    v_result := jsonb_build_object(
      'ok', true, 'status', 'shipping', 'tracking_number', v_tracking,
      'shipping_provider', v_provider, 'buyer_id', v_order.buyer_id
    );
  elsif p_action = 'confirm_received' then
    if v_order.buyer_id <> p_actor_id
       or v_order.status not in ('shipping', 'delivered') then
      raise exception 'order_not_confirmable';
    end if;
    v_payout := public.complete_verified_marketplace_order(v_order.id, p_actor_id);
    insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
    values (
      v_order.seller_id, 'order_completed', 'Order completed!',
      'The buyer confirmed receipt. The funds were credited to your wallet.',
      v_order.card_id, v_order.id, false
    );
    v_result := jsonb_build_object(
      'ok', true, 'status', 'completed', 'seller_id', v_order.seller_id,
      'seller_payout', v_payout -> 'seller_payout'
    );
  else
    v_reason := nullif(trim(p_payload ->> 'reason'), '');
    if v_order.buyer_id <> p_actor_id
       or v_order.status not in ('shipping', 'delivered')
       or v_reason is null then
      raise exception 'order_not_disputable';
    end if;
    select * into v_funding
    from public.marketplace_order_funding where order_id = v_order.id for update;
    if not found or v_funding.verified_amount <> v_order.total_paid
       or v_funding.classification not in ('native_verified_escrow', 'backfilled_verified_escrow') then
      raise exception 'dispute_funding_not_verified';
    end if;
    update public.marketplace_order_funding
    set classification = 'disputed_frozen',
        evidence = evidence || jsonb_build_object(
          'pre_dispute_classification', v_funding.classification,
          'disputed_at', now(), 'disputed_by', p_actor_id
        ),
        updated_at = now()
    where id = v_funding.id;
    update public.orders
    set status = 'disputed', dispute_reason = v_reason, updated_at = now()
    where id = v_order.id;
    insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
    values (
      v_order.seller_id, 'order_disputed', 'Order disputed!',
      'The buyer opened a dispute. Reason: ' || v_reason,
      v_order.card_id, v_order.id, false
    );
    v_result := jsonb_build_object('ok', true, 'status', 'disputed');
  end if;

  update public.marketplace_order_action_requests
  set result = v_result, completed_at = now()
  where id = v_request.id;
  return v_result;
end;
$$;

create or replace function public.apply_shipping_webhook_event(
  p_ghn_order_code text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_buyer_message text;
  v_seller_message text;
begin
  perform public.assert_financial_mutations_enabled();
  if coalesce(length(trim(p_ghn_order_code)), 0) < 1
     or coalesce(length(trim(p_status)), 0) < 1
     or length(p_ghn_order_code) > 100 or length(p_status) > 64 then
    raise exception 'invalid_shipping_webhook_event';
  end if;

  select * into v_order
  from public.orders where ghn_order_code = p_ghn_order_code
  for update;
  if not found then
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'order_not_found');
  end if;
  if v_order.status in ('completed', 'cancelled', 'refunded', 'disputed') then
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'terminal_order');
  end if;
  if v_order.ghn_status = p_status then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  if v_order.status = 'delivered' and p_status <> 'delivered' then
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'out_of_order');
  end if;

  update public.orders
  set ghn_status = p_status,
      status = case when p_status = 'delivered' and status = 'shipping'
        then 'delivered' else status end,
      auto_complete_at = case when p_status = 'delivered' and status = 'shipping'
        then now() + interval '72 hours' else auto_complete_at end,
      updated_at = now()
  where id = v_order.id;

  v_buyer_message := case p_status
    when 'picking' then 'The carrier is collecting the order from the seller.'
    when 'picked' then 'The order was collected and is on its way to you.'
    when 'delivering' then 'The carrier is delivering the order to you.'
    when 'delivered' then 'The order was delivered. Confirm receipt to complete it.'
    when 'delivery_fail' then 'Delivery failed. The carrier will try again.'
    else null end;
  v_seller_message := case p_status
    when 'picked' then 'The carrier collected the order successfully.'
    when 'delivered' then 'The order was delivered successfully to the buyer.'
    when 'delivery_fail' then 'Delivery failed. The carrier will try again.'
    else null end;

  if v_buyer_message is not null then
    insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
    values (v_order.buyer_id, 'shipping_update', 'Shipping update',
      v_buyer_message, v_order.card_id, v_order.id, false);
  end if;
  if v_seller_message is not null then
    insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
    values (v_order.seller_id, 'shipping_update', 'Shipping update',
      v_seller_message, v_order.card_id, v_order.id, false);
  end if;
  return jsonb_build_object('ok', true, 'status', p_status, 'order_id', v_order.id);
end;
$$;

create or replace function public.expire_verified_marketplace_order(
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_funding public.marketplace_order_funding%rowtype;
  v_balance bigint;
  v_selection jsonb;
  v_bundle_items jsonb;
begin
  perform public.assert_financial_mutations_enabled();
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  if v_order.status = 'cancelled' then
    if not exists (
      select 1 from public.wallet_fund_sources
      where user_id = v_order.buyer_id and source_type = 'refund'
        and source_id = p_order_id::text
    ) then
      raise exception 'cancelled_order_missing_refund';
    end if;
    select available_balance into v_balance from public.wallets where user_id = v_order.buyer_id;
    return jsonb_build_object('ok', true, 'replayed', true,
      'buyer_id', v_order.buyer_id, 'seller_id', v_order.seller_id,
      'refund_amount', v_order.total_paid, 'balance_after', v_balance);
  end if;

  if v_order.status <> 'paid' or v_order.ship_deadline is null or v_order.ship_deadline >= now() then
    raise exception 'order_not_expirable';
  end if;
  select * into v_funding
  from public.marketplace_order_funding where order_id = p_order_id for update;
  if not found or v_funding.verified_amount <> v_order.total_paid
     or v_funding.classification not in ('native_verified_escrow', 'backfilled_verified_escrow') then
    raise exception 'marketplace_refund_funding_not_verified';
  end if;

  update public.orders set status = 'cancelled', updated_at = now() where id = p_order_id;
  v_balance := public.credit_wallet(
    v_order.buyer_id, v_order.total_paid, 'refund',
    coalesce(nullif(trim(p_reason), ''), 'Refund for overdue shipment'),
    p_order_id::text
  );
  v_selection := coalesce(v_order.metadata -> 'bundle_selection', '[]'::jsonb);
  if jsonb_typeof(v_selection) = 'array' and jsonb_array_length(v_selection) > 0 then
    select coalesce(bundle_items, '[]'::jsonb) into v_bundle_items
    from public.cards where id = v_order.card_id for update;
    update public.cards
    set bundle_items = v_bundle_items || v_selection,
        status = 'active', reserved_until = null, updated_at = now()
    where id = v_order.card_id;
  else
    update public.cards
    set status = 'active', reserved_until = null, updated_at = now()
    where id = v_order.card_id and status in ('sold', 'in_transaction');
  end if;
  insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
  values
    (v_order.buyer_id, 'order_refunded', 'Order cancelled - funds refunded',
      'The seller did not ship on time. The funds were refunded to your CardVerse wallet.',
      v_order.card_id, v_order.id, false),
    (v_order.seller_id, 'order_cancelled', 'Order cancelled due to overdue shipment',
      'You did not update the tracking number on time. The order was cancelled and the buyer was refunded.',
      v_order.card_id, v_order.id, false);
  return jsonb_build_object('ok', true, 'replayed', false,
    'buyer_id', v_order.buyer_id, 'seller_id', v_order.seller_id,
    'card_id', v_order.card_id, 'refund_amount', v_order.total_paid,
    'metadata', v_order.metadata, 'balance_after', v_balance);
end;
$$;

revoke execute on function public.stable_financial_uuid(text) from public, anon, authenticated;
revoke execute on function public.ensure_wallet_for_user(uuid) from public, anon, authenticated;
revoke execute on function public.create_server_payment_order(uuid, bigint, text, bigint, text, uuid) from public, anon, authenticated;
revoke execute on function public.attach_payos_payment_link(uuid, bigint, text, text) from public, anon, authenticated;
revoke execute on function public.attach_payos_payment_link(uuid, bigint, text, text) from service_role;
revoke execute on function public.claim_payos_payment_link_creation(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.attach_claimed_payos_payment_link(uuid, bigint, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.subtract_bundle_selection(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.stage_payos_marketplace_checkout(uuid, bigint, jsonb, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.apply_payos_webhook_event(uuid) from public, anon, authenticated;
revoke execute on function public.record_payos_webhook(text, bigint, text, bigint, text, boolean, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.record_legacy_payos_evidence(text, bigint, bigint, text, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.claim_payos_webhook_post_processing(uuid) from public, anon, authenticated;
revoke execute on function public.finish_payos_webhook_post_processing(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.fulfill_subscription_payment(uuid) from public, anon, authenticated;
revoke execute on function public.grant_admin_subscription_package(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.perform_offer_action(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.consume_scan_credit(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.drain_deferred_payos_webhooks(integer) from public, anon, authenticated;
revoke execute on function public.spend_verified_wallet(uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke execute on function public.bind_verified_wallet_spend(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reverse_verified_wallet_spend(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.create_verified_wallet_marketplace_orders(uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke execute on function public.get_marketplace_checkout_replay(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.credit_wallet(uuid, bigint, text, text, text) from public, anon, authenticated;
revoke execute on function public.resolve_marketplace_dispute(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.complete_verified_marketplace_order(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.perform_marketplace_order_action(uuid, text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.apply_shipping_webhook_event(text, text) from public, anon, authenticated;
revoke execute on function public.expire_verified_marketplace_order(uuid, text) from public, anon, authenticated;

grant execute on function public.ensure_wallet_for_user(uuid) to service_role;
grant execute on function public.create_server_payment_order(uuid, bigint, text, bigint, text, uuid) to service_role;
grant execute on function public.claim_payos_payment_link_creation(uuid, bigint) to service_role;
grant execute on function public.attach_claimed_payos_payment_link(uuid, bigint, uuid, text, text) to service_role;
grant execute on function public.stage_payos_marketplace_checkout(uuid, bigint, jsonb, uuid, timestamptz) to service_role;
grant execute on function public.record_payos_webhook(text, bigint, text, bigint, text, boolean, jsonb, timestamptz) to service_role;
grant execute on function public.record_legacy_payos_evidence(text, bigint, bigint, text, jsonb, timestamptz) to service_role;
grant execute on function public.claim_payos_webhook_post_processing(uuid) to service_role;
grant execute on function public.finish_payos_webhook_post_processing(uuid, uuid, boolean, text) to service_role;
grant execute on function public.fulfill_subscription_payment(uuid) to service_role;
grant execute on function public.grant_admin_subscription_package(uuid, text, text, text, uuid) to service_role;
grant execute on function public.perform_offer_action(uuid, text, uuid) to authenticated;
grant execute on function public.consume_scan_credit(uuid, uuid, uuid) to service_role;
grant execute on function public.drain_deferred_payos_webhooks(integer) to service_role;
-- Low-level spend/bind/reverse primitives are intentionally not callable by
-- application roles.  Only the atomic marketplace orchestration function may
-- invoke them, which removes the old debit-then-create-order crash window.
revoke execute on function public.spend_verified_wallet(uuid, jsonb, uuid, text) from service_role;
revoke execute on function public.bind_verified_wallet_spend(uuid, uuid) from service_role;
revoke execute on function public.reverse_verified_wallet_spend(uuid, uuid, uuid, text) from service_role;
grant execute on function public.create_verified_wallet_marketplace_orders(uuid, jsonb, uuid, text) to service_role;
grant execute on function public.get_marketplace_checkout_replay(uuid, uuid, text) to service_role;
grant execute on function public.credit_wallet(uuid, bigint, text, text, text) to service_role;
grant execute on function public.resolve_marketplace_dispute(uuid, text, text, text, uuid) to service_role;
grant execute on function public.complete_verified_marketplace_order(uuid, uuid) to service_role;
grant execute on function public.perform_marketplace_order_action(uuid, text, uuid, uuid, jsonb) to service_role;
grant execute on function public.apply_shipping_webhook_event(text, text) to service_role;
grant execute on function public.expire_verified_marketplace_order(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
