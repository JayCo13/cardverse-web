-- Platform withdrawal fee: 5% -> 8%.
--
-- Sales themselves stay free (orders.platform_fee is 0 and has always been);
-- the platform's only charge is taken when a seller moves money out of their
-- wallet, so this one rate is the whole fee change.
--
-- Two live functions compute it independently:
--
--   request_wallet_withdrawal_impl(bigint, uuid)  -- what the app reaches, via
--                                                    the (bigint, uuid) wrapper
--   request_wallet_withdrawal(uuid, bigint)       -- an older overload, granted
--                                                    to nobody but still here
--
-- The second is unreachable through PostgREST today, but it is a second copy of
-- the rate and would quietly charge the old one the moment anything grants or
-- calls it. Both move together.
--
-- Rewritten from each live definition rather than retyped, so the rate is the
-- only thing that changes and the bodies cannot drift from the migrations that
-- built them.
do $$
declare
  r        record;
  v_def    text;
  v_hits   int;
  v_done   int := 0;
  v_already int := 0;
begin
  for r in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and p.proname in ('request_wallet_withdrawal', 'request_wallet_withdrawal_impl')
    order by 1
  loop
    v_def := pg_get_functiondef(r.oid);

    if position('* 0.05)' in v_def) = 0 then
      -- Either already migrated, or a wrapper that delegates and holds no rate.
      if position('* 0.08)' in v_def) > 0 then
        v_already := v_already + 1;
      end if;
      continue;
    end if;

    -- Refuse to guess. If a function ever carries more than one 0.05 the extra
    -- one is not necessarily the fee, and a blind replace would change it too.
    select count(*) into v_hits
    from regexp_matches(v_def, '\* 0\.05\)', 'g');

    if v_hits <> 1 then
      raise exception 'expected exactly one fee rate in %, found %', r.sig, v_hits;
    end if;

    execute replace(v_def, '* 0.05)', '* 0.08)');
    v_done := v_done + 1;
    raise notice 'withdrawal fee 5%% -> 8%% in %', r.sig;
  end loop;

  if v_done = 0 and v_already = 0 then
    raise exception 'no withdrawal fee found to change';
  end if;
end
$$;

-- Nothing may still be charging 5%.
do $$
declare
  v_stale text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
  into v_stale
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prokind = 'f'
    and pg_get_functiondef(p.oid) like '%* 0.05)%';

  if v_stale is not null then
    raise exception 'these still compute a 5%% fee: %', v_stale;
  end if;
end
$$;
