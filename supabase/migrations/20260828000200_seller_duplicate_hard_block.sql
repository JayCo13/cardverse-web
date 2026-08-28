-- Hard-block duplicate seller identities.
--
-- Until now a reused CCCD or bank account only *flagged* a submission and sent
-- it to the admin queue (20260608_kyc_duplicate_detection.sql). That leaves the
-- decision to a human who has no way to see the other account, and the admin
-- approve path never re-checked for duplicates at all — so one mis-click made a
-- second seller account for the same person.
--
-- The route now refuses such a submission outright. This migration is the part
-- the route cannot do on its own: two concurrent submissions with the same
-- document would both pass an application-level check and both write. The
-- uniqueness has to be enforced by the database.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. One live identity ⇒ one account
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Partial, over the statuses that represent an *active* binding. A `rejected`
-- row is deliberately excluded: someone who mistyped a stranger's account
-- number must not lock that stranger out forever. Freeing a blocked identity is
-- therefore just rejecting the old row (see docs/kyc-didit.md).
--
-- Safe against the existing `on conflict (user_id) do update` upsert: a user's
-- own row moving pending → approved is the same row, so it never collides with
-- itself.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Normalised payout account
-- ─────────────────────────────────────────────────────────────────────────────
--
-- verifyBankAccount() strips non-digits before asking NAPAS, but the value that
-- gets stored and compared is whatever the form sent. "1907 5664 8370 14" and
-- "19075664837014" are one account to the bank and two different strings to us,
-- so a single space would walk straight through the block below. Production
-- already contains both spellings of the same account.
--
-- A stored generated column keeps the raw input for display while giving the
-- index and the duplicate query one canonical form to agree on.

alter table public.seller_verifications
  add column if not exists bank_account_number_normalized text
  generated always as (regexp_replace(coalesce(bank_account_number, ''), '[^0-9]', '', 'g')) stored;

-- Pre-flight. The old behaviour only *flagged* duplicates, so this database may
-- already hold rows that the indexes below would reject — and a failed CREATE
-- UNIQUE INDEX would abort the whole migration with an opaque message. Fail
-- early instead, naming exactly what has to be resolved first (reject the older
-- verification of each pair, then re-run).
do $$
declare
  v_conflicts text;
begin
  select string_agg(detail, e'\n')
    into v_conflicts
  from (
    select 'document_number_hash=' || document_number_hash
           || ' → users: ' || string_agg(user_id::text, ', ' order by created_at) as detail
    from public.seller_verifications
    where status in ('approved', 'pending') and document_number_hash is not null
    group by document_number_hash
    having count(*) > 1

    union all

    select 'bank_account_number=' || bank_account_number_normalized
           || ' → users: ' || string_agg(user_id::text, ', ' order by created_at) as detail
    from public.seller_verifications
    where status in ('approved', 'pending') and bank_account_number_normalized <> ''
    group by bank_account_number_normalized
    having count(*) > 1
  ) conflicts;

  if v_conflicts is not null then
    raise exception
      'Cannot enforce one-identity-per-account: existing approved/pending rows already collide:%',
      e'\n' || v_conflicts
      using hint = 'Reject the duplicate verification of each pair in the admin panel, then re-run this migration.';
  end if;
end
$$;

create unique index if not exists seller_verifications_active_document_unique
  on public.seller_verifications (document_number_hash)
  where status in ('approved', 'pending') and document_number_hash is not null;

create unique index if not exists seller_verifications_active_bank_unique
  on public.seller_verifications (bank_account_number_normalized)
  where status in ('approved', 'pending') and bank_account_number_normalized <> '';

create index if not exists idx_seller_verifications_bank_normalized
  on public.seller_verifications (bank_account_number_normalized)
  where bank_account_number_normalized <> '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Audit trail of blocked attempts
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A hard block leaves no row in seller_verifications, so without this table a
-- blocked user simply vanishes and support cannot answer "why can't I sell?".

