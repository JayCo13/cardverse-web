-- Stop the checkout functions from requiring a district that cannot exist.
--
-- 20260906000300 removed the district level from addresses, but the requirement
-- lived in two places and only one of them was TypeScript. Both settlement
-- functions also check it:
--
--   or coalesce(trim(v_spec ->> 'to_district_name'), '') = ''
--     -> raise exception '..._marketplace_shipping_invalid'
--
-- So every checkout from an address saved with the two-level picker raised, and
-- `walletCheckoutError` has no branch for that string, so it fell through to its
-- default and the buyer got a 500 with "Unable to complete checkout". The
-- address was complete; there is simply no district to put in it any more.
--
-- The clause is cut out of the live definition rather than the whole body being
-- restated here, the same way 20260902000100 changed the reservation interval.
-- Restating 200 lines to delete one is how the other 199 drift. Every other
-- field in that check — name, phone, province, ward code, ward name, street
-- detail — still has to be there, and that is the whole of a Vietnamese address
-- now.

do $$
declare
  v_fn text;
  v_def text;
  v_new text;
  v_clause constant text := 'or coalesce(trim(v_spec ->> ''to_district_name''), '''') = ''''';
  v_changed int := 0;
begin
  for v_fn, v_def in
    select p.oid::regprocedure::text, pg_get_functiondef(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and position(v_clause in pg_get_functiondef(p.oid)) > 0
  loop
    v_new := replace(v_def, v_clause, '');
    execute v_new;
    v_changed := v_changed + 1;
    raise notice 'dropped the district requirement from %', v_fn;
  end loop;

  -- Loud, not silent. If the clause has already been reworded, this migration
  -- has not done what it says and checkout would keep failing on a 500 that
  -- looks like a server fault.
  if v_changed = 0 then
    raise exception 'no checkout function carried the to_district_name requirement; verify by hand before assuming it is fixed';
  end if;
end
$$;
