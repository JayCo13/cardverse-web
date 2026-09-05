-- Release escrow automatically once a carrier has confirmed delivery.
--
-- Auto-release was switched off in 20260728 for a good reason: nothing told the
-- platform whether a parcel had arrived, so paying out on a timer could pay a
-- seller for goods that were lost in transit. Every order therefore ended up in
-- an administrator's queue, and the buyer's "Item received" button was the only
-- way a seller got paid without one.
--
-- That reason is gone. A tracking service now confirms delivery, and
-- `apply_carrier_tracking_event` sets auto_complete_at to delivery + 72h, so the
-- timer finally measures what it was always supposed to: how long the buyer has
-- had the parcel in hand.
--
-- The split is the point. Delivery confirmed by a carrier and 72h of silence
-- pays the seller. No confirmation — a Viettel Post parcel, a carrier the
-- service cannot read, a 'NotFound' — still goes to an administrator, because
-- there the platform genuinely does not know whether anything arrived. Paying
-- out on a timer alone is exactly the mistake 20260728 corrected.
create or replace function public.complete_delivered_orders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_order record;
  v_done integer := 0;
begin
  perform public.assert_financial_mutations_enabled();

  if v_user_id is null and not v_is_service then
    raise exception 'unauthorized';
  end if;

  for v_order in
    select o.id, o.buyer_id, o.seller_id, o.card_id,
           (o.carrier_status = 'Delivered'
             or o.ghn_status = 'delivered'
             or o.status = 'delivered') as delivery_confirmed
    from public.orders o
    join public.marketplace_order_funding f on f.order_id = o.id
    where o.status in ('shipping', 'delivered')
      and o.auto_complete_at is not null
      and o.auto_complete_at < now()
      and o.buyer_confirmed_at is null
      and (v_is_service or o.seller_id = v_user_id)
      and f.verified_amount = o.total_paid
      and f.classification in ('native_verified_escrow', 'backfilled_verified_escrow')
    order by o.auto_complete_at, o.id
    for update of o skip locked
  loop
    if v_order.delivery_confirmed then
      -- One bad row must not stop the sweep; it stays for the next run.
      begin
        perform public.complete_verified_marketplace_order(v_order.id, v_order.buyer_id);
      exception when others then
        raise notice 'auto-release failed for %: %', v_order.id, sqlerrm;
        continue;
      end;
      -- complete_verified_marketplace_order stamps buyer_confirmed_at, so record
      -- separately that nobody actually pressed anything. A payout the buyer
      -- never confirmed should be legible as such afterwards.
      update public.orders
      set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'auto_released_at', now(),
            'auto_release_reason', 'carrier_confirmed_delivery'
          ),
          updated_at = now()
      where id = v_order.id;
      insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
      values
        (v_order.seller_id, 'order_completed', 'Đơn hàng đã hoàn tất',
         'Đơn đã giao và hết thời gian khiếu nại 72 giờ. Tiền đã được chuyển vào ví của bạn.',
         v_order.card_id, v_order.id, false),
        (v_order.buyer_id, 'order_completed', 'Đơn hàng đã hoàn tất',
         'Đã quá 72 giờ kể từ khi giao hàng nên đơn được hoàn tất và tiền chuyển cho người bán.',
         v_order.card_id, v_order.id, false);
    else
      update public.orders
      set status = 'disputed',
          dispute_reason = coalesce(
            dispute_reason,
            'Automatic review: delivery was never confirmed by a carrier; an administrator must verify it.'
          ),
          updated_at = now()
      where id = v_order.id and status in ('shipping', 'delivered');
      if not found then
        continue;
      end if;

      update public.marketplace_order_funding
      set classification = 'disputed_frozen', updated_at = now()
      where order_id = v_order.id;
      insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
      values
        (v_order.buyer_id, 'order_disputed', 'Đơn hàng đang được kiểm tra',
         'Không xác minh được đơn đã giao hay chưa nên đơn được chuyển cho quản trị viên. Tiền của bạn vẫn được giữ an toàn.',
         v_order.card_id, v_order.id, false),
        (v_order.seller_id, 'order_disputed', 'Đơn hàng đang được kiểm tra',
         'Đơn vị vận chuyển chưa xác nhận đã giao. Quản trị viên sẽ kiểm tra trước khi giải ngân.',
         v_order.card_id, v_order.id, false);
    end if;
    v_done := v_done + 1;
  end loop;

  return v_done;
end;
$$;

grant execute on function public.complete_delivered_orders() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
