-- Fix: a card stuck in 'in_transaction' forever.
--
-- When a buyer picks "QR / PayOS" the buy route marks the card 'in_transaction'
-- so two people can't pay for it at once. The PayOS webhook releases it back to
-- 'active' on an explicit cancel — but if the buyer just closes the PayOS tab
-- and never pays, PayOS sends no webhook, so the card disappears from the
-- marketplace permanently and the seller is stuck.
--
-- Solution (Shopee/TikTok-style): a time-boxed reservation. The lock now carries
-- an expiry (reserved_until). A self-healing function frees any card whose
-- reservation has lapsed and cancels its dangling pending order, so the listing
-- comes back on its own.

alter table public.cards
  add column if not exists reserved_until timestamptz;

-- Releases every expired reservation and cancels the orders/payment_orders that
-- never got paid. SECURITY DEFINER so it can run from the browser (anon/auth)
-- when someone simply browses /buy, with no always-on cron required.
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

  -- 3. Put the cards back on the market.
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
