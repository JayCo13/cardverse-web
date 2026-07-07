-- Fix: an accepted ('chosen') offer whose buyer never pays becomes a permanent
-- dead-end.
--
-- Accepting an offer holds the card 'in_transaction' for 2h. When the buyer
-- doesn't pay, release_expired_card_reservations() frees the CARD but left the
-- OFFER 'chosen' forever, so:
--   1. the buyer keeps seeing "Pay now" in chat (which now 409s), and
--   2. offer-modal / offers POST both treat 'chosen' as "already accepted",
--      blocking that buyer from ever offering on the card again.
--
-- This redefinition adds one step: any 'chosen' offer on an expiring
-- reservation that never produced a live order is reverted to 'rejected'
-- (re-offer rules already handle 'rejected'), and the buyer is notified.
-- Runs before the cards are freed so the expiring set is still identifiable.

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

notify pgrst, 'reload schema';
