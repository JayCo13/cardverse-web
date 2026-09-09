-- Hold the runners-up instead of rejecting them, and cut the payment window to
-- one hour.
--
-- Today, accepting one offer rejects every rival outright
-- (20260903000100_bundle_offers.sql:138-140, notifying them "The seller accepted
-- another offer for this card"). `rejected` is terminal — there is no path back
-- to `pending` — so when the winner never pays, the card returns to the market
-- with nobody left to sell it to. The seller has to ask the other buyers to bid
-- again, which is the failure this migration exists to remove.
--
-- Rivals now go to `on_hold`. If the winner pays, they expire, unpenalised and
-- without setting a price floor. If the winner does not, they come back as
-- `pending` and the seller picks again with a fresh hour.
--
-- eBay's Best Offer works the same way in outline — an accepted offer closes the
-- rest, offers carry a limit per listing that counts declined and expired
-- attempts alike, and repeated non-payment restricts offering while leaving
-- immediate purchase alone. What eBay does not do is bring the rivals back, and
-- that is the whole point here.

-- ─── The new status ──────────────────────────────────────────────────────────
alter table public.offers drop constraint if exists offers_status_check;
alter table public.offers add constraint offers_status_check
  check (status = any (array['pending','accepted','rejected','chosen','expired','on_hold']));

-- ─── Accepting an offer ──────────────────────────────────────────────────────
--
-- Carried forward wholesale from 20260903000100 (bundle handling, idempotency
-- ledger, advisory lock, partial-selection overlap test are all unchanged).
-- Three things differ, all marked below:
--   1. the reservation is one hour, not twenty-four
--   2. rivals become `on_hold`, not `rejected`
--   3. their notification says so
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
      -- (1) One hour. The window was 2h, widened to 24h by 20260902000100 back
      -- when a lapsed window cost the seller the whole queue; holding the
      -- runners-up is what makes a short window affordable again.
      update public.cards
      set status = 'in_transaction', reserved_until = now() + interval '1 hour', updated_at = now()
      where id = v_card.id;
    end if;

    -- A partial acceptance carries its own deadline because it holds no card
    -- reservation to expire; a whole-listing one keeps using cards.reserved_until.
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
    into v_held
    from rivals;

    -- (2) Held, not rejected. `resolve_on_hold_offers` decides their fate once
    -- the winner's hour is settled either way.
    update public.offers
    set status = 'on_hold'
    where id in (select (item ->> 'id')::uuid from jsonb_array_elements(v_held) item);

    insert into public.notifications (user_id, type, title, message, card_id, offer_id, read)
    values (
      v_offer.buyer_id, 'offer_accepted', 'Offer accepted!',
      'The seller accepted your offer. You have one hour to complete payment.',
      v_card.id, v_offer.id, false
    );
    -- (3) Nobody has been turned down yet, so do not tell them they have been.
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

-- ─── Closing the offers that can no longer be paid ───────────────────────────
--
-- Carried forward from 20260906000100 with the money-in-flight guard and the
-- card_taken/deadline split intact. Two changes:
--
--   1. The penalty is a ledger row, not `UPDATE profiles SET legit_rate = ...`.
--   2. The "only dock a buyer who got a reminder" condition is gone. It was a
--      fair rule when the window was 24 hours and the reminder went out 4 hours
--      before the end. With a one-hour window the reminder cron — GitHub Actions,
--      every 30 minutes, `p_remind_before` of 4 hours — can never fire in time,
--      so keeping the condition would mean nobody is ever docked at all. The
--      buyer is told when the offer is accepted that they have one hour; that is
--      the warning now.
create or replace function public.expire_stale_chosen_offers()
returns table (
  offer_id uuid,
  buyer_id uuid,
  card_id uuid,
  card_name text,
  price bigint,
  deadline timestamp with time zone,
  reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_due jsonb := '[]'::jsonb;
  v_item jsonb;
begin
  with candidate as (
    select
      o.id, o.buyer_id, o.price, o.payment_deadline,
      o.bundle_selection,
      c.id as card_id, c.name as card_name, c.status as card_status,
      c.reserved_until, c.bundle_items,
      -- A partial offer is the one that carries its own deadline; a whole
      -- listing offer expresses its deadline as the card's reservation.
      (o.payment_deadline is not null) as is_partial
    from public.offers o
    join public.cards c on c.id = o.card_id
    where o.status = 'chosen'
      -- An offer with money in flight is never expired here.
      --
      -- Checkout writes the order before PayOS is paid, so a buyer sitting on
      -- the PayOS page is a `chosen` offer with a `pending_payment` order and a
      -- reservation still counting down. Expiring that offer and relisting its
      -- card leaves the payment link live: the webhook then arrives to finalise
      -- an offer that is no longer `chosen`, against a card another buyer may
      -- already own.
      --
      -- This matters more at one hour than it did at twenty-four. A buyer who
      -- opens the PayOS page at minute 50 and pays at minute 62 is inside a
      -- window this guard covers and the clock does not; the checkout route
      -- shortens the payment link's own expiry to stay inside the hour, so the
      -- pending order resolves rather than hanging here indefinitely.
      --
      -- A denylist, not an allowlist: a status added later counts as live until
      -- somebody decides otherwise, which is the safe direction to be wrong in.
      and not exists (
        select 1 from public.orders ord
        where ord.offer_id = o.id
          and ord.status not in ('cancelled', 'refunded')
      )
    for update of o, c skip locked
  ),
  judged as (
    select
      candidate.*,
      -- Nothing the buyer can do: the card, or their share of it, is gone.
      (
        card_status = 'sold'
        or (is_partial and not public.bundle_selection_available(bundle_items, bundle_selection))
      ) as card_taken,
      -- Their window ran out.
      (
        case
          when is_partial then payment_deadline < now()
          -- A whole-listing offer that no longer holds its card has lost the
          -- hold, whether the reservation lapsed under it or was released.
          else card_status <> 'in_transaction'
               or (reserved_until is not null and reserved_until < now())
        end
      ) as deadline_passed
    from candidate
  ),
  due as (
    select
      judged.*,
      case when card_taken then 'card_taken' else 'deadline' end as close_reason,
      -- Only a card still held by this offer goes back on the market. One that
      -- sold belongs to somebody else now.
      (card_status = 'in_transaction'
        and reserved_until is not null and reserved_until < now()) as needs_relist
    from judged
    where card_taken or deadline_passed
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
  told as (
    insert into public.notifications (user_id, type, title, message, card_id, offer_id, read)
    select
      due.buyer_id,
      case when due.close_reason = 'card_taken' then 'offer_card_taken' else 'offer_payment_expired' end,
      case when due.close_reason = 'card_taken' then 'Card no longer available' else 'Payment window closed' end,
      case when due.close_reason = 'card_taken'
        then 'Another buyer completed the purchase first, so this offer is closed. Your standing is unaffected.'
        else 'The one-hour payment window closed, so the card went back on the market and your standing was reduced.'
      end,
      due.card_id, due.id, false
    from due
    returning id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'offer_id', due.id,
    'buyer_id', due.buyer_id,
    'card_id', due.card_id,
    'card_name', due.card_name,
    'price', due.price,
    'deadline', coalesce(due.payment_deadline, due.reserved_until),
    'reason', due.close_reason
  )), '[]'::jsonb)
  into v_due
  from due;

  -- Outside the statement above on purpose: record_reputation_event writes a row
  -- and then recomputes the profile from it, which cannot see its own uncommitted
  -- work if called from inside the same CTE chain.
  --
  -- `card_taken` is skipped. Losing a race is not a broken promise, and the
  -- notification above says so.
  for v_item in select * from jsonb_array_elements(v_due) loop
    if v_item ->> 'reason' = 'deadline' then
      perform public.record_reputation_event(
        (v_item ->> 'buyer_id')::uuid, 'buyer', 'offer_unpaid',
        null, (v_item ->> 'offer_id')::uuid, (v_item ->> 'card_id')::uuid,
        'accepted offer went unpaid past its one-hour window');
    end if;
  end loop;

  return query
  select
    (x ->> 'offer_id')::uuid, (x ->> 'buyer_id')::uuid, (x ->> 'card_id')::uuid,
    x ->> 'card_name', (x ->> 'price')::bigint,
    (x ->> 'deadline')::timestamptz, x ->> 'reason'
  from jsonb_array_elements(v_due) x;
end;
$fn$;

revoke all on function public.expire_stale_chosen_offers() from public, anon, authenticated;
grant execute on function public.expire_stale_chosen_offers() to service_role;

-- ─── Deciding what happens to the held offers ────────────────────────────────
--
-- Runs after `expire_stale_chosen_offers` in the same sweep, so by the time it
-- looks, the winner's offer is either still `chosen` (they are paying, or their
-- money is in flight) or gone.
--
--   card sold            → expired. Someone bought it; there is nothing to wait
--                          for, and this is not the held buyer's fault, so no
--                          ledger row and no price floor.
--   bundle share gone    → expired, same reasoning, for the partial case where
--                          the card itself stays listed.
--   a `chosen` offer     → left alone. Somebody still holds the card.
--     still exists
--   otherwise            → pending. The card is back on the market and the
--                          seller can pick again.
create or replace function public.resolve_on_hold_offers()
returns table (
  offer_id uuid,
  buyer_id uuid,
  card_id uuid,
  outcome text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  return query
  with held as (
    select
      o.id, o.buyer_id, o.card_id, o.bundle_selection,
      c.status as card_status, c.bundle_items, c.name as card_name, c.seller_id,
      (o.bundle_selection is not null
        and jsonb_typeof(o.bundle_selection) = 'array'
        and jsonb_array_length(o.bundle_selection) > 0) as is_partial
    from public.offers o
    join public.cards c on c.id = o.card_id
    where o.status = 'on_hold'
    for update of o skip locked
  ),
  decided as (
    select
      held.*,
      case
        when held.card_status = 'sold' then 'expired'
        when held.is_partial
          and not public.bundle_selection_available(held.bundle_items, held.bundle_selection)
          then 'expired'
        when exists (
          select 1 from public.offers h
          where h.card_id = held.card_id and h.status = 'chosen'
        ) then null
        else 'pending'
      end as next_status
    from held
  ),
  moved as (
    update public.offers o
    set status = decided.next_status
    from decided
    where o.id = decided.id and decided.next_status is not null
    returning o.id
  ),
  buyer_told as (
    insert into public.notifications (user_id, type, title, message, card_id, offer_id, read)
    select
      decided.buyer_id,
      case when decided.next_status = 'pending' then 'offer_revived' else 'offer_card_taken' end,
      case when decided.next_status = 'pending' then 'Your offer is live again' else 'Card no longer available' end,
      case when decided.next_status = 'pending'
        then 'The other buyer did not complete payment, so this card is back on the market and your offer is waiting for the seller again.'
        else 'Another buyer completed the purchase first, so this offer is closed. Your standing is unaffected.'
      end,
      decided.card_id, decided.id, false
    from decided
    where decided.next_status is not null
    returning id
  ),
  -- One notification per card, not per revived offer: the seller wants "you can
  -- pick again", not three copies of it.
  seller_told as (
    insert into public.notifications (user_id, type, title, message, card_id, read)
    select
      decided.seller_id,
      'offer_queue_reopened',
      'Offers are waiting again',
      'The buyer did not complete payment for ' || decided.card_name || ', so it is back on the market and '
        || count(*)::text || ' offer(s) are waiting for you.',
      decided.card_id,
      false
    from decided
    where decided.next_status = 'pending'
    group by decided.seller_id, decided.card_id, decided.card_name
    returning id
  )
  select decided.id, decided.buyer_id, decided.card_id, decided.next_status
  from decided
  where decided.next_status is not null;
end;
$fn$;

revoke all on function public.resolve_on_hold_offers() from public, anon, authenticated;
grant execute on function public.resolve_on_hold_offers() to service_role;

-- ─── The offer gate ──────────────────────────────────────────────────────────
--
-- Both limits live in a trigger rather than in POST /api/offers, because
-- 20260609_create_offers_table_and_rls.sql grants INSERT on `offers` to
-- `authenticated` and the RLS policy only checks `auth.uid() = buyer_id`. A
-- check in the route handler is therefore advisory: PostgREST will happily
-- insert the row for anyone holding the anon key and a session.
--
-- Five attempts per card, counting every row this buyer has ever created for it
-- — rejected, expired, withdrawn alike. eBay counts the same way, and counting
-- only live offers would let a buyer grind a seller down indefinitely by
-- withdrawing and re-offering. An offer brought back from `on_hold` costs
-- nothing, because reviving it is an UPDATE and this trigger only sees INSERTs.
--
-- The reputation gate reads a count of recent incidents, not the score. A seller
-- with two hundred completed orders would otherwise have enough banked points to
-- absorb a dozen no-shows without ever tripping a threshold, while a new buyer
-- goes negative on their first. It also clears itself: nothing has to run to
-- lift the block, the old incident simply ages out of the ninety-day window.
create or replace function public.enforce_offer_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_attempts integer;
begin
  select count(*) into v_attempts
  from public.offers
  where card_id = new.card_id and buyer_id = new.buyer_id;

  if v_attempts >= 5 then
    raise exception 'offer_limit_reached';
  end if;

  if public.recent_incident_count(
       new.buyer_id, 90, array['offer_unpaid','buyer_cancelled']) >= 2 then
    raise exception 'offer_blocked_reputation';
  end if;

  return new;
end;
$fn$;

revoke all on function public.enforce_offer_limits() from public, anon, authenticated;

drop trigger if exists enforce_offer_limits on public.offers;
create trigger enforce_offer_limits
  before insert on public.offers
  for each row
  execute function public.enforce_offer_limits();

-- ─── The sweep ───────────────────────────────────────────────────────────────
--
-- Now runs both halves. Order matters: the held offers can only be decided once
-- the winner's offer has been settled.
--
-- Keeps `returns integer` from 20260906000100. `create or replace` cannot change
-- a function's return type (42P13), and dropping this one to widen it would mean
-- dropping a function the live pg_cron job points at. The count is still what it
-- was — offers closed — with the held offers resolved alongside them.
create or replace function public.cron_expire_stale_offers()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_closed integer;
begin
  -- pg_cron has no session, so auth.uid()/auth.role() are null inside the job.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select count(*) into v_closed from public.expire_stale_chosen_offers();
  perform public.resolve_on_hold_offers();
  return v_closed;
end;
$fn$;

revoke all on function public.cron_expire_stale_offers() from public, anon, authenticated, service_role;

create extension if not exists pg_cron;

select cron.unschedule('expire-stale-offers')
where exists (select 1 from cron.job where jobname = 'expire-stale-offers');

-- Every two minutes, not every ten. The deadline is the column, not the poll
-- interval, but at ten-minute granularity a one-hour hold could run to 1h10 —
-- ten minutes of a card sitting off the market for nothing, and ten minutes
-- before the seller learns their queue is live again.
select cron.schedule(
  'expire-stale-offers',
  '*/2 * * * *',
  $job$select public.cron_expire_stale_offers()$job$
);

-- Anything that accumulated while the window was still 24 hours.
select public.cron_expire_stale_offers();

notify pgrst, 'reload schema';
