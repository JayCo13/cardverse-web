-- Supabase commonly installs pgcrypto in the extensions schema, while a
-- standalone PostgreSQL database may install it in public. Resolve the actual
-- extension schema so the security-definer checkout RPC can call digest().
do $$
declare
  v_pgcrypto_schema text;
begin
  select n.nspname
  into v_pgcrypto_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if v_pgcrypto_schema is null then
    raise exception 'pgcrypto_extension_not_installed';
  end if;

  execute format(
    'alter function public.stage_payos_marketplace_checkout(uuid,bigint,jsonb,uuid,timestamptz) set search_path = public, %I, pg_temp',
    v_pgcrypto_schema
  );
end;
$$;
