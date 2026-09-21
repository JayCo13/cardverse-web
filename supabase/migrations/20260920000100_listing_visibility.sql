begin;

alter table public.cards
  add column if not exists listing_visibility text not null default 'visible',
  add column if not exists hidden_at timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.cards drop constraint if exists cards_listing_visibility_check;
alter table public.cards add constraint cards_listing_visibility_check
  check (listing_visibility in ('visible', 'hidden', 'deleted'));

create index if not exists idx_cards_marketplace_visibility
  on public.cards (listing_type, status, listing_visibility, created_at desc, id desc);
create index if not exists idx_cards_seller_visibility_recent
  on public.cards (seller_id, listing_visibility, created_at desc, id desc);

-- Visibility is seller-controlled state, but changing it directly would skip
-- offer rejection and the transaction checks below. Only the management RPC
-- may make a visibility transition.
create or replace function public.guard_listing_visibility_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.listing_visibility is distinct from old.listing_visibility
     and coalesce(current_setting('cardverse.manage_listing', true), '') <> 'on' then
    raise exception 'listing_visibility_rpc_required';
  end if;
  if old.listing_visibility = 'deleted'
     and new is distinct from old then
    raise exception 'listing_deleted';
  end if;
  -- A hidden listing must not enter a financial lifecycle through a stale
  -- browser or concurrent request. Restoring visibility happens separately.
  if old.listing_visibility <> 'visible'
     and new.status is distinct from old.status then
    raise exception 'listing_hidden';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_listing_visibility_update on public.cards;
create trigger guard_listing_visibility_update
before update on public.cards
for each row execute function public.guard_listing_visibility_update();

-- Offer creation and state transitions serialize on the card row. Whichever
-- starts first wins: a new pending offer is included by hide, or a completed
-- hide makes the offer fail closed.
create or replace function public.guard_offer_listing_visibility()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_card public.cards%rowtype;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    select * into v_card from public.cards where id = new.card_id for update;
    if not found then raise exception 'card_not_found'; end if;
    if v_card.listing_visibility <> 'visible' then raise exception 'listing_hidden'; end if;
    if tg_op = 'INSERT' and (
      v_card.status <> 'active' or v_card.listing_type <> 'sale'
      or not coalesce(v_card.accept_offers, false)
    ) then
      raise exception 'card_unavailable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_offer_listing_visibility on public.offers;
create trigger guard_offer_listing_visibility
before insert or update of status on public.offers
for each row execute function public.guard_offer_listing_visibility();

-- Orders/transactions created for a listing are the final authority, including
-- service-role and legacy routes that do not pass through the current API.
create or replace function public.guard_listing_financial_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_visibility text;
begin
  select listing_visibility into v_visibility
  from public.cards where id = new.card_id for update;
  if not found then raise exception 'card_not_found'; end if;
  if v_visibility <> 'visible' then raise exception 'listing_hidden'; end if;
  return new;
end;
$$;

drop trigger if exists guard_order_listing_visibility on public.orders;
create trigger guard_order_listing_visibility
before insert on public.orders
for each row execute function public.guard_listing_financial_insert();

drop trigger if exists guard_transaction_listing_visibility on public.transactions;
create trigger guard_transaction_listing_visibility
before insert on public.transactions
for each row execute function public.guard_listing_financial_insert();

drop trigger if exists guard_cart_listing_visibility on public.cart_items;
create trigger guard_cart_listing_visibility
before insert or update of card_id on public.cart_items
for each row execute function public.guard_listing_financial_insert();

