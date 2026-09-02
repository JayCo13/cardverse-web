-- Give an accepted offer a real payment window, and something that enforces it.
--
-- Accepting an offer already reserved the card and rejected the rival offers,
-- but the buyer's only route to paying was a button inside the chat drawer: the
-- card leaves the marketplace and appears in no cart and no order list, so a
-- buyer who closed the chat had nowhere to go.
--
-- Nothing enforced the deadline either. `release_expired_card_reservations` is
-- called opportunistically from three page loads, so a reservation only lapses
-- if somebody happens to visit — and when it does lapse it frees the card while
-- leaving the offer at `chosen`. Seven offers were already in that state: the
-- buyer still saw "your offer was accepted, pay now" while the card was back on
-- sale and could be bought by somebody else.

-- An unpaid accepted offer is not a rejection. Saying `rejected` would tell the
-- buyer the seller turned them down, which is the opposite of what happened.
alter table public.offers drop constraint if exists offers_status_check;
alter table public.offers add constraint offers_status_check
  check (status = any (array['pending','accepted','rejected','chosen','expired']));

-- Claimed the way the KYC alerts are, so overlapping runs send one reminder.
alter table public.offers
  add column if not exists payment_reminder_sent_at timestamp with time zone;

create index if not exists offers_awaiting_payment_idx
  on public.offers (status, payment_reminder_sent_at)
  where status = 'chosen';

-- Two hours is not a payment window for a marketplace whose buyers are asleep
-- for eight of them. Rewritten from the live definition rather than retyped, so
-- only the interval changes.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc
  where pronamespace = 'public'::regnamespace and proname = 'perform_offer_action';

  if v_def is null then
    raise exception 'perform_offer_action is missing';
  end if;

  if position('interval ''2 hours''' in v_def) = 0 then
    raise notice 'reservation interval already changed; leaving the function alone';
  else
    execute replace(v_def, 'interval ''2 hours''', 'interval ''24 hours''');
  end if;
end
$$;

-- One pass of the accepted-offer payment lifecycle.
--
-- Returns the offers needing a reminder, having claimed them, and closes the
-- ones whose window is over. Safe to call as often as the scheduler likes.
--
-- The expiry condition is "this offer no longer holds its card" rather than
-- "the deadline passed", because the opportunistic release almost always frees
-- the card first — the same test therefore covers both.
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
           o.price, c.reserved_until, o.payment_reminder_sent_at,
           (c.status = 'in_transaction' and c.reserved_until < now()) as needs_relist
    from public.offers o
    join public.cards c on c.id = o.card_id
    where o.status = 'chosen'
      and (
        (c.status = 'in_transaction' and c.reserved_until is not null and c.reserved_until < now())
        or c.status <> 'in_transaction'
      )
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
  -- The penalty lands only where the buyer was warned. A reminder they never
  -- got is not a deadline they knowingly missed — and it keeps the backlog of
  -- offers that predate this feature from costing anyone their standing.
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
    and c.status = 'in_transaction'
    and o.payment_reminder_sent_at is null
    and c.reserved_until is not null
    and c.reserved_until > now()
    and c.reserved_until <= now() + p_remind_before
  returning 'remind'::text, o.id, o.buyer_id, c.id, c.name, o.price, c.reserved_until;
end;
$$;

revoke all on function public.run_offer_payment_lifecycle(interval) from public, anon, authenticated;
grant execute on function public.run_offer_payment_lifecycle(interval) to service_role;
