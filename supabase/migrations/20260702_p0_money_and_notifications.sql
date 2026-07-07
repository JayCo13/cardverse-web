-- P0 money-path hardening (audit 2026-07-02):
--
-- 1) credit_wallet(): every server-side wallet credit (seller payout on
--    confirm_received, buyer refund on cancel) previously did a non-atomic
--    read-modify-write in the route handler, so two concurrent requests
--    (double-click, retry, or manual-confirm racing the 72h auto-release)
--    could credit twice. This RPC makes credit + ledger one atomic statement,
--    mirroring the pattern already used by complete_delivered_orders().
--
-- 2) RLS on notifications: the table shipped without RLS, so any
--    authenticated user could read everyone's notifications (message
--    previews, offer prices) and insert spoofed ones. Rows are now readable/
--    markable-read by their owner only; INSERTs happen exclusively through
--    the service-role client in API routes (no INSERT policy on purpose).

-- ---------------------------------------------------------------------------
-- 1) Atomic wallet credit
-- ---------------------------------------------------------------------------
create or replace function public.credit_wallet(
  p_user_id uuid,
  p_amount bigint,
  p_type text,
  p_description text,
  p_reference_id text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet_id uuid;
  v_new_balance bigint;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'credit_wallet: amount must be positive, got %', p_amount;
  end if;

  insert into public.wallets (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  update public.wallets
  set available_balance = available_balance + p_amount,
      updated_at = now()
  where user_id = p_user_id
  returning id, available_balance into v_wallet_id, v_new_balance;

  insert into public.wallet_transactions
    (wallet_id, user_id, type, amount, balance_after, description, reference_id)
  values
    (v_wallet_id, p_user_id, p_type, p_amount, v_new_balance, p_description, p_reference_id);

  return v_new_balance;
end;
$$;

-- Service-role only: a client-callable credit function would let any user
-- print money into their own wallet. (Functions default to EXECUTE for
-- PUBLIC, so the revoke is required, not cosmetic.)
revoke execute on function public.credit_wallet(uuid, bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.credit_wallet(uuid, bigint, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2) Row-level security for notifications
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists "Users can view own notifications" on public.notifications;
create policy "Users can view own notifications"
  on public.notifications
  for select
  using (auth.uid() = user_id);

-- Owners may only mark their notifications read; user_id can't be repointed.
drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users can update own notifications"
  on public.notifications
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Deliberately NO insert/delete policy for anon/authenticated: notifications
-- are created only by API routes through the service-role client (which
-- bypasses RLS). Client-session inserts now fail — routes were migrated in
-- the same change set.

notify pgrst, 'reload schema';
