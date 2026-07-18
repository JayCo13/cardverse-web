-- Let authenticated admin users receive withdrawal lifecycle changes so the
-- dashboard can refresh its badge and notification feed immediately.

drop policy if exists "Admins can view wallet withdrawals" on public.wallet_withdrawals;
create policy "Admins can view wallet withdrawals"
  on public.wallet_withdrawals
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'wallet_withdrawals'
  ) then
    alter publication supabase_realtime add table public.wallet_withdrawals;
  end if;
end $$;

notify pgrst, 'reload schema';
