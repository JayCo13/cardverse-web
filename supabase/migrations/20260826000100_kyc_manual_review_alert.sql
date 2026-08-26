-- Alert the review team when the provider hands a session back for a human
-- decision.
--
-- 'In Review' means Didit's automation declined to rule either way: the case
-- sits in its console until someone approves or declines it. Nothing in the app
-- was watching for that, so a flagged seller waited on a queue no one was told
-- about. This claims the alert the same way identity email is claimed, so a
-- webhook retry and the browser's status poll cannot both send it.

alter table public.kyc_sessions
  add column if not exists review_alert_sending_at timestamp with time zone,
  add column if not exists review_alert_sent_at timestamp with time zone;

create or replace function public.claim_kyc_review_alert(p_session_id uuid)
returns table (
  user_id uuid,
  provider text,
  provider_session_id text,
  verified_full_name text,
  locale text,
  warnings jsonb
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
  set review_alert_sending_at = now()
  where session.id = p_session_id
    and session.status = 'In Review'
    and session.consumed_at is null
    and session.review_alert_sent_at is null
    -- Reclaim after five minutes so a crashed sender does not strand the
    -- alert; the send itself is far shorter than that.
    and (
      session.review_alert_sending_at is null
      or session.review_alert_sending_at < now() - interval '5 minutes'
    )
  returning
    session.user_id,
    session.provider,
    session.provider_session_id,
    session.verified_full_name,
    session.locale,
    session.warnings;
end;
$$;

revoke all on function public.claim_kyc_review_alert(uuid) from public, anon, authenticated;
grant execute on function public.claim_kyc_review_alert(uuid) to service_role;

notify pgrst, 'reload schema';
