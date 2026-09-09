-- Store the tracking link GoShip sends, instead of guessing one.
--
-- The webhook already carried `tracking_url`; the function had nowhere to put
-- it, so the interface built a link out of the carrier and the code we had.
-- That produced spx.vn/track?GSLJKBAGZ6 — GoShip's own identifier handed to a
-- carrier that has never seen it — and a 404 for the buyer. GoShip's public
-- tracker does not resolve it either: asked about that shipment directly, the
-- API answers carrier_code null, tracking_url null. At status 900 the parcel
-- has not been accepted by anyone, so no link exists to be found.
--
-- The value is only ever filled in, never cleared: a later event that omits it
-- is a status update, not a retraction of a link that already worked.

drop function if exists public.apply_goship_event(text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.apply_goship_event(p_goship_code text, p_status text, p_sub_status text DEFAULT NULL::text, p_carrier_code text DEFAULT NULL::text, p_carrier_slug text DEFAULT NULL::text, p_tracking_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  set shipping_provider = coalesce(nullif(trim(coalesce(p_carrier_slug, '')), ''), shipping_provider),
      carrier_tracking_url = coalesce(nullif(trim(coalesce(p_tracking_url, '')), ''), carrier_tracking_url),
      carrier_status = p_status,
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
$function$;

grant execute on function public.apply_goship_event(text, text, text, text, text, text) to service_role;
