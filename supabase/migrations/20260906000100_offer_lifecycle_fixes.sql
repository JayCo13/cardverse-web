-- Run the accepted-offer lifecycle, and stop it punishing the wrong buyer.
--
-- Rewritten from 20260904000100, which is the live definition — its live-order
-- guards and its `coalesce(payment_deadline, reserved_until)` handling of
-- partial bundle offers are carried forward here unchanged. Three things are
-- new:
--
-- 1. Nothing ever ran it. The route at /api/cron/offer-payment-lifecycle
--    exists; no scheduler, HTTP or otherwise, was wired to it, so offers whose
--    card went elsewhere stayed `chosen` indefinitely, still showing the buyer
--    a "Pay now" button that 409s at checkout. Every open offer in the database
--    pointed at a card that had already sold. pg_cron now runs the expiry, and
--    a Netlify scheduled function posts the reminders.
--
-- 2. The penalty branch keyed on `payment_reminder_sent_at is not null` alone,
--    so it could not tell "this buyer ignored their deadline" from "this
--    buyer's card was bought by somebody else". The second is not the buyer's
--    doing and now costs them nothing; the two also read differently in the
--    notification, because "your payment window closed" is a lie when what
--    happened is that they lost a race.
--
-- 3. A partial bundle offer could only be closed by its own deadline. If the
--    items it named were sold out of the bundle first, the buyer kept a live
--    "Pay now" until that deadline even though checkout would reject the stale
--    selection. `bundle_selection_available` below closes it at once.
--
-- The card-reservation model itself is left alone: holding a whole listing
-- `in_transaction` for 24h is better than eBay, which leaves the listing live
-- and lets the first payer win. Only partial bundle offers race, because they
-- reserve nothing, and that race is now resolved honestly rather than silently.

