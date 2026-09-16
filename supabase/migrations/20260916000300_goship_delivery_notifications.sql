-- Notify both parties when GoShip first confirms delivery.
--
-- The previous GoShip RPC moved the order to `delivered` and started the 72h
-- inspection window, but unlike the retired tracking RPC it did not create the
-- in-app shipping notifications. Keep the notification writes in the same
-- transaction as the state transition so a successful webhook cannot leave a
-- delivered order with no bell, and webhook replays cannot duplicate them.

create or replace function public.apply_goship_event(
  p_goship_code text,
  p_status text,
  p_sub_status text default null,
  p_carrier_code text default null,
  p_carrier_slug text default null,
  p_tracking_url text default null,
  p_env text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
begin
  if coalesce(trim(p_goship_code), '') = '' or coalesce(trim(p_status), '') = '' then
    raise exception 'invalid_goship_event';
  end if;

  select * into v_order
  from public.orders
  where goship_code = trim(p_goship_code)
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'order_not_found');
  end if;

  if v_order.goship_env is not null
     and coalesce(trim(p_env), '') <> ''
     and v_order.goship_env <> trim(p_env) then
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'env_mismatch',
                              'order_id', v_order.id, 'booked_in', v_order.goship_env);
  end if;

  if coalesce(trim(p_carrier_code), '') <> ''
     and coalesce(v_order.tracking_number, '') <> trim(p_carrier_code) then
    update public.orders
    set tracking_number = trim(p_carrier_code), updated_at = now()
    where id = v_order.id;
  end if;

  if v_order.status in ('completed', 'cancelled', 'refunded', 'disputed') then
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'terminal_order',
                              'order_id', v_order.id);
  end if;

  if v_order.carrier_status = p_status then
    return jsonb_build_object('ok', true, 'replayed', true, 'order_id', v_order.id);
  end if;

  if v_order.carrier_status = 'Delivered' and p_status <> 'Delivered' then
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'out_of_order',
                              'order_id', v_order.id);
  end if;

  update public.orders
  set shipping_provider = coalesce(nullif(trim(coalesce(p_carrier_slug, '')), ''), shipping_provider),
      carrier_tracking_url = coalesce(nullif(trim(coalesce(p_tracking_url, '')), ''), carrier_tracking_url),
      carrier_status = p_status,
      carrier_sub_status = nullif(trim(coalesce(p_sub_status, '')), ''),
      carrier_status_at = now(),
      status = case when p_status in ('InTransit', 'OutForDelivery') and status = 'paid'
        then 'shipping' else status end,
      updated_at = now()
  where id = v_order.id;

  if p_status = 'Delivered' and v_order.status in ('paid', 'shipping') then
    update public.orders
    set status = 'delivered',
        auto_complete_at = now() + interval '72 hours',
        updated_at = now()
    where id = v_order.id;

    insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
    values
      (v_order.buyer_id, 'shipping_update', 'Đơn hàng đã giao thành công',
       'Kiểm tra hàng và xác nhận đã nhận, hoặc báo cáo nếu có vấn đề trong vòng 72 giờ.',
       v_order.card_id, v_order.id, false),
      (v_order.seller_id, 'shipping_update', 'Đơn hàng đã giao thành công',
       'Đơn đã giao tới người mua. Đang chờ xác nhận nhận hàng hoặc hết thời hạn 72 giờ.',
       v_order.card_id, v_order.id, false);
  end if;

  return jsonb_build_object('ok', true, 'status', p_status, 'order_id', v_order.id,
                            'from_status', v_order.carrier_status);
end;
$function$;

revoke all on function public.apply_goship_event(text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_goship_event(text, text, text, text, text, text, text)
  to service_role;

-- Force PL/pgSQL to compile the replacement during migration deployment.
do $$
declare v jsonb;
begin
  v := public.apply_goship_event('GS-does-not-exist', 'InTransit', null, null, null, null, 'sandbox');
  if v ->> 'reason' <> 'order_not_found' then
    raise exception 'self-test failed: %', v;
  end if;
end
$$;