-- Accept/reject and hide/restore/delete must take the same transaction-scoped
-- listing lock before either path takes row locks. Locking every offer first is
-- unsafe: accept locks its chosen offer, then the card, then rival offers,
-- which forms a cycle with a bulk offer-first hide.
create or replace function public.perform_offer_action(
  p_offer_id uuid,
  p_action text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor uuid := auth.uid();
  v_existing public.offer_action_requests%rowtype;
  v_offer public.offers%rowtype;
  v_card public.cards%rowtype;
  v_held jsonb := '[]'::jsonb;
  v_result jsonb;
  v_partial boolean := false;
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

  -- Discover the listing without a row lock, then serialize every seller
  -- action for that listing before taking the offer/card locks in their
  -- established order. Re-check the offer binding after it is locked.
  select c.* into v_card
  from public.cards c
  join public.offers o on o.card_id = c.id
  where o.id = p_offer_id;
  if not found then raise exception 'offer_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('listing-action:' || v_card.id::text, 0));

  select * into v_offer from public.offers where id = p_offer_id for update;
  if not found then raise exception 'offer_not_found'; end if;
  if v_offer.card_id <> v_card.id then raise exception 'offer_listing_changed'; end if;
  select * into v_card from public.cards where id = v_offer.card_id for update;
  if not found then raise exception 'card_not_found'; end if;
  if v_card.seller_id <> v_actor then raise exception 'offer_forbidden'; end if;
  if v_offer.status <> 'pending' then raise exception 'offer_not_pending'; end if;

  v_partial := coalesce(v_card.is_bundle, false)
    and v_offer.bundle_selection is not null
    and jsonb_typeof(v_offer.bundle_selection) = 'array'
    and jsonb_array_length(v_offer.bundle_selection) > 0;

  if p_action = 'accept' then
    if v_card.status <> 'active' or v_card.listing_visibility <> 'visible' then
      raise exception 'card_unavailable';
    end if;

    if v_partial then
      perform public.subtract_bundle_selection(
        coalesce(v_card.bundle_items, '[]'::jsonb), v_offer.bundle_selection);
    else
      update public.cards
      set status = 'in_transaction', reserved_until = now() + interval '1 hour', updated_at = now()
      where id = v_card.id;
    end if;

    update public.offers
    set status = 'chosen',
        payment_deadline = case when v_partial then now() + interval '1 hour' else null end
    where id = v_offer.id;

    with rivals as (
      select o.id, o.buyer_id
      from public.offers o
      where o.card_id = v_card.id and o.id <> v_offer.id and o.status = 'pending'
        and (
          not v_partial
          or o.bundle_selection is null
          or jsonb_typeof(o.bundle_selection) <> 'array'
          or exists (
            select 1
            from jsonb_array_elements(o.bundle_selection) rival_item
            join jsonb_array_elements(v_offer.bundle_selection) taken_item
              on rival_item.value = taken_item.value
          )
        )
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'buyer_id', buyer_id)), '[]'::jsonb)
    into v_held
    from rivals;

    update public.offers
    set status = 'on_hold'
    where id in (select (item ->> 'id')::uuid from jsonb_array_elements(v_held) item);

    insert into public.notifications (user_id, type, title, message, card_id, offer_id, read)
    values (
      v_offer.buyer_id, 'offer_accepted', 'Offer accepted!',
      'The seller accepted your offer. You have one hour to complete payment.',
      v_card.id, v_offer.id, false
    );
    insert into public.notifications (user_id, type, title, message, card_id, offer_id, read)
    select
      (item ->> 'buyer_id')::uuid, 'offer_on_hold', 'Offer on hold',
      'Another buyer is completing payment for this card. Your offer stays in the queue, and returns to the seller if that payment does not arrive.',
      v_card.id, (item ->> 'id')::uuid, false
    from jsonb_array_elements(v_held) item;
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
    'price', v_offer.price, 'on_hold', v_held,
    'bundle_selection', v_offer.bundle_selection
  );
  insert into public.offer_action_requests (
    offer_id, actor_id, action, idempotency_key, result
  ) values (v_offer.id, v_actor, p_action, p_idempotency_key, v_result);
  return v_result;
end;
$fn$;