create table if not exists public.seller_verification_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 'document' | 'bank' | 'both'
  matched_axis text not null,
  document_number_hash text,
  bank_account_number text,
  -- The other account(s) this collided with. Admin-only; never returned to the
  -- blocked user, who has no business knowing whose identity they reused.
  matched_user_ids uuid[],
  created_at timestamp with time zone not null default now(),
  constraint seller_verification_blocks_axis_check
    check (matched_axis in ('document', 'bank', 'both'))
);

create index if not exists idx_seller_verification_blocks_user
  on public.seller_verification_blocks (user_id, created_at desc);
create index if not exists idx_seller_verification_blocks_created
  on public.seller_verification_blocks (created_at desc);

alter table public.seller_verification_blocks enable row level security;

-- Server-only, same posture as kyc_sessions: no grants for anon/authenticated;
-- service_role bypasses RLS so the API routes still work.
revoke all on public.seller_verification_blocks from anon, authenticated;

drop policy if exists "Admins can view seller verification blocks"
  on public.seller_verification_blocks;
create policy "Admins can view seller verification blocks"
  on public.seller_verification_blocks for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2b. Who decided
-- ─────────────────────────────────────────────────────────────────────────────
--
-- reviewed_by is a uuid, but the highest-authority admin persona (moderator)
-- is not a Supabase user at all — getAdminActor() identifies it as
-- 'moderator:<sid>'. Without somewhere to put that, every moderator decision
-- lands as an anonymous null.

alter table public.seller_verifications
  add column if not exists reviewed_by_actor text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Re-check inside the finalize transaction
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Unchanged from 20260824000100_kyc_completion_delivery.sql except for the
-- duplicate guard below and writing phone_verified_at through. The guard gives
-- a named error the route can map to a clean 409; the unique indexes above are
-- the backstop if anything ever bypasses it.

