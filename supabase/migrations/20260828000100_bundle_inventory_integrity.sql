-- Bundle inventory has one source of truth: the physical JSONB entries.  The
-- numeric quantity remains for existing listing/query APIs, but is always the
-- same count.  This migration also makes paid-order restoration explicit so a
-- cancelled pre-payment reservation cannot put the same selection back twice.

-- Repair only the investigated listing, and only while it is still in the
-- exact corrupted state observed from its order history.  Do not use a generic
-- title/price dedupe: two physical cards may legitimately have identical data.
update public.cards
set bundle_items = jsonb_build_array(
      jsonb_build_object(
        'price', 300000,
        'title', 'Savinho Green Parallel',
        'season', '2020-21',
        'setName', 'Prizm Premier League',
        'publisher', 'Panini'
      ),
      jsonb_build_object(
        'price', 300000,
        'title', 'Nathan Ake /99',
        'season', '2024-25',
        'setName', 'Chrome UEFA Club Competitions',
        'publisher', 'Topps'
      )
    ),
    quantity = 2,
    updated_at = now()
where id = 'd49550d6-1d67-44a0-b2b4-84bdfa1b89bd'
  and is_bundle
  and quantity = 3
  and bundle_items = jsonb_build_array(
    jsonb_build_object('price', 300000, 'title', 'Savinho Green Parallel', 'season', '2020-21', 'setName', 'Prizm Premier League', 'publisher', 'Panini'),
    jsonb_build_object('price', 300000, 'title', 'Nathan Ake /99', 'season', '2024-25', 'setName', 'Chrome UEFA Club Competitions', 'publisher', 'Topps'),
    jsonb_build_object('price', 300000, 'title', 'Savinho Green Parallel', 'season', '2020-21', 'setName', 'Prizm Premier League', 'publisher', 'Panini'),
    jsonb_build_object('price', 300000, 'title', 'Nathan Ake /99', 'season', '2024-25', 'setName', 'Chrome UEFA Club Competitions', 'publisher', 'Topps'),
    jsonb_build_object('price', 300000, 'title', 'Savinho Green Parallel', 'season', '2020-21', 'setName', 'Prizm Premier League', 'publisher', 'Panini'),
    jsonb_build_object('price', 300000, 'title', 'Nathan Ake /99', 'season', '2024-25', 'setName', 'Chrome UEFA Club Competitions', 'publisher', 'Topps')
  );

create or replace function public.enforce_bundle_inventory()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if not coalesce(new.is_bundle, false) then
    return new;
  end if;

  if jsonb_typeof(new.bundle_items) <> 'array' then
    raise exception 'bundle_items_must_be_array';
  end if;
  v_count := jsonb_array_length(new.bundle_items);

  -- A full bundle sale consumes every physical entry.  This also corrects the
  -- legacy wallet finalization branch that only changed status to sold.
  if new.status = 'sold' then
    new.bundle_items := '[]'::jsonb;
    new.quantity := 0;
    return new;
  end if;

  if v_count = 0 then
    raise exception 'active_bundle_must_have_items';
  end if;

  -- Marketplace RPCs written before this migration update bundle_items but
  -- omit quantity.  Normalize that specific omission atomically.  Any caller
  -- that explicitly provides an inconsistent quantity is rejected below.
  if tg_op = 'UPDATE'
     and new.bundle_items is distinct from old.bundle_items
     and new.quantity is not distinct from old.quantity then
    new.quantity := v_count;
  elsif new.quantity is distinct from v_count then
    raise exception 'bundle_quantity_mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_bundle_inventory on public.cards;
create trigger trg_enforce_bundle_inventory
before insert or update of is_bundle, bundle_items, quantity, status on public.cards
for each row execute function public.enforce_bundle_inventory();

alter table public.cards
  drop constraint if exists cards_bundle_quantity_matches_items;
alter table public.cards
  add constraint cards_bundle_quantity_matches_items check (
    not coalesce(is_bundle, false)
    or (
      jsonb_typeof(bundle_items) = 'array'
      and quantity = jsonb_array_length(bundle_items)
      and (
        (status = 'sold' and jsonb_array_length(bundle_items) = 0)
        or (status <> 'sold' and jsonb_array_length(bundle_items) > 0)
      )
    )
  );

-- The card trigger is intentionally the single catch-all for wallet, PayOS,
-- cancellation and operator paths.  It also records the exact point at which
-- a reserved selection has actually been subtracted.  An inventory failure in
-- the PayOS webhook performs no card update, so it remains "reserved" and is
-- not eligible for restore.
create or replace function public.mark_bundle_inventory_subtracted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
begin
  if not coalesce(new.is_bundle, false)
     or (tg_op = 'UPDATE' and new.bundle_items is not distinct from old.bundle_items
         and new.status is not distinct from old.status) then
    return new;
  end if;

  select o.id into v_order_id
  from public.orders o
  where o.card_id = new.id
    and o.status = 'paid'
    and o.metadata ->> 'bundle_inventory_state' = 'reserved'
    and jsonb_typeof(o.metadata -> 'bundle_selection') = 'array'
    and jsonb_array_length(o.metadata -> 'bundle_selection') > 0
  order by o.created_at desc, o.id desc
  limit 1
  for update skip locked;

  if v_order_id is not null then
    update public.orders
    set metadata = metadata || jsonb_build_object('bundle_inventory_state', 'subtracted'),
        updated_at = now()
    where id = v_order_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mark_bundle_inventory_subtracted on public.cards;
