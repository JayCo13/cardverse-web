-- Refuse events from the account that did not book the shipment.
--
-- The webhook route decides the sender from the secret on its URL, never from
-- the body, and passes it here. An order that recorded its environment answers
-- only to that one. An order from before the column existed recorded nothing
-- and still answers to anything, which is what keeps live orders booked
-- earlier working.

drop function if exists public.apply_goship_event(text, text, text, text, text, text);

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

  -- Wrong account. Both issue codes of the same shape, so this is the only
  -- thing standing between a sandbox rehearsal and a real order's money.
  if v_order.goship_env is not null
     and coalesce(trim(p_env), '') <> ''
     and v_order.goship_env <> trim(p_env) then
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'env_mismatch',
                              'order_id', v_order.id, 'booked_in', v_order.goship_env);
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

grant execute on function public.apply_goship_event(text, text, text, text, text, text, text) to service_role;

-- Called, not merely created: plpgsql bodies are not checked until they run,
-- and a typo here would first surface on a live webhook.
do $$
declare v jsonb;
begin
  v := public.apply_goship_event('GS-does-not-exist', 'InTransit', null, null, null, null, 'sandbox');
  if v ->> 'reason' <> 'order_not_found' then
    raise exception 'self-test failed: %', v;
  end if;
end
$$;
