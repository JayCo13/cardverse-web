-- Apply one GoShip status push to the order it belongs to.
--
-- A sibling of apply_carrier_tracking_event with the same guards, differing in
-- the one thing that matters: it finds its order by goship_code rather than by
-- tracking_number. GoShip issues that code, one per shipment, and a unique
-- index enforces it — where tracking_number is typed by a seller, can repeat,
-- and today has three orders sharing one value with two of them frozen.
--
-- It also files the carrier's own code as it arrives. A shipment has no carrier
-- code at status 900; it appears once the carrier accepts, and that is the
-- string a buyer pastes into spx.vn.
create or replace function public.apply_goship_event(
  p_goship_code text,
  p_status text,
  p_sub_status text default null,
  p_carrier_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  -- The carrier's code is filed even for an order past its journey: it is a
  -- fact about the parcel, not a decision about the order.
  if coalesce(trim(p_carrier_code), '') <> ''
     and coalesce(v_order.tracking_number, '') <> trim(p_carrier_code) then
    update public.orders
    set tracking_number = trim(p_carrier_code), updated_at = now()
    where id = v_order.id;
  end if;

  -- A settled order does not move again on a carrier's say-so.
  if v_order.status in ('completed', 'cancelled', 'refunded', 'disputed') then
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'terminal_order',
                              'order_id', v_order.id);
  end if;

  if v_order.carrier_status = p_status then
    return jsonb_build_object('ok', true, 'replayed', true, 'order_id', v_order.id);
  end if;

  -- 'Delivered' is a one-way door: it starts the release clock, and a later
  -- 'InTransit' on a delivered parcel is the service catching up on old events.
  if v_order.carrier_status = 'Delivered' and p_status <> 'Delivered' then
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'out_of_order',
                              'order_id', v_order.id);
  end if;

  update public.orders
  set carrier_status = p_status,
      carrier_sub_status = nullif(trim(coalesce(p_sub_status, '')), ''),
      carrier_status_at = now(),
      -- Shipping means the carrier has it, not that a waybill exists. GoShip
      -- reports 903 đã lấy hàng for that, which maps to InTransit here.
      status = case when p_status in ('InTransit', 'OutForDelivery') and status = 'paid'
        then 'shipping' else status end,
      updated_at = now()
  where id = v_order.id;

  -- Delivery opens the inspection window, once.
  if p_status = 'Delivered' and v_order.status in ('paid', 'shipping') then
    update public.orders
    set status = 'delivered',
        auto_complete_at = now() + interval '72 hours',
        updated_at = now()
    where id = v_order.id;
  end if;

  return jsonb_build_object('ok', true, 'status', p_status, 'order_id', v_order.id,
                            'from_status', v_order.carrier_status);
end;
$$;

revoke all on function public.apply_goship_event(text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_goship_event(text, text, text, text) to service_role;