-- ─── Is a partial selection still buyable? ───────────────────────────────────
--
-- `subtract_bundle_selection` answers this by raising `bundle_selection_invalid`,
-- which cannot be caught per-row inside the set-based statement below. Same
-- matching rule — value plus occurrence, so two identical cards in a bundle are
-- two distinct units — as a boolean.
create or replace function public.bundle_selection_available(
  p_items jsonb,
  p_selection jsonb
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_selection is null or jsonb_typeof(p_selection) <> 'array'
      or jsonb_array_length(p_selection) = 0 then false
    when p_items is null or jsonb_typeof(p_items) <> 'array' then false
    else (
      with current_items as (
        select value, row_number() over (partition by value order by ordinality) as occurrence
        from jsonb_array_elements(p_items) with ordinality
      ), selected_items as (
        select value, row_number() over (partition by value order by ordinality) as occurrence
        from jsonb_array_elements(p_selection) with ordinality
      )
      select count(*) = jsonb_array_length(p_selection)
      from selected_items s
      join current_items c using (value, occurrence)
    )
  end;
$$;

revoke all on function public.bundle_selection_available(jsonb, jsonb) from public, anon;
grant execute on function public.bundle_selection_available(jsonb, jsonb) to authenticated, service_role;

-- ─── Close the offers that can no longer be paid ─────────────────────────────
--
-- Split out of `run_offer_payment_lifecycle` so pg_cron can run the part that
-- must be right without touching the part that must send email. Letting pg_cron
-- call the whole thing would stamp `payment_reminder_sent_at` on offers whose
-- reminder nobody ever posted — the claim is consumed, the mail never arrives.
--
-- Returns what it closed so the HTTP route can still report it.
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
as $$
begin
  return query
  with candidate as (
    select
      o.id, o.buyer_id, o.price, o.payment_deadline, o.payment_reminder_sent_at,
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
      -- already own. `release_expired_card_reservations`
      -- (20260702_expire_orphan_chosen_offers.sql:61-65) guards the same way.
      --
      -- Carried from 20260904000100, which added it after the sweeper closed
      -- offers that had in fact been paid. Widened from `<> 'cancelled'` to
      -- also let a refunded order through: by then `settle_offer_on_order_close`
      -- has already settled the offer, so it will not be `chosen` here anyway.
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
  -- The penalty lands only where the buyer was warned AND the card was still
  -- theirs to buy. A reminder they never got is not a deadline they knowingly
  -- missed, and a card sold out from under them is not their doing at all.
  penalised as (
    update public.profiles p
    set legit_rate = greatest(0, coalesce(p.legit_rate, 100) - 5),
        cancelled_transactions = coalesce(p.cancelled_transactions, 0) + 1,
        updated_at = now()
    from due
    where p.id = due.buyer_id
      and due.close_reason = 'deadline'
      and due.payment_reminder_sent_at is not null
    returning p.id
  ),
  told as (
    insert into public.notifications (user_id, type, title, message, card_id, offer_id, read)
    select
      due.buyer_id,
      case when due.close_reason = 'card_taken' then 'offer_card_taken' else 'offer_payment_expired' end,
      case when due.close_reason = 'card_taken' then 'Card no longer available' else 'Payment window closed' end,
      case when due.close_reason = 'card_taken'
        then 'Another buyer completed the purchase first, so this offer is closed. Your standing is unaffected.'
        else 'The card was returned to the marketplace because the payment window closed.'
      end,
      due.card_id, due.id, false
    from due
    returning id
  )
  select
    due.id, due.buyer_id, due.card_id, due.card_name, due.price,
    coalesce(due.payment_deadline, due.reserved_until), due.close_reason
  from due;
end;
$$;

revoke all on function public.expire_stale_chosen_offers() from public, anon, authenticated;
grant execute on function public.expire_stale_chosen_offers() to service_role;

-- ─── One pass of the whole lifecycle (expiry + reminder claims) ──────────────
--
-- Kept for /api/cron/offer-payment-lifecycle, which posts the reminder mail.
-- The expiry half now delegates, so there is one implementation of it.
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
  select 'expired'::text, e.offer_id, e.buyer_id, e.card_id, e.card_name, e.price, e.deadline
  from public.expire_stale_chosen_offers() e;

  -- Unchanged from 20260904000100. An offer expresses its deadline in one of
  -- two places: a whole-listing offer counts down its card's reservation, a
  -- partial bundle offer carries its own `payment_deadline` and leaves the card
  -- active — hence the coalesce.
  return query
  update public.offers o
  set payment_reminder_sent_at = now()
  from public.cards c
  where c.id = o.card_id
    and o.status = 'chosen'
    and o.payment_reminder_sent_at is null
    -- Never chase a buyer who has already paid. Their offer sits at `chosen`
    -- for the moment between the order being written and the payment finaliser
    -- flipping it to `accepted`, and a reminder posted in that window tells
    -- somebody who just paid that their window is closing.
    and not exists (
      select 1 from public.orders ord
      where ord.offer_id = o.id
        and ord.status not in ('cancelled', 'refunded')
    )
    -- A whole-listing offer counts only while it still holds its card; a
    -- partial one holds nothing, so its own deadline is the whole story.
    and (o.payment_deadline is not null or c.status = 'in_transaction')
    and coalesce(o.payment_deadline, c.reserved_until) > now()
    and coalesce(o.payment_deadline, c.reserved_until) <= now() + p_remind_before
  returning 'remind'::text, o.id, o.buyer_id, c.id, c.name, o.price,
            coalesce(o.payment_deadline, c.reserved_until);
end;
$$;

revoke all on function public.run_offer_payment_lifecycle(interval) from public, anon, authenticated;
grant execute on function public.run_offer_payment_lifecycle(interval) to service_role;

-- ─── Schedule it ─────────────────────────────────────────────────────────────
--
-- Same shape as `cron_release_delivered_orders` (20260905000600): a wrapper the
-- scheduler owns, executable by nobody else.
create or replace function public.cron_expire_stale_offers()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_closed integer;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select count(*) into v_closed from public.expire_stale_chosen_offers();
  return v_closed;
end;
$$;

revoke execute on function public.cron_expire_stale_offers() from public, anon, authenticated, service_role;

-- Every ten minutes. The window it closes is 24h, so the interval only decides
-- how long a buyer keeps seeing a button that would fail; ten minutes is short
-- enough that the page's own card-availability check covers the rest.
select cron.unschedule('expire-stale-offers')
where exists (select 1 from cron.job where jobname = 'expire-stale-offers');

select cron.schedule(
  'expire-stale-offers',
  '*/10 * * * *',
  $job$select public.cron_expire_stale_offers()$job$
);

-- ─── Backlog ─────────────────────────────────────────────────────────────────
--
-- The offers that accumulated while nothing was running. Closed through the
-- same function so the notification and the no-penalty rule apply to them too.
select public.cron_expire_stale_offers();

NOTIFY pgrst, 'reload schema';
