-- Two correctness holes in the offer lifecycle: a limit that two requests can
-- walk past together, and a held bundle offer that nothing ever releases.

-- ─── 1. Serialise the five-attempt check ─────────────────────────────────────
--
-- `enforce_offer_limits` counts prior offers and then lets the INSERT proceed.
-- Under READ COMMITTED neither of two concurrent inserts sees the other's
-- uncommitted row, so a buyer sitting on four attempts can fire two requests at
-- once, both count four, both pass, and end up with six offers on a card that
-- allows five. No constraint covers it either — "at most five rows" is not
-- something a unique index can say.
--
-- This matters more than the number suggests. Since 20260909000600 removed the
-- automatic offer ban, the per-card attempt limit is the only hard stop left in
-- the system: it is what caps how many times one account can win an offer, let
-- the hour lapse, and take the seller's card off the market again.
--
-- The lock is per buyer and card, taken before the count, released at commit —
-- the same pg_advisory_xact_lock idiom perform_offer_action already uses for
-- its idempotency ledger. Two buyers on the same card, or one buyer on two
-- cards, never contend.
create or replace function public.enforce_offer_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_attempts integer;
  v_threshold smallint;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(new.buyer_id::text || ':' || new.card_id::text, 0));

  select count(*) into v_attempts
  from public.offers
  where card_id = new.card_id and buyer_id = new.buyer_id;

  if v_attempts >= 5 then
    raise exception 'offer_limit_reached';
  end if;

  select p.offer_block_incidents into v_threshold
  from public.cards c
  join public.profiles p on p.id = c.seller_id
  where c.id = new.card_id;

  if v_threshold is not null
     and public.recent_incident_count(
           new.buyer_id, 90, array['offer_unpaid','buyer_fraud']) >= v_threshold then
    raise exception 'offer_blocked_by_seller';
  end if;

  return new;
end;
$fn$;

revoke all on function public.enforce_offer_limits() from public, anon, authenticated;

-- ─── 2. Release a held bundle offer nothing is actually blocking ─────────────
--
-- `perform_offer_action` is careful about which rivals it holds on a partial
-- bundle: it compares the two selections and only holds an offer that names at
-- least one of the cards being taken (20260909000200:113-123). The release side
-- forgot that. It asks only whether *any* `chosen` offer exists on the listing,
-- so an offer held against a winner that has since expired stays held while an
-- unrelated buyer checks out completely different cards from the same bundle —
-- and stays held for as long as that unrelated payment is in flight.
--
-- Same overlap test as the hold side, read in the other direction. A held offer
-- that named no selection is an offer on the whole listing and any chosen offer
-- blocks it; a chosen offer that named no selection takes the whole listing and
-- blocks everything.
--
-- Everything else is carried forward from 20260909000200 unchanged.
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
            and (
              -- A held offer on the whole listing is blocked by anything.
              not held.is_partial
              -- A chosen offer on the whole listing blocks everything.
              or h.bundle_selection is null
              or jsonb_typeof(h.bundle_selection) <> 'array'
              -- Otherwise only a genuine overlap blocks it.
              or exists (
                select 1
                from jsonb_array_elements(held.bundle_selection) held_item
                join jsonb_array_elements(h.bundle_selection) chosen_item
                  on held_item.value = chosen_item.value
              )
            )
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

notify pgrst, 'reload schema';
