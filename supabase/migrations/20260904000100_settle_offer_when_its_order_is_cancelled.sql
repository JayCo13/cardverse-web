-- Fix: a buyer whose seller never ships is pushed off their own agreed price.
--
-- Nothing ever tied an offer's fate to the order it produced. Accepting an offer
-- sets it 'chosen'; the buyer pays; `expire_verified_marketplace_order` then
-- cancels the unshipped order, refunds the buyer and relists the card — and
-- leaves the offer at 'chosen' forever.
--
-- Both sweepers read that stale row as "the buyer never paid", which is the
-- opposite of what happened:
--
--   * `run_offer_payment_lifecycle` sees status='chosen' on a card that is no
--     longer reserved, closes the offer as 'expired', tells the buyer "the
--     payment window closed" and — where a reminder had gone out — takes 5 off
--     their legit_rate. The buyer paid on time; the seller is the one at fault.
--   * `release_expired_card_reservations` step 3 looks for a live order carrying
--     *that offer id*. When the buyer later just buys the card outright, the new
--     order has offer_id = null, so the stale offer still looks orphaned and is
--     flipped to 'rejected'.
--
-- 'rejected' is the damaging one: POST /api/offers treats a rejected offer as a
-- price floor, so the buyer must now bid ABOVE the price the seller already
-- agreed to — and every retry at the agreed price fails with `must_offer_higher`.
-- That is the loop reported: offer accepted, seller never ships (x3), and the
-- card can no longer be offered on at any price the buyer considers fair.
--
-- The fix is to settle the offer when its order closes, and to stop both
-- sweepers from touching an offer that produced a real order.

-- ── 1. Settle the offer whenever its order closes ────────────────────────────
--
-- A trigger rather than an edit to `expire_verified_marketplace_order`, because
-- the same stale row is left behind by every cancellation path: the unshipped
-- sweeper, the buyer/seller cancel in `marketplace/orders` PATCH, and the admin
-- dispute refund. One rule covers all of them, including any added later.
create or replace function public.settle_offer_on_order_close()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.offer_id is not null
     and new.status in ('cancelled', 'refunded')
     and old.status is distinct from new.status then
    -- 'expired' rather than 'rejected': the seller did not turn this buyer
    -- down, so nothing here may become a floor under their next offer.
    update public.offers
    set status = 'expired'
    where id = new.offer_id
      and status in ('chosen', 'accepted');
  end if;
  return new;
end;
$$;

drop trigger if exists orders_settle_offer_on_close on public.orders;
create trigger orders_settle_offer_on_close
  after update of status on public.orders
  for each row
  execute function public.settle_offer_on_order_close();

revoke execute on function public.settle_offer_on_order_close() from public, anon, authenticated;

-- ── 2. The payment sweeper must ignore offers that were actually paid ────────
--
-- Rewritten from 20260903000100 with one added guard in `due` and the same one
-- on the reminder. Without it the sweeper fires within half an hour of a
-- successful offer payment: the card is 'sold', which is not 'in_transaction',
-- so a live paid offer matched the expiry condition — closing it, telling the
-- buyer their payment window lapsed, and docking their standing if the reminder
-- had already gone out.
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
      -- An offer that produced an order is not an unpaid one. A cancelled order
      -- is excluded because that offer is already settled by the trigger above.
      and not exists (
        select 1 from public.orders ord
        where ord.offer_id = o.id and ord.status <> 'cancelled'
      )
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
    -- Never chase a buyer who has already paid.
    and not exists (
      select 1 from public.orders ord
      where ord.offer_id = o.id and ord.status <> 'cancelled'
    )
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

