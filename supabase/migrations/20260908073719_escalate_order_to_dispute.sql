-- Send an order to admin review now, rather than when its clock runs out.
--
-- complete_delivered_orders already escalates, but only once auto_complete_at
-- has passed — days away. Some carrier events do not need that wait: a parcel
-- reported lost, or already back with the seller, is not going to become
-- delivered while the timer finishes. Waiting only delays the person who has to
-- resolve it.
--
-- Deliberately its own function rather than a branch inside
-- apply_carrier_tracking_event. That one records carrier events and works; this
-- one moves an order onto a money path. Keeping them apart means a change to
-- escalation policy never has to reopen the function that decides delivery.
--
-- Which events qualify is decided by the caller, not here. The condition is a
-- GoShip status code — 908 chuyển hoàn, 917 thất lạc hàng, 1000 đơn lỗi — and
-- this function has no business knowing one carrier integration's vocabulary.
create or replace function public.escalate_order_to_dispute(
  p_order_id uuid,
  p_reason text,
  p_buyer_message text,
  p_seller_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_order_id is null or coalesce(trim(p_reason), '') = '' then
    raise exception 'invalid_escalation_request';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'order_not_found');
  end if;

  -- Only an order still in flight can be escalated. Completed, refunded or
  -- already-disputed orders are left exactly as they are: this runs off carrier
  -- events, which arrive more than once and out of order.
  update public.orders
  set status = 'disputed',
      dispute_reason = coalesce(dispute_reason, p_reason),
      updated_at = now()
  where id = v_order.id and status in ('shipping', 'delivered');

  if not found then
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'not_escalatable');
  end if;

  -- Freeze the money the same way the timed path does, so an order escalated
  -- early and one escalated late look identical to whoever reviews them.
  update public.marketplace_order_funding
  set classification = 'disputed_frozen', updated_at = now()
  where order_id = v_order.id;

  insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
  values
    (v_order.buyer_id, 'order_disputed', 'Đơn hàng đang được kiểm tra',
     p_buyer_message, v_order.card_id, v_order.id, false),
    (v_order.seller_id, 'order_disputed', 'Đơn hàng đang được kiểm tra',
     p_seller_message, v_order.card_id, v_order.id, false);

  return jsonb_build_object('ok', true, 'escalated', true, 'order_id', v_order.id);
end;
$$;

-- Carrier events reach the database on the service role and nothing else should
-- be able to move an order onto a dispute by calling this directly.
revoke all on function public.escalate_order_to_dispute(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.escalate_order_to_dispute(uuid, text, text, text) to service_role;
