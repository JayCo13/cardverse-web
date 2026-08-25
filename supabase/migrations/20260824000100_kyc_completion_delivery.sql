-- Complete the provider-backed KYC lifecycle:
--   * remember the user's locale for asynchronous email,
--   * make KYC notifications idempotent per provider session,
--   * claim identity-completion email delivery atomically, and
--   * finalize seller verification in one database transaction.

alter table public.kyc_sessions
  add column if not exists locale text not null default 'vi-VN',
  add column if not exists identity_email_sending_at timestamp with time zone,
  add column if not exists identity_email_sent_at timestamp with time zone;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kyc_sessions_locale_check'
      and conrelid = 'public.kyc_sessions'::regclass
  ) then
    alter table public.kyc_sessions
      add constraint kyc_sessions_locale_check
      check (locale in ('vi-VN', 'en-US', 'ja-JP'));
  end if;
end
$$;

alter table public.notifications
  add column if not exists kyc_session_id uuid
    references public.kyc_sessions(id) on delete set null;

create unique index if not exists notifications_kyc_session_type_unique
  on public.notifications (kyc_session_id, type);

create or replace function public.claim_kyc_identity_email(p_session_id uuid)
returns table (
  user_id uuid,
  verified_full_name text,
  locale text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  return query
  update public.kyc_sessions session
  set identity_email_sending_at = now()
  where session.id = p_session_id
    and session.status = 'Approved'
    and session.consumed_at is null
    and session.identity_email_sent_at is null
    and (
      session.identity_email_sending_at is null
      or session.identity_email_sending_at < now() - interval '5 minutes'
    )
  returning session.user_id, session.verified_full_name, session.locale;
end;
$$;

revoke all on function public.claim_kyc_identity_email(uuid) from public, anon, authenticated;
grant execute on function public.claim_kyc_identity_email(uuid) to service_role;

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
    coalesce((p_verification ->> 'is_duplicate')::boolean, false),
    nullif(p_verification ->> 'duplicate_notes', ''),
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
