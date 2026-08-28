-- Persist withdrawal-request events for admins and rejection notifications for
-- sellers. Financial transitions remain inside the original RPCs; these
-- wrappers only append idempotent notification records after a successful
-- transition in the same database transaction.
begin;

create table if not exists public.admin_withdrawal_notifications (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null unique references public.wallet_withdrawals(id) on delete cascade,
  user_id uuid not null,
  amount_requested bigint not null,
  fee bigint not null,
  amount_net bigint not null,
  created_at timestamptz not null default now()
);

alter table public.admin_withdrawal_notifications enable row level security;

drop policy if exists "Admins can view withdrawal notification events" on public.admin_withdrawal_notifications;
create policy "Admins can view withdrawal notification events"
  on public.admin_withdrawal_notifications
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

alter table public.notifications
  add column if not exists withdrawal_id uuid references public.wallet_withdrawals(id) on delete set null;

create unique index if not exists notifications_withdrawal_type_unique
  on public.notifications (withdrawal_id, type)
  where withdrawal_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'admin_withdrawal_notifications'
  ) then
    alter publication supabase_realtime add table public.admin_withdrawal_notifications;
  end if;
end $$;

do $$
begin
  if to_regprocedure('public.request_wallet_withdrawal_impl(bigint,uuid)') is null then
    execute 'alter function public.request_wallet_withdrawal(bigint, uuid) rename to request_wallet_withdrawal_impl';
  end if;
end;
$$;

revoke execute on function public.request_wallet_withdrawal_impl(bigint, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.request_wallet_withdrawal(
  p_amount bigint,
  p_request_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_notification_created boolean := false;
  v_inserted bigint := 0;
begin
  v_result := public.request_wallet_withdrawal_impl(p_amount, p_request_idempotency_key);

  if coalesce(v_result ->> 'ok', 'false') = 'true'
     and coalesce(v_result ->> 'replayed', 'false') <> 'true' then
    insert into public.admin_withdrawal_notifications (
      withdrawal_id, user_id, amount_requested, fee, amount_net
    ) values (
      (v_result ->> 'withdrawal_id')::uuid,
      auth.uid(),
      (v_result ->> 'amount_requested')::bigint,
      (v_result ->> 'fee')::bigint,
      (v_result ->> 'amount_net')::bigint
    )
    on conflict (withdrawal_id) do nothing;
    get diagnostics v_inserted = row_count;
    v_notification_created := v_inserted > 0;
  end if;

  return v_result || jsonb_build_object('admin_notification_created', v_notification_created);
end;
$$;

revoke execute on function public.request_wallet_withdrawal(bigint, uuid)
  from public, anon;
grant execute on function public.request_wallet_withdrawal(bigint, uuid)
  to authenticated;

do $$
begin
  if to_regprocedure('public.perform_withdrawal_action_validation(uuid,text,uuid,text,text,jsonb)') is null then
    execute 'alter function public.perform_withdrawal_action(uuid, text, uuid, text, text, jsonb) rename to perform_withdrawal_action_validation';
  end if;
end;
$$;

revoke execute on function public.perform_withdrawal_action_validation(uuid, text, uuid, text, text, jsonb)
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
declare
  v_result jsonb;
  v_notification_created boolean := false;
  v_inserted bigint := 0;
begin
  v_result := public.perform_withdrawal_action_validation(
    p_withdrawal_id,
    p_action,
    p_idempotency_key,
    p_actor_id,
    p_actor_role,
    p_payload
  );

  if p_action = 'reject' and coalesce(v_result ->> 'ok', 'false') = 'true' then
    insert into public.notifications (
      user_id, type, title, message, withdrawal_id, read
    )
    select
      w.user_id,
      'withdrawal_rejected',
      'Withdrawal rejected',
      'Your withdrawal request was rejected and the held funds were returned to your wallet.',
      w.id,
      false
    from public.wallet_withdrawals w
    where w.id = p_withdrawal_id
    on conflict (withdrawal_id, type) where withdrawal_id is not null do nothing;
    get diagnostics v_inserted = row_count;
    v_notification_created := v_inserted > 0;
  end if;

  if p_action = 'reject' and coalesce(v_result ->> 'ok', 'false') = 'true' then
    return v_result || jsonb_build_object('notification_created', v_notification_created);
  end if;

  return v_result;
end;
$$;

revoke execute on function public.perform_withdrawal_action(uuid, text, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.perform_withdrawal_action(uuid, text, uuid, text, text, jsonb)
  to service_role;

notify pgrst, 'reload schema';

commit;
