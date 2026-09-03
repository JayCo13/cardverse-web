-- Let a buyer offer on specific cards inside a bundle listing.
--
-- Before this, a bundle could be offered on but never paid for. OfferModal sent
-- the whole listing, `perform_offer_action` reserved the whole listing, and then
-- /api/checkout refused the offer outright with `bundle_offer_checkout_unsupported`
-- — so every accepted bundle offer was a dead end that also took the listing off
-- the market for the length of the payment window.
--
-- The buy path already does this correctly: the buyer picks cards, pays the sum
-- of exactly those, and the rest of the bundle stays listed. Offers now carry
-- the same selection so they can travel the same road.

-- Which cards of the bundle this offer is for. Null for a normal listing, and
-- for the bundle offers that predate this column — those stay whole-listing.
alter table public.offers
  add column if not exists bundle_selection jsonb;

-- A partially-accepted bundle offer leaves the card `active`, so the lifecycle
-- sweep's "this offer no longer holds its card" test would expire it instantly.
-- Those offers are bounded by their own deadline instead.
alter table public.offers
  add column if not exists payment_deadline timestamp with time zone;

alter table public.offers drop constraint if exists offers_bundle_selection_check;
alter table public.offers add constraint offers_bundle_selection_check
  check (bundle_selection is null or jsonb_typeof(bundle_selection) = 'array');

