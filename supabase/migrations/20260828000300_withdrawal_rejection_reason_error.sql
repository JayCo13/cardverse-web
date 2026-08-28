-- The admin statement UI sends action data under `payload`.  Preserve the
-- original state-transition function and add a thin validation boundary so a
-- missing rejection reason is never reported as an authorization failure.
begin;

-- SQL Editor executions can be retried after a network timeout.  Only rename
-- the original implementation once; later runs recreate the public wrapper.
do $$
begin
  if to_regprocedure('public.perform_withdrawal_action_impl(uuid,text,uuid,text,text,jsonb)') is null then
    execute 'alter function public.perform_withdrawal_action(uuid, text, uuid, text, text, jsonb) rename to perform_withdrawal_action_impl';
  end if;
end;
$$;

revoke execute on function public.perform_withdrawal_action_impl(uuid, text, uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.perform_withdrawal_action(
  p_withdrawal_id uuid,
  p_action text,
  p_idempotency_key uuid,
  p_actor_id text,
  p_actor_role text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_action = 'reject'
     and nullif(trim(coalesce(p_payload ->> 'reason', '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'rejection_reason_required');
  end if;

  return public.perform_withdrawal_action_impl(
    p_withdrawal_id,
    p_action,
    p_idempotency_key,
    p_actor_id,
    p_actor_role,
    p_payload
  );
end;
$$;

revoke execute on function public.perform_withdrawal_action(uuid, text, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.perform_withdrawal_action(uuid, text, uuid, text, text, jsonb)
  to service_role;

notify pgrst, 'reload schema';

commit;
