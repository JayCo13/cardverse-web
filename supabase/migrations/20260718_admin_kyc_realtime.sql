-- Allow authenticated admin-dashboard users to receive KYC lifecycle changes.
-- Regular users retain access only to their own verification row.

drop policy if exists "Admins can view seller verifications" on public.seller_verifications;
create policy "Admins can view seller verifications"
  on public.seller_verifications
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
      and tablename = 'seller_verifications'
  ) then
    alter publication supabase_realtime add table public.seller_verifications;
  end if;
end $$;

notify pgrst, 'reload schema';
