-- Auto-release escrow: pay the seller when the buyer goes silent.
--
-- Problem: after GHN delivers, the buyer has a confirmation window. The 'ship'
-- action sets orders.auto_complete_at, but NOTHING ever acted on it — if the
-- buyer never clicks "Đã nhận hàng", the seller is never paid and escrow is
-- held forever.
--
-- Solution (same self-healing pattern as release_expired_card_reservations):
-- a SECURITY DEFINER function that completes every 'delivered' order whose
-- 72h dispute window has lapsed and credits the seller's wallet. Called
-- opportunistically from /api/marketplace/orders GET and /api/wallet GET —
-- a seller checking their orders or balance triggers their own payout.
--
-- Fee model (owner decision 2026-06-11): the seller is credited the FULL sale
-- amount. The 5% platform fee is charged ONCE, at withdrawal
-- (src/app/api/wallet/withdraw/route.ts). orders.platform_fee is legacy.
--
-- buyer_confirmed_at stays NULL on auto-completed orders, distinguishing them
-- from manual confirmations.

create index if not exists idx_orders_delivered_auto_complete
  on public.orders(auto_complete_at)
  where status = 'delivered';

create or replace function public.complete_delivered_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  v_wallet_id uuid;
  v_new_balance bigint;
  done integer := 0;
begin
  for o in
    select id, seller_id, card_id, amount
    from public.orders
    where status = 'delivered'
      and auto_complete_at is not null
      and auto_complete_at < now()
    for update skip locked        -- concurrency-safe across parallel callers
  loop
    -- Status guard makes each order idempotent even if re-entered.
    update public.orders
    set status = 'completed', updated_at = now()
    where id = o.id and status = 'delivered';
    if not found then
      continue;
    end if;

    -- Credit the seller the full amount (fee is taken at withdrawal).
    insert into public.wallets (user_id)
    values (o.seller_id)
    on conflict (user_id) do nothing;

    update public.wallets
    set available_balance = available_balance + o.amount,
        updated_at = now()
    where user_id = o.seller_id
    returning id, available_balance into v_wallet_id, v_new_balance;

    insert into public.wallet_transactions
      (wallet_id, user_id, type, amount, balance_after, description, reference_id)
    values
      (v_wallet_id, o.seller_id, 'marketplace_sale', o.amount, v_new_balance,
       'Bán thẻ - Đơn #' || left(o.id::text, 8) || ' (tự động hoàn tất sau 72h)',
       o.id::text);

    insert into public.notifications (user_id, type, title, message, card_id, read)
    values
      (o.seller_id, 'order_completed', 'Đơn hàng hoàn tất!',
       'Đơn hàng đã tự động hoàn tất sau 72 giờ kể từ khi giao thành công. '
         || o.amount || 'đ đã được cộng vào ví của bạn.',
       o.card_id, false);

    done := done + 1;
  end loop;

  return done;
end;
$$;

grant execute on function public.complete_delivered_orders() to anon, authenticated;

notify pgrst, 'reload schema';