create or replace function public.finalize_seller_verification(
  p_user_id uuid,
  p_session_id uuid,
  p_verification jsonb,
  p_auto_approved boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.kyc_sessions%rowtype;
  v_existing_status text;
  v_status text := case when p_auto_approved then 'approved' else 'pending' end;
  v_now timestamp with time zone := now();
  v_bank_account text := regexp_replace(coalesce(p_verification ->> 'bank_account_number', ''), '[^0-9]', '', 'g');
  v_dup_document boolean;
  v_dup_bank boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select * into v_session
  from public.kyc_sessions
  where id = p_session_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'kyc_session_not_found' using errcode = 'P0002';
  end if;
  if v_session.status <> 'Approved' then
    raise exception 'kyc_session_not_approved' using errcode = 'P0001';
  end if;
  if v_session.consumed_at is not null then
    raise exception 'kyc_session_consumed' using errcode = 'P0001';
  end if;

  select status into v_existing_status
  from public.seller_verifications
  where user_id = p_user_id
  for update;

  if v_existing_status = 'approved' then
    raise exception 'seller_already_approved' using errcode = 'P0001';
  end if;
  if v_existing_status = 'pending' then
    raise exception 'seller_verification_pending' using errcode = 'P0001';
  end if;

  -- Duplicate guard: refuse to bind an identity or a payout account that
  -- already belongs to a live submission on another account.
  --
  -- Two aggregates rather than one CASE, because an aggregate over zero rows
  -- yields NULL, not false — collapsing that into a single expression silently
  -- reports a duplicate when there is none.
  select
    bool_or(v_session.document_number_hash is not null
            and sv.document_number_hash = v_session.document_number_hash),
    bool_or(v_bank_account <> ''
            and sv.bank_account_number_normalized = v_bank_account)
    into v_dup_document, v_dup_bank
  from public.seller_verifications sv
  where sv.user_id <> p_user_id
    and sv.status in ('approved', 'pending')
    and (
      (v_session.document_number_hash is not null
        and sv.document_number_hash = v_session.document_number_hash)
      or (v_bank_account <> '' and sv.bank_account_number_normalized = v_bank_account)
    );

  v_dup_document := coalesce(v_dup_document, false);
  v_dup_bank := coalesce(v_dup_bank, false);

  -- Two submissions racing here both see a clean table; the partial unique
  -- indexes above are what actually serialises them, surfacing as 23505.
  if v_dup_document or v_dup_bank then
    raise exception 'seller_duplicate_identity'
      using errcode = 'P0001',
            detail = case
                       when v_dup_document and v_dup_bank then 'both'
                       when v_dup_document then 'document'
                       else 'bank'
                     end;
  end if;

  insert into public.seller_verifications (
    user_id,
    full_name,
    bank_name,
    bank_bin,
    bank_account_number,
    bank_account_name,
    bank_account_name_verified,
    bank_verified_at,
    bank_screenshot_url,
    phone_number,
    kyc_session_id,
    kyc_provider,
    document_number_hash,
    ai_cccd_name,
    ai_name_match,
    is_duplicate,
    duplicate_notes,
    auto_approved,
    review_flags,
    status,
    rejection_reason,
    reviewed_by,
    reviewed_at,
    updated_at
  ) values (
    p_user_id,
    p_verification ->> 'full_name',
    p_verification ->> 'bank_name',
    nullif(p_verification ->> 'bank_bin', ''),
    p_verification ->> 'bank_account_number',
    p_verification ->> 'bank_account_name',
    nullif(p_verification ->> 'bank_account_name_verified', ''),
    nullif(p_verification ->> 'bank_verified_at', '')::timestamp with time zone,
    nullif(p_verification ->> 'bank_screenshot_url', ''),
    p_verification ->> 'phone_number',
    v_session.id,
    v_session.provider,
    v_session.document_number_hash,
    v_session.verified_full_name,
    coalesce((p_verification ->> 'ai_name_match')::boolean, false),
    false,
    null,
    p_auto_approved,
    nullif(p_verification -> 'review_flags', 'null'::jsonb),
    v_status,
    null,
    null,
    case when p_auto_approved then v_now else null end,
    v_now
  )
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    bank_name = excluded.bank_name,
    bank_bin = excluded.bank_bin,
    bank_account_number = excluded.bank_account_number,
    bank_account_name = excluded.bank_account_name,
    bank_account_name_verified = excluded.bank_account_name_verified,
    bank_verified_at = excluded.bank_verified_at,
    bank_screenshot_url = excluded.bank_screenshot_url,
    phone_number = excluded.phone_number,
    kyc_session_id = excluded.kyc_session_id,
    kyc_provider = excluded.kyc_provider,
    document_number_hash = excluded.document_number_hash,
    ai_cccd_name = excluded.ai_cccd_name,
    ai_name_match = excluded.ai_name_match,
    is_duplicate = excluded.is_duplicate,
    duplicate_notes = excluded.duplicate_notes,
    auto_approved = excluded.auto_approved,
    review_flags = excluded.review_flags,
    status = excluded.status,
    rejection_reason = null,
    reviewed_by = null,
    reviewed_at = excluded.reviewed_at,
    updated_at = excluded.updated_at;

  update public.kyc_sessions
  set consumed_at = v_now
  where id = v_session.id;

  update public.profiles
  set seller_verified = p_auto_approved,
      updated_at = v_now
  where id = p_user_id;

  if p_auto_approved then
    insert into public.notifications (
      user_id, type, title, message, kyc_session_id, read
    ) values (
      p_user_id,
      'kyc_approved',
      'notification_kyc_approved_title',
      'notification_kyc_approved_message',
      v_session.id,
      false
    )
    on conflict (kyc_session_id, type) do nothing;
  end if;

  return jsonb_build_object(
    'status', v_status,
    'auto_approved', p_auto_approved,
    'kyc_session_id', v_session.id
  );
end;
$$;

revoke all on function public.finalize_seller_verification(uuid, uuid, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.finalize_seller_verification(uuid, uuid, jsonb, boolean)
  to service_role;

notify pgrst, 'reload schema';