create trigger trg_mark_bundle_inventory_subtracted
after insert or update of bundle_items, status on public.cards
for each row execute function public.mark_bundle_inventory_subtracted();

create or replace function public.restore_bundle_order_inventory(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_card public.cards%rowtype;
  v_before jsonb;
  v_selection jsonb;
  v_expected_remaining jsonb;
  v_restored_items jsonb;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'bundle_restore_order_not_found';
  end if;
  if v_order.status not in ('cancelled', 'refunded') then
    raise exception 'bundle_restore_order_state_invalid';
  end if;

  v_selection := coalesce(v_order.metadata -> 'bundle_selection', '[]'::jsonb);
  if jsonb_typeof(v_selection) <> 'array' or jsonb_array_length(v_selection) = 0 then
    return jsonb_build_object('ok', true, 'bundle', false);
  end if;
  if v_order.metadata ->> 'bundle_inventory_state' = 'restored' then
    return jsonb_build_object('ok', true, 'bundle', true, 'replayed', true);
  end if;
  if v_order.metadata ->> 'bundle_inventory_state' <> 'subtracted' then
    raise exception 'bundle_restore_not_eligible';
  end if;

  v_before := v_order.metadata -> 'bundle_items_before';
  if jsonb_typeof(v_before) <> 'array' then
    raise exception 'bundle_restore_snapshot_missing';
  end if;
  v_expected_remaining := public.subtract_bundle_selection(v_before, v_selection);

  select * into v_card from public.cards where id = v_order.card_id for update;
  if not found or not coalesce(v_card.is_bundle, false) then
    raise exception 'bundle_restore_card_invalid';
  end if;
  if jsonb_typeof(v_card.bundle_items) <> 'array' then
    raise exception 'bundle_restore_inventory_invalid';
  end if;

  v_restored_items := v_card.bundle_items || v_selection;
  update public.cards
  set bundle_items = v_restored_items,
      quantity = jsonb_array_length(v_restored_items),
      status = case when v_card.status = 'sold' then 'active' else v_card.status end,
      reserved_until = case when v_card.status = 'sold' then null else v_card.reserved_until end,
      updated_at = now()
  where id = v_card.id;

  update public.orders
  set metadata = metadata || jsonb_build_object(
        'bundle_inventory_state', 'restored',
        'bundle_inventory_restored_at', now()
      ),
      updated_at = now()
  where id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'bundle', true,
    'replayed', false,
    'quantity', jsonb_array_length(v_restored_items),
    'expected_remaining_count', jsonb_array_length(v_expected_remaining)
  );
end;
$$;

-- A dispute refund changes status to refunded, which is deliberately not
-- handled by the old cancellation relist trigger.  Restore only after the
-- order is marked terminal and only through the guarded helper above.
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

  select * into v_existing from public.marketplace_dispute_actions
  where order_id = p_order_id and idempotency_key = p_idempotency_key for update;
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
    perform public.restore_bundle_order_inventory(p_order_id);
    update public.cards set status = 'active', updated_at = now()
    where id = v_order.card_id and not coalesce(is_bundle, false);
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
    set classification = 'native_verified_escrow', updated_at = now() where id = v_funding.id;
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
begin
  perform public.assert_financial_mutations_enabled();
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  if v_order.status = 'cancelled' then
    if not exists (
      select 1 from public.wallet_fund_sources
      where user_id = v_order.buyer_id and source_type = 'refund'
        and source_id = p_order_id::text
    ) then raise exception 'cancelled_order_missing_refund'; end if;
    select available_balance into v_balance from public.wallets where user_id = v_order.buyer_id;
    return jsonb_build_object('ok', true, 'replayed', true,
      'buyer_id', v_order.buyer_id, 'seller_id', v_order.seller_id,
      'refund_amount', v_order.total_paid, 'balance_after', v_balance);
  end if;

  if v_order.status <> 'paid' or v_order.ship_deadline is null or v_order.ship_deadline >= now() then
    raise exception 'order_not_expirable';
  end if;
  select * into v_funding from public.marketplace_order_funding where order_id = p_order_id for update;
  if not found or v_funding.verified_amount <> v_order.total_paid
     or v_funding.classification not in ('native_verified_escrow', 'backfilled_verified_escrow') then
    raise exception 'marketplace_refund_funding_not_verified';
  end if;

  update public.orders set status = 'cancelled', updated_at = now() where id = p_order_id;
  v_balance := public.credit_wallet(
    v_order.buyer_id, v_order.total_paid, 'refund',
    coalesce(nullif(trim(p_reason), ''), 'Refund for overdue shipment'), p_order_id::text
  );
  perform public.restore_bundle_order_inventory(p_order_id);
  update public.cards set status = 'active', reserved_until = null, updated_at = now()
  where id = v_order.card_id and not coalesce(is_bundle, false)
    and status in ('sold', 'in_transaction');
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

revoke execute on function public.enforce_bundle_inventory() from public, anon, authenticated;
revoke execute on function public.mark_bundle_inventory_subtracted() from public, anon, authenticated;
revoke execute on function public.restore_bundle_order_inventory(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.resolve_marketplace_dispute(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.expire_verified_marketplace_order(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_marketplace_dispute(uuid, text, text, text, uuid) to service_role;
grant execute on function public.expire_verified_marketplace_order(uuid, text) to service_role;

notify pgrst, 'reload schema';