create or replace function public.manage_own_listing(
  p_listing_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_card public.cards%rowtype;
  v_rejected_count integer := 0;
  v_rejected_ids jsonb := '[]'::jsonb;
begin
  if v_actor is null then raise exception 'unauthorized'; end if;
  if p_action not in ('hide', 'restore', 'delete') then
    raise exception 'invalid_listing_action';
  end if;

  perform public.assert_account_session();
  select * into v_card from public.cards where id = p_listing_id;
  if not found or v_card.seller_id <> v_actor then raise exception 'listing_not_found'; end if;

  -- The offer action RPC takes this exact lock before touching its offer/card
  -- rows, so hide and accept are first-writer-wins without opposite row-lock
  -- orders. New offer insertion still serializes through the card-row trigger.
  perform pg_advisory_xact_lock(hashtextextended('listing-action:' || p_listing_id::text, 0));
  select * into v_card from public.cards where id = p_listing_id for update;
  if not found or v_card.seller_id <> v_actor then raise exception 'listing_not_found'; end if;

  if p_action = 'hide' then
    if v_card.listing_visibility = 'hidden' then
      return jsonb_build_object('listingId', v_card.id, 'visibility', 'hidden', 'replayed', true, 'rejectedOfferCount', 0);
    end if;
    if v_card.listing_visibility <> 'visible' or v_card.status <> 'active' then
      raise exception 'listing_not_hideable';
    end if;
    if exists (
      select 1 from public.offers
      where card_id = v_card.id and status in ('accepted', 'chosen', 'on_hold')
    ) or exists (
      select 1 from public.transactions where card_id = v_card.id and status = 'active'
    ) or exists (
      select 1 from public.orders
      where card_id = v_card.id and status not in ('completed', 'refunded', 'cancelled')
    ) then
      raise exception 'listing_transaction_locked';
    end if;

    with rejected as (
      update public.offers
      set status = 'rejected'
      where card_id = v_card.id and status = 'pending'
      returning id, buyer_id
    ), told as (
      insert into public.notifications
        (user_id, type, title, message, card_id, offer_id, read, metadata)
      select buyer_id, 'offer_rejected', 'Offer rejected',
        'The seller closed this listing, so your offer was rejected.',
        v_card.id, id, false, jsonb_build_object('event', 'listing_hidden')
      from rejected
      returning offer_id
    )
    select count(*), coalesce(jsonb_agg(offer_id), '[]'::jsonb)
      into v_rejected_count, v_rejected_ids from told;

    delete from public.cart_items where card_id = v_card.id;
    perform set_config('cardverse.manage_listing', 'on', true);
    update public.cards
      set listing_visibility = 'hidden', hidden_at = now(), deleted_at = null, updated_at = now()
      where id = v_card.id;
    perform set_config('cardverse.manage_listing', 'off', true);

    return jsonb_build_object(
      'listingId', v_card.id, 'visibility', 'hidden', 'replayed', false,
      'rejectedOfferCount', v_rejected_count, 'rejectedOfferIds', v_rejected_ids
    );
  end if;

  if p_action = 'restore' then
    if v_card.listing_visibility = 'visible' then
      return jsonb_build_object('listingId', v_card.id, 'visibility', 'visible', 'replayed', true);
    end if;
    if v_card.listing_visibility <> 'hidden' or v_card.status <> 'active' then
      raise exception 'listing_not_restorable';
    end if;
    if not exists (
      select 1 from public.seller_verifications
      where user_id = v_actor and status = 'approved'
    ) then
      raise exception 'seller_not_approved';
    end if;
    if exists (
      select 1 from public.offers
      where card_id = v_card.id and status in ('pending', 'accepted', 'chosen', 'on_hold')
    ) or exists (
      select 1 from public.transactions where card_id = v_card.id and status = 'active'
    ) or exists (
      select 1 from public.orders
      where card_id = v_card.id and status not in ('completed', 'refunded', 'cancelled')
    ) then
      raise exception 'listing_transaction_locked';
    end if;

    perform set_config('cardverse.manage_listing', 'on', true);
    update public.cards
      set listing_visibility = 'visible', hidden_at = null, updated_at = now()
      where id = v_card.id;
    perform set_config('cardverse.manage_listing', 'off', true);
    return jsonb_build_object('listingId', v_card.id, 'visibility', 'visible', 'replayed', false);
  end if;

  if v_card.listing_visibility = 'deleted' then
    return jsonb_build_object('listingId', v_card.id, 'visibility', 'deleted', 'replayed', true);
  end if;
  if v_card.listing_visibility <> 'hidden' then raise exception 'listing_hide_before_delete'; end if;
  if exists (
    select 1 from public.offers
    where card_id = v_card.id and status in ('pending', 'accepted', 'chosen', 'on_hold')
  ) or exists (
    select 1 from public.transactions where card_id = v_card.id and status = 'active'
  ) or exists (
    select 1 from public.orders
    where card_id = v_card.id and status not in ('completed', 'refunded', 'cancelled')
  ) then
    raise exception 'listing_transaction_locked';
  end if;

  delete from public.cart_items where card_id = v_card.id;
  perform set_config('cardverse.manage_listing', 'on', true);
  update public.cards
    set listing_visibility = 'deleted', deleted_at = now(), updated_at = now()
    where id = v_card.id;
  perform set_config('cardverse.manage_listing', 'off', true);
  return jsonb_build_object('listingId', v_card.id, 'visibility', 'deleted', 'replayed', false);
end;
$$;

revoke all on function public.manage_own_listing(uuid, text) from public, anon;
grant execute on function public.manage_own_listing(uuid, text) to authenticated;

create or replace function public.get_seller_dashboard_summary()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'orders', jsonb_build_object(
      'total', count(*),
      'waitingShip', count(*) filter (where o.status = 'paid'),
      'shipping', count(*) filter (where o.status in ('shipping', 'delivered')),
      'completed', count(*) filter (where o.status = 'completed'),
      'totalEarnings', coalesce(sum(o.amount - o.platform_fee) filter (where o.status = 'completed'), 0)
    ),
    'listings', (
      select jsonb_build_object(
        'active', count(*) filter (where c.listing_visibility = 'visible' and c.status in ('active', 'in_transaction')),
        'sold', count(*) filter (where c.listing_visibility = 'visible' and c.status = 'sold'),
        'draft', count(*) filter (where c.listing_visibility = 'visible' and coalesce(c.status, '') not in ('active', 'in_transaction', 'sold')),
        'hidden', count(*) filter (where c.listing_visibility = 'hidden'),
        'total', count(*) filter (where c.listing_visibility <> 'deleted')
      )
      from public.cards c
      where c.seller_id = auth.uid()
    )
  )
  from public.orders o
  where o.seller_id = auth.uid();
$$;

revoke all on function public.get_seller_dashboard_summary() from public, anon;
grant execute on function public.get_seller_dashboard_summary() to authenticated;

notify pgrst, 'reload schema';
commit;
