-- Seller withdrawal requests. There is no automated payout gateway (PayOS only
-- takes money in), so a "withdraw" is a request: the wallet is debited up front
-- and an admin (cardverse-ad) does the real bank transfer + marks it completed.
--
-- The bank destination is a snapshot of the seller's KYC-verified bank account
-- (from seller_verifications) captured at request time, so a withdrawal can only
-- ever go to the account the seller registered during KYC.
--
-- Inserts/updates are performed by the service-role client (the withdraw route
-- and the admin panel); regular users may only SELECT their own rows. This stops
-- anyone from inserting a payout request via PostgREST without the wallet debit.

create table if not exists public.wallet_withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount_requested bigint not null,
  fee bigint not null,
  amount_net bigint not null,
  bank_name text not null,
  bank_account_number text not null,
  bank_account_name text not null,
  status text not null default 'pending'
    check (status = any (array['pending'::text, 'processing'::text, 'completed'::text, 'rejected'::text])),
  rejection_reason text,
  created_at timestamptz default now(),
  processed_at timestamptz
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wallet_withdrawals_user_id_fkey'
  ) and to_regclass('public.profiles') is not null then
    alter table public.wallet_withdrawals
      add constraint wallet_withdrawals_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end$$;

create index if not exists wallet_withdrawals_user_idx on public.wallet_withdrawals(user_id);
create index if not exists wallet_withdrawals_status_idx on public.wallet_withdrawals(status);

alter table public.wallet_withdrawals enable row level security;

-- Let authenticated users read (their own) rows; writes go through service role.
grant select on table public.wallet_withdrawals to authenticated;

drop policy if exists "Users can view their own withdrawals" on public.wallet_withdrawals;
create policy "Users can view their own withdrawals"
  on public.wallet_withdrawals for select
  to authenticated
  using (auth.uid() = user_id);

notify pgrst, 'reload schema';
