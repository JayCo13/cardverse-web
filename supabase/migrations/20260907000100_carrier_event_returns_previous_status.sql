-- Tell the caller what the parcel's status was before this event.
--
-- The webhook route now emails the buyer when a parcel starts moving, and
-- "starts moving" is a transition, not a state: 17TRACK reports both InTransit
-- and OutForDelivery, and a buyer who gets one mail for each has been told the
-- same thing twice. Only the caller can tell the difference, and only if it
-- knows where the parcel came from.
--
-- Purely additive — an existing key is untouched and the early returns
-- (order_not_found, terminal_order, replayed, out_of_order) keep their shape,
-- so nothing that reads this result today can break.
--
-- Rewritten from the live definition rather than retyped, so the returned
-- object is the only thing that changes.
do $$
declare
  v_def text;
  v_old constant text := $t$return jsonb_build_object('ok', true, 'status', p_status, 'order_id', v_order.id);$t$;
  v_new constant text := $t$return jsonb_build_object('ok', true, 'status', p_status, 'order_id', v_order.id, 'from_status', v_order.carrier_status);$t$;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname = 'apply_carrier_tracking_event';

  if v_def is null then
    raise exception 'apply_carrier_tracking_event is missing';
  end if;

  if position('''from_status''' in v_def) > 0 then
    raise notice 'from_status already returned; leaving the function alone';
  elsif position(v_old in v_def) = 0 then
    -- The success return is not where this migration expects it. Guessing at a
    -- money path is worse than stopping.
    raise exception 'success return not found in apply_carrier_tracking_event';
  else
    execute replace(v_def, v_old, v_new);
  end if;
end
$$;

-- v_order is read before the update, so from_status is genuinely the previous
-- value and not the one just written.
do $$
begin
  if (select position('''from_status''' in pg_get_functiondef(oid)) = 0
      from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname = 'apply_carrier_tracking_event') then
    raise exception 'from_status was not applied';
  end if;
end
$$;
