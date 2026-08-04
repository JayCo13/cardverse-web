-- Didit eKYC migration.
--
-- Two things happen here, and the first is independent of the vendor switch:
--
-- 1. Close the privilege-escalation holes in the old KYC flow. Users held
--    UPDATE on both `kyc_verification_scans` and `seller_verifications`, which
--    let them rewrite their own AI scan results (is_valid_cccd, confidence,
--    cccd_name) and even set status='approved' on themselves. `cards` RLS and
--    `wallet_withdrawals` both trust `seller_verifications.status`, so that was
--    a direct path to seller rights and to controlling the payout account.
--    All writes now go through service-role server routes only.
--
-- 2. Add `kyc_sessions`, which records identity decisions produced by an
--    external provider (Didit). The client can never write to it and cannot
--    read it either — status is served through /api/seller/kyc/session so the
--    raw decision payload (MRZ, document images, scores) never reaches a
--    browser.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Lock down the legacy KYC tables
-- ─────────────────────────────────────────────────────────────────────────────

-- Scans are now written only by server routes. Keeping the table for history;
-- the Didit flow does not use it.
drop policy if exists "Users can update own kyc scans" on public.kyc_verification_scans;
drop policy if exists "Users can create own kyc scans" on public.kyc_verification_scans;

-- Users keep SELECT on their own verification row, but may no longer write to
-- it at all. /api/seller/verify submits on their behalf with the service role.
drop policy if exists "Users can update own seller verifications" on public.seller_verifications;
drop policy if exists "Users can create own seller verifications" on public.seller_verifications;

-- Defence in depth: even if an UPDATE policy is ever reintroduced by mistake,
-- a non-service-role caller still cannot touch the columns that decide trust.
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
     or new.is_duplicate is distinct from old.is_duplicate
  then
    raise exception 'seller_verifications: privileged columns are server-managed'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_seller_verification_columns on public.seller_verifications;
create trigger trg_guard_seller_verification_columns
  before update on public.seller_verifications
  for each row execute function public.guard_seller_verification_columns();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Provider-backed identity sessions
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.kyc_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  provider text not null default 'didit',
  provider_session_id text not null,
  workflow_id text,

  -- Provider session status, verbatim. Didit values:
  -- Not Started, In Progress, Approved, Declined, In Review, Abandoned,
  -- Expired, Kyc Expired, Resubmitted, Awaiting User.
  status text not null default 'Not Started',

  -- Extracted identity, populated by the webhook once a decision exists.
  verified_full_name text,
  verified_dob date,
  verified_document_type text,
  verified_issuing_state text,
  -- The raw CCCD number is never stored. This is an HMAC keyed by
  -- KYC_DOCUMENT_HASH_SECRET, which is enough to detect the same document
  -- across accounts without holding the identifier itself.
  document_number_hash text,

  liveness_score numeric(6, 2),
  face_match_score numeric(6, 2),
  nfc_verified boolean not null default false,
  warnings jsonb,

  -- Full provider payload, for admin review and dispute handling only.
  decision jsonb,

  -- Set when the session has been redeemed by /api/seller/verify, so one
  -- approved session cannot back two submissions.
  consumed_at timestamp with time zone,

  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint kyc_sessions_provider_session_unique unique (provider, provider_session_id)
);

create index if not exists idx_kyc_sessions_user_id
  on public.kyc_sessions (user_id, created_at desc);
create index if not exists idx_kyc_sessions_document_hash
  on public.kyc_sessions (document_number_hash)
  where document_number_hash is not null;

alter table public.kyc_sessions enable row level security;

-- No policies for `authenticated` and no grants: the table is server-only.
-- service_role bypasses RLS, so the API routes still work.
revoke all on public.kyc_sessions from anon, authenticated;

drop policy if exists "Admins can view kyc sessions" on public.kyc_sessions;
create policy "Admins can view kyc sessions"
  on public.kyc_sessions for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create or replace function public.touch_kyc_sessions_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_kyc_sessions_updated_at on public.kyc_sessions;
create trigger trg_touch_kyc_sessions_updated_at
  before update on public.kyc_sessions
  for each row execute function public.touch_kyc_sessions_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Link seller_verifications to the identity session
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.seller_verifications
  add column if not exists kyc_session_id uuid references public.kyc_sessions(id) on delete set null,
  add column if not exists kyc_provider text,
  add column if not exists document_number_hash text,
  add column if not exists auto_approved boolean not null default false,
  add column if not exists review_flags jsonb;

-- The provider now holds the document images; we no longer upload CCCD photos
-- to Cloudinary, so these columns are optional on new submissions.
alter table public.seller_verifications
  alter column id_card_front_url drop not null,
  alter column id_card_back_url drop not null;

create index if not exists idx_seller_verifications_document_hash
  on public.seller_verifications (document_number_hash)
  where document_number_hash is not null;

notify pgrst, 'reload schema';
