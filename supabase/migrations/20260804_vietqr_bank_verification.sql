-- Bank account verification via VietQR / NAPAS.
--
-- The bank leg of KYC used to rest on an uploaded screenshot of a banking app,
-- which is the easiest artefact in the whole flow to forge. We now ask NAPAS
-- who owns the account number and compare that against the identity the KYC
-- provider verified, so the payout destination is attested rather than typed.

alter table public.seller_verifications
  -- 6-digit NAPAS bank identification number; `bank_name` stays for display.
  add column if not exists bank_bin text,
  -- Account holder exactly as the banking network returned it.
  add column if not exists bank_account_name_verified text,
  add column if not exists bank_verified_at timestamp with time zone;

-- Lookup log. Serves three purposes: a per-user rate limit that survives
-- serverless cold starts, a short-lived cache so repeated submissions of the
-- same account do not burn quota, and an audit trail for payout disputes.
create table if not exists public.bank_account_lookups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bin text not null,
  account_number text not null,
  -- 'ok' | 'not_found' | 'unavailable'
  status text not null,
  account_name text,
  provider_code text,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_bank_account_lookups_user
  on public.bank_account_lookups (user_id, created_at desc);
create index if not exists idx_bank_account_lookups_account
  on public.bank_account_lookups (bin, account_number, created_at desc);

alter table public.bank_account_lookups enable row level security;

-- Server-only, like kyc_sessions: the result is a trust input, so the client
-- must never be able to write or read it directly.
revoke all on public.bank_account_lookups from anon, authenticated;

drop policy if exists "Admins can view bank lookups" on public.bank_account_lookups;
create policy "Admins can view bank lookups"
  on public.bank_account_lookups for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- The guard trigger added in 20260804_didit_kyc_sessions.sql must also cover
-- the new payout columns.
create or replace function public.guard_seller_verification_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at
     or new.rejection_reason is distinct from old.rejection_reason
     or new.cccd_id_number is distinct from old.cccd_id_number
     or new.bank_account_number is distinct from old.bank_account_number
     or new.bank_account_name is distinct from old.bank_account_name
     or new.bank_bin is distinct from old.bank_bin
     or new.bank_account_name_verified is distinct from old.bank_account_name_verified
     or new.bank_verified_at is distinct from old.bank_verified_at
     or new.is_duplicate is distinct from old.is_duplicate
  then
    raise exception 'seller_verifications: privileged columns are server-managed'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