-- ── 3. The reservation sweeper must not brand a paid offer 'rejected' ────────
--
-- Rewritten from 20260702 with one added condition in step 3. Its orphan test
-- only looked for a *live* order carrying that offer id, so an offer whose order
-- had been paid and then cancelled still qualified — and a funded offer is never
-- one the seller rejected.
create or replace function public.release_expired_card_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  released_count integer;
begin
  -- 1. Cancel the marketplace orders tied to expired reservations.
  update public.orders o
  set status = 'cancelled', updated_at = now()
  from public.cards c
  where o.card_id = c.id
    and o.status = 'pending_payment'
    and c.status = 'in_transaction'
    and c.reserved_until is not null
    and c.reserved_until < now();

  -- 2. Cancel the still-pending PayOS payment orders behind them.
  update public.payment_orders po
  set status = 'cancelled', updated_at = now()
  from public.orders o
  join public.cards c on c.id = o.card_id
  where po.id = o.payment_order_id
    and po.status = 'pending'
    and c.status = 'in_transaction'
    and c.reserved_until is not null
    and c.reserved_until < now();

  -- 3. Expire orphaned 'chosen' offers on those cards (no live order was ever
  --    paid for them) and tell the buyer. 'rejected' rather than a new status:
  --    the whole offer pipeline (offer-modal lock, re-offer validation, chat
  --    banner) already handles it.
  with expired_cards as (
    select id from public.cards
    where status = 'in_transaction'
      and reserved_until is not null
      and reserved_until < now()
  ),
  orphaned as (
    update public.offers ofr
    set status = 'rejected'
    where ofr.status = 'chosen'
      and ofr.card_id in (select id from expired_cards)
      and not exists (
        select 1 from public.orders o
        where o.offer_id = ofr.id
          and o.status in ('pending_payment', 'paid', 'shipping', 'delivered', 'completed')
      )
      -- Money once reached escrow for this offer, so whatever closed it, it was
      -- not the buyer failing to pay. Calling that 'rejected' would put a floor
      -- under their next offer for a sale the seller broke.
      and not exists (
        select 1
        from public.orders o
        join public.marketplace_order_funding f on f.order_id = o.id
        where o.offer_id = ofr.id
      )
    returning ofr.id, ofr.buyer_id, ofr.card_id
  )
  insert into public.notifications (user_id, type, title, message, card_id, offer_id, read)
  select
    buyer_id,
    'offer_expired',
    'Offer đã hết hạn giữ chỗ',
    'Bạn chưa thanh toán trong thời gian giữ thẻ nên offer không còn hiệu lực. Nếu thẻ vẫn còn bán, bạn có thể gửi offer mới.',
    card_id,
    id,
    false
  from orphaned;

  -- 4. Put the cards back on the market.
  with freed as (
    update public.cards
    set status = 'active', reserved_until = null, updated_at = now()
    where status = 'in_transaction'
      and reserved_until is not null
      and reserved_until < now()
    returning 1
  )
  select count(*) into released_count from freed;

  return released_count;
end;
$$;

grant execute on function public.release_expired_card_reservations() to anon, authenticated;

-- ── 4. Repair the rows the old behaviour already produced ────────────────────
--
-- Order matters here: the reputation repair reads `status = 'expired'` to mean
-- "the payment sweeper closed this one", which is only true BEFORE the status
-- repair below starts writing that same value for other reasons.

-- Give back the standing the payment sweeper took from buyers who had in fact
-- paid. Scoped to offers it actually closed ('expired') and actually penalised
-- (a reminder had been claimed) on an order that reached escrow — which is
-- exactly the set it docked, once per offer.
with wrongly_penalised as (
  select ofr.buyer_id, count(distinct ofr.id) as hits
  from public.offers ofr
  join public.orders o on o.offer_id = ofr.id and o.status = 'cancelled'
  join public.marketplace_order_funding f on f.order_id = o.id
  where ofr.status = 'expired'
    and ofr.payment_reminder_sent_at is not null
  group by ofr.buyer_id
)
update public.profiles p
set legit_rate = least(100, coalesce(p.legit_rate, 100) + (5 * w.hits)),
    cancelled_transactions = greatest(0, coalesce(p.cancelled_transactions, 0) - w.hits),
    updated_at = now()
from wrongly_penalised w
where p.id = w.buyer_id;

-- An offer that was funded and whose order was then cancelled: settle it the way
-- the trigger now would. 'rejected' is included deliberately — an offer the
-- seller rejected can never have been paid for, so every rejected row in this
-- set was mislabelled by the reservation sweeper, and each one is a floor
-- standing under a buyer's next offer right now.
with funded_and_cancelled as (
  select distinct o.offer_id
  from public.orders o
  join public.marketplace_order_funding f on f.order_id = o.id
  where o.offer_id is not null and o.status = 'cancelled'
)
update public.offers ofr
set status = 'expired'
from funded_and_cancelled fc
where ofr.id = fc.offer_id
  and ofr.status in ('chosen', 'accepted', 'rejected');

notify pgrst, 'reload schema';