-- Accepting a bundle offer must not behave like accepting a single-card offer.
--
-- Two things change, and only for a bundle offer that names a selection:
--
--  1. The card is NOT moved to `in_transaction`. A bundle is inventory, not one
--     item: holding all of it hostage because somebody offered on one card is
--     what the buy path deliberately avoids (it subtracts the sold cards and
--     leaves `remaining` listed). The selection is verified as still present at
--     accept time, and again — under a row lock, by the financial RPC — when the
--     buyer actually pays. That second check is the one that decides, so a race
--     between two buyers over the same card ends with one 409, not a double sale.
--
--  2. Rival offers are rejected only where they overlap. Two buyers wanting two
--     different cards out of the same bundle is a sale the seller should be able
--     to make twice, so an offer whose selection is disjoint from the accepted
--     one survives.
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

  select * into v_offer from public.offers where id = p_offer_id for update;
  if not found then raise exception 'offer_not_found'; end if;
  select * into v_card from public.cards where id = v_offer.card_id for update;
  if not found then raise exception 'card_not_found'; end if;
  if v_card.seller_id <> v_actor then raise exception 'offer_forbidden'; end if;
  if v_offer.status <> 'pending' then raise exception 'offer_not_pending'; end if;

  v_partial := coalesce(v_card.is_bundle, false)
    and v_offer.bundle_selection is not null
    and jsonb_typeof(v_offer.bundle_selection) = 'array'
    and jsonb_array_length(v_offer.bundle_selection) > 0;

  if p_action = 'accept' then
    if v_card.status <> 'active' then raise exception 'card_unavailable'; end if;

    if v_partial then
      -- Raises `bundle_selection_invalid` if any offered card has since been
      -- sold out of the bundle. The seller sees a 409 instead of accepting an
      -- offer the buyer could never pay.
      perform public.subtract_bundle_selection(
        coalesce(v_card.bundle_items, '[]'::jsonb), v_offer.bundle_selection);
    else
      update public.cards
      set status = 'in_transaction', reserved_until = now() + interval '24 hours', updated_at = now()
      where id = v_card.id;
    end if;

    -- A partial acceptance carries its own deadline because it holds no card
    -- reservation to expire; a whole-listing one keeps using cards.reserved_until.
    update public.offers
    set status = 'chosen',
        payment_deadline = case when v_partial then now() + interval '24 hours' else null end
    where id = v_offer.id;

    with rivals as (
      select o.id, o.buyer_id
      from public.offers o
      where o.card_id = v_card.id and o.id <> v_offer.id and o.status = 'pending'
        and (
          not v_partial
          -- A rival that named no selection is an offer on the whole listing,
          -- which necessarily overlaps.
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
    into v_losers
    from rivals;

    update public.offers
    set status = 'rejected'
    where id in (select (item ->> 'id')::uuid from jsonb_array_elements(v_losers) item);

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
    'price', v_offer.price, 'losers', v_losers,
    'bundle_selection', v_offer.bundle_selection
  );
  insert into public.offer_action_requests (
    offer_id, actor_id, action, idempotency_key, result
  ) values (v_offer.id, v_actor, p_action, p_idempotency_key, v_result);
  return v_result;
end;
$$;

create or replace function public.run_offer_payment_lifecycle(
  p_remind_before interval default interval '4 hours'
)
returns table (
  kind text,
  offer_id uuid,
  buyer_id uuid,
  card_id uuid,
  card_name text,
  price bigint,
  deadline timestamp with time zone
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select o.id, o.buyer_id, c.id as card_id, c.name as card_name,
           o.price,
           coalesce(o.payment_deadline, c.reserved_until) as reserved_until,
           o.payment_reminder_sent_at,
           (c.status = 'in_transaction' and c.reserved_until < now()) as needs_relist
    from public.offers o
    join public.cards c on c.id = o.card_id
    where o.status = 'chosen'
      and case
        -- Partial bundle offers never reserved the card, so only their own
        -- deadline can close them.
        when o.payment_deadline is not null then o.payment_deadline < now()
        else (
          (c.status = 'in_transaction' and c.reserved_until is not null and c.reserved_until < now())
          or c.status <> 'in_transaction'
        )
      end
    for update of o, c skip locked
  ),
  relisted as (
    update public.cards c
    set status = 'active', reserved_until = null, updated_at = now()
    from due where c.id = due.card_id and due.needs_relist
    returning c.id
  ),
  closed as (
    update public.offers o
    set status = 'expired'
    from due where o.id = due.id
    returning o.id
  ),
  penalised as (
    update public.profiles p
    set legit_rate = greatest(0, coalesce(p.legit_rate, 100) - 5),
        cancelled_transactions = coalesce(p.cancelled_transactions, 0) + 1,
        updated_at = now()
    from due
    where p.id = due.buyer_id and due.payment_reminder_sent_at is not null
    returning p.id
  ),
  told as (
    insert into public.notifications (user_id, type, title, message, card_id, offer_id, read)
    select due.buyer_id, 'offer_payment_expired', 'Payment window closed',
           'The card was returned to the marketplace because the payment window closed.',
           due.card_id, due.id, false
    from due
    returning id
  )
  select 'expired'::text, due.id, due.buyer_id, due.card_id, due.card_name,
         due.price, due.reserved_until
  from due;

  return query
  update public.offers o
  set payment_reminder_sent_at = now()
  from public.cards c
  where c.id = o.card_id
    and o.status = 'chosen'
    and o.payment_reminder_sent_at is null
    and coalesce(o.payment_deadline, c.reserved_until) is not null
    and coalesce(o.payment_deadline, c.reserved_until) > now()
    and coalesce(o.payment_deadline, c.reserved_until) <= now() + p_remind_before
    and (o.payment_deadline is not null or c.status = 'in_transaction')
  returning 'remind'::text, o.id, o.buyer_id, c.id, c.name, o.price,
            coalesce(o.payment_deadline, c.reserved_until);
end;
$$;

revoke all on function public.run_offer_payment_lifecycle(interval) from public, anon, authenticated;
grant execute on function public.run_offer_payment_lifecycle(interval) to service_role;

-- Teach both financial settlement paths about the bundle selection frozen on
-- an accepted offer. The route sends the same canonical JSON objects stored on
-- the offer, so the database can verify identity under the card row lock. The
-- agreed offer amount deliberately does not have to equal the cards' listed
-- total; the offer row is the trusted amount in that case.
do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname = 'create_verified_wallet_marketplace_orders';

  if v_def is null then
    raise exception 'create_verified_wallet_marketplace_orders is missing';
  end if;

  v_old := $wallet_old$
      if v_offer_id is not null or v_transaction_id is not null then
        raise exception 'wallet_marketplace_bundle_offer_unsupported';
      end if;

      v_bundle_before := coalesce(v_spec -> 'bundle_items_before', '[]'::jsonb);
$wallet_old$;
  v_new := $wallet_new$
      -- Transactions never carried a bundle snapshot. Bundle offers do, and
      -- are safe only when the request repeats that exact frozen selection.
      if v_transaction_id is not null then
        raise exception 'wallet_marketplace_bundle_transaction_unsupported';
      end if;

      v_bundle_before := coalesce(v_spec -> 'bundle_items_before', '[]'::jsonb);
$wallet_new$;
  if position(v_old in v_def) = 0 then
    raise exception 'wallet bundle-offer guard changed; refusing unsafe migration';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := $wallet_price_old$
      if v_bundle_selected_total <> v_amount then
        raise exception 'wallet_marketplace_bundle_selection_invalid';
      end if;
$wallet_price_old$;
  v_new := $wallet_price_new$
      if v_offer_id is not null then
        if v_offer.bundle_selection is distinct from v_bundle_selection
           or v_card.status <> 'active'
           or v_offer.payment_deadline is null
           or v_offer.payment_deadline <= now() then
          raise exception 'wallet_marketplace_bundle_offer_binding_invalid';
        end if;
      elsif v_bundle_selected_total <> v_amount then
        raise exception 'wallet_marketplace_bundle_selection_invalid';
      end if;
$wallet_price_new$;
  if position(v_old in v_def) = 0 then
    raise exception 'wallet bundle price validation changed; refusing unsafe migration';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := $wallet_finalize_old$
    if v_transaction_id is not null then
      update public.transactions
      set status = 'completed', completed_at = now()
      where id = v_transaction_id and status = 'active';
      if not found then
        raise exception 'wallet_marketplace_transaction_finalize_failed';
      end if;
    end if;
$wallet_finalize_old$;
  v_new := $wallet_finalize_new$
    if v_transaction_id is not null then
      update public.transactions
      set status = 'completed', completed_at = now()
      where id = v_transaction_id and status = 'active';
      if not found then
        raise exception 'wallet_marketplace_transaction_finalize_failed';
      end if;
    end if;

    if v_offer_id is not null then
      update public.offers
      set status = 'accepted', payment_deadline = null
      where id = v_offer_id and status = 'chosen';
      if not found then
        raise exception 'wallet_marketplace_offer_finalize_failed';
      end if;
    end if;
$wallet_finalize_new$;
  if position(v_old in v_def) = 0 then
    raise exception 'wallet finalization changed; refusing unsafe migration';
  end if;
  execute replace(v_def, v_old, v_new);
end
$$;

do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname = 'stage_payos_marketplace_checkout';

  if v_def is null then
    raise exception 'stage_payos_marketplace_checkout is missing';
  end if;

  v_old := $payos_old$
      if v_offer_id is not null or v_transaction_id is not null then
        raise exception 'payos_marketplace_bundle_offer_unsupported';
      end if;
      v_bundle_before := coalesce(v_spec -> 'bundle_items_before', '[]'::jsonb);
$payos_old$;
  v_new := $payos_new$
      if v_transaction_id is not null then
        raise exception 'payos_marketplace_bundle_transaction_unsupported';
      end if;
      v_bundle_before := coalesce(v_spec -> 'bundle_items_before', '[]'::jsonb);
$payos_new$;
  if position(v_old in v_def) = 0 then
    raise exception 'PayOS bundle-offer guard changed; refusing unsafe migration';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := $payos_price_old$
      if (select coalesce(sum((value ->> 'price')::bigint), 0)
          from jsonb_array_elements(v_bundle_selection)) <> v_amount then
        raise exception 'payos_marketplace_bundle_selection_invalid';
      end if;
$payos_price_old$;
  v_new := $payos_price_new$
      if v_offer_id is not null then
        if v_offer.bundle_selection is distinct from v_bundle_selection
           or v_card.status <> 'active'
           or v_offer.payment_deadline is null
           or v_offer.payment_deadline <= now() then
          raise exception 'payos_marketplace_bundle_offer_binding_invalid';
        end if;
      elsif (select coalesce(sum((value ->> 'price')::bigint), 0)
             from jsonb_array_elements(v_bundle_selection)) <> v_amount then
        raise exception 'payos_marketplace_bundle_selection_invalid';
      end if;
$payos_price_new$;
  if position(v_old in v_def) = 0 then
    raise exception 'PayOS bundle price validation changed; refusing unsafe migration';
  end if;
  execute replace(v_def, v_old, v_new);
end
$$;

-- PayOS consumes bundle inventory only after a verified provider webhook. Once
-- that succeeds, close the accepted offer as paid so its 24-hour lifecycle can
-- no longer expire or remind it.
do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname = 'apply_payos_webhook_event';

  if v_def is null then
    raise exception 'apply_payos_webhook_event is missing';
  end if;

  v_old := $webhook_old$
        v_transaction_id := nullif(
          v_market_order.metadata ->> 'transaction_id', ''
        )::uuid;
$webhook_old$;
  v_new := $webhook_new$
        if v_market_order.offer_id is not null then
          update public.offers
          set status = 'accepted', payment_deadline = null
          where id = v_market_order.offer_id and status = 'chosen';
          if not found and not exists (
            select 1 from public.offers
            where id = v_market_order.offer_id and status = 'accepted'
          ) then
            raise exception 'payos_offer_finalize_invalid';
          end if;
        end if;

        v_transaction_id := nullif(
          v_market_order.metadata ->> 'transaction_id', ''
        )::uuid;
$webhook_new$;
  if position(v_old in v_def) = 0 then
    raise exception 'PayOS webhook finalization changed; refusing unsafe migration';
  end if;
  execute replace(v_def, v_old, v_new);
end
$$;
