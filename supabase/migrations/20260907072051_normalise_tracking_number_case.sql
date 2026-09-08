-- Make tracking-number matching case-insensitive, by storing one case.
--
-- 17TRACK echoes numbers back in upper case however they were registered, and
-- the webhook feeds that echo into `where tracking_number = trim(...)`. Every
-- number on the table today is upper case by luck — sellers pasted SPX codes,
-- which already are — so nothing has broken yet. A GHN number is mixed case
-- (the ship dialog's own placeholder reads `VD: LWtxxxxxxx`), so the first real
-- GHN parcel would be registered, delivered, pushed back as `LWTXXXXXXX`, and
-- missed. The RPC answers a miss with `ok: true` and reason `order_not_found`,
-- so there would be no log, no retry, and no delivery event: the order would
-- sit until it escalated to an admin.
--
-- Upper case is chosen because it is the case the service pushes, so the value
-- stored equals the value looked up without touching either side at match time.
-- That matters: orders_tracking_lookup_idx is a plain btree on the column, and
-- wrapping it in upper() at match time would stop the index being used.

-- 1. Existing rows. Eleven at the time of writing, all already upper case
--    except where a test typed otherwise — but the trigger below assumes this
--    has run, so it runs regardless.
update public.orders
set tracking_number = upper(regexp_replace(tracking_number, '\s', '', 'g'))
where tracking_number is not null
  and tracking_number <> upper(regexp_replace(tracking_number, '\s', '', 'g'));

-- 2. Every future write, whichever path makes it.
--
--    A trigger rather than an edit to perform_marketplace_order_action: that
--    function moves money, and normalising a string is not a reason to reopen
--    it. This also covers writes that never go through the ship route at all —
--    an admin correction, a backfill, a path written later.
create or replace function public.normalise_order_tracking_number()
returns trigger
language plpgsql
as $$
begin
  if new.tracking_number is not null then
    new.tracking_number := nullif(upper(regexp_replace(new.tracking_number, '\s', '', 'g')), '');
  end if;
  return new;
end;
$$;

drop trigger if exists orders_normalise_tracking_number on public.orders;
create trigger orders_normalise_tracking_number
  before insert or update of tracking_number on public.orders
  for each row
  execute function public.normalise_order_tracking_number();

-- 3. The lookup side. Normalising the parameter, never the column, so the
--    index still serves the match.
do $$
declare
  v_def text;
  v_old constant text := 'where tracking_number = trim(p_tracking_number)';
  v_new constant text := 'where tracking_number = upper(regexp_replace(p_tracking_number, ''\s'', '''', ''g''))';
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname = 'apply_carrier_tracking_event';

  if v_def is null then
    raise exception 'apply_carrier_tracking_event is missing';
  end if;

  if position(v_new in v_def) > 0 then
    raise notice 'lookup already normalised; leaving the function alone';
  elsif position(v_old in v_def) = 0 then
    raise exception 'lookup clause not found in apply_carrier_tracking_event';
  else
    execute replace(v_def, v_old, v_new);
  end if;
end
$$;

-- Nothing may be left that a pushed number cannot match.
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from public.orders
  where tracking_number is not null
    and tracking_number <> upper(regexp_replace(tracking_number, '\s', '', 'g'));
  if v_bad > 0 then
    raise exception '% tracking numbers are still not normalised', v_bad;
  end if;

  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'apply_carrier_tracking_event'
      and pg_get_functiondef(oid) like '%upper(regexp_replace(p_tracking_number%'
  ) then
    raise exception 'lookup normalisation was not applied';
  end if;
end
$$;
