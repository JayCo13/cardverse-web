-- File the carrier the seller actually booked, not the one checkout guessed.
--
-- The buyer no longer picks a carrier — they pay a fee and the seller chooses
-- when they book — so shipping_provider written at checkout is a leftover. The
-- webhook knows the truth: GoShip sends carrier_short_name with every event.
--
-- It matters beyond bookkeeping. getTrackingUrl builds the buyer's "track this"
-- link from shipping_provider, so a mismatch sends them to the wrong carrier's
-- site with a number it has never seen.
--
-- Applied by rewriting the live definition: the parameter is added and used,
-- and the four-argument signature dropped so the two cannot be ambiguous.
do $$
declare
  v_def text;
  v_old constant text := 'set carrier_status = p_status,';
  v_new constant text := 'set shipping_provider = coalesce(nullif(trim(coalesce(p_carrier_slug, '''')), ''''), shipping_provider),
      carrier_status = p_status,';
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc
  where pronamespace = 'public'::regnamespace and proname = 'apply_goship_event';

  if v_def is null then
    raise exception 'apply_goship_event is missing';
  end if;

  if position('p_carrier_slug' in v_def) > 0 then
    raise notice 'already carries the slug';
    return;
  end if;

  v_def := replace(v_def,
    'p_carrier_code text DEFAULT NULL',
    'p_carrier_code text DEFAULT NULL, p_carrier_slug text DEFAULT NULL');

  if position(v_old in v_def) = 0 then
    raise exception 'update clause not found in apply_goship_event';
  end if;

  execute replace(v_def, v_old, v_new);
end
$$;

drop function if exists public.apply_goship_event(text, text, text, text);

revoke all on function public.apply_goship_event(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_goship_event(text, text, text, text, text) to service_role;
