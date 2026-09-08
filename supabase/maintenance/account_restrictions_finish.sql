-- Idempotent convergence for 20260908000100_account_restrictions.sql.
--
-- That migration was applied chunk-by-chunk in the SQL editor and its
-- financial-guard block failed on a malformed array literal, so the database
-- sits in a partial state and the original file can no longer be re-run.
-- This script is safe to run repeatedly: every object is created-or-replaced,
-- and each of the three in-place function rewrites is skipped when its marker
-- is already present, so nothing is ever injected twice.
begin;

create table if not exists public.account_restrictions (
  user_id uuid primary key references auth.users(id),
  is_banned boolean not null default false,
  reason text,
  banned_at timestamptz,
  banned_by text,
  version bigint not null default 0 check (version >= 0)
);
create table if not exists public.account_restriction_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  action text not null check (action in ('ban','unban')),
  reason text not null check (char_length(trim(reason)) between 10 and 1000),
  actor_id text not null,
  actor_role text not null check (actor_role in ('admin','moderator')),
  created_at timestamptz not null default now(),
  idempotency_key uuid not null,
  request_payload jsonb not null,
  result jsonb not null,
  unique (user_id, idempotency_key)
);
create table if not exists public.account_review_holds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.account_restriction_events(id),
  user_id uuid not null references auth.users(id),
  order_id uuid references public.orders(id),
  withdrawal_id uuid references public.wallet_withdrawals(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution text,
  reason text,
  check (num_nonnulls(order_id, withdrawal_id) = 1),
  unique (event_id, order_id),
  unique (event_id, withdrawal_id)
);
-- Named explicitly: the original used bare "create index on", which would add a
-- second copy of each index on every re-run.
create index if not exists account_review_holds_order_id_idx
  on public.account_review_holds(order_id) where resolved_at is null;
create index if not exists account_review_holds_withdrawal_id_idx
  on public.account_review_holds(withdrawal_id) where resolved_at is null;
create table if not exists public.account_review_decisions (
  idempotency_key uuid primary key,
  request_payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.account_restrictions enable row level security;
alter table public.account_restriction_events enable row level security;
alter table public.account_review_holds enable row level security;
alter table public.account_review_decisions enable row level security;
revoke all on public.account_restrictions, public.account_restriction_events, public.account_review_holds, public.account_review_decisions from anon, authenticated;
grant select (user_id,is_banned,reason,banned_at,version) on public.account_restrictions to authenticated;
grant all on public.account_restrictions, public.account_restriction_events, public.account_review_holds, public.account_review_decisions to service_role;
drop policy if exists restriction_self_read on public.account_restrictions;
create policy restriction_self_read on public.account_restrictions for select to authenticated using (user_id = auth.uid());

create or replace function public.account_is_active(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select not exists (select 1 from public.account_restrictions where user_id = p_user_id and is_banned);
$fn$;
create or replace function public.lock_account_operations(p_users uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(830080001);
  for v_id in select distinct x from unnest(p_users) x where x is not null order by x loop
    perform pg_advisory_xact_lock(hashtextextended('account:' || v_id::text, 0));
  end loop;
end;
$fn$;
create or replace function public.assert_active_account(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform public.lock_account_operations(array[p_user_id]);
  if not public.account_is_active(p_user_id) then raise sqlstate '42501' using message = 'account_banned'; end if;
end;
$fn$;
create or replace function public.assert_account_session() returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if auth.uid() is not null and coalesce(auth.role(),'') <> 'service_role' then
    perform public.assert_active_account(auth.uid());
  end if;
end;
$fn$;
create or replace function public.set_account_restriction(p_user_id uuid, p_action text, p_reason text,
  p_expected_version bigint, p_key uuid, p_actor_id text, p_actor_role text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_state public.account_restrictions%rowtype; v_event public.account_restriction_events%rowtype;
  v_request jsonb; v_result jsonb; v_role text; v_event_id uuid := gen_random_uuid();
begin
  if auth.role() is distinct from 'service_role' or p_actor_role is null or p_actor_role not in ('admin','moderator')
    or nullif(trim(p_actor_id),'') is null or p_actor_id = p_user_id::text then raise exception 'forbidden'; end if;
  if p_action is null or p_action not in ('ban','unban') or p_reason is null
    or char_length(trim(p_reason)) not between 10 and 1000 or p_expected_version is null
    or p_expected_version < 0 or p_key is null then raise exception 'invalid_request'; end if;
  perform public.lock_account_operations(array[p_user_id]);
  select raw_app_meta_data->>'role' into v_role from auth.users where id = p_user_id for update;
  if not found then raise exception 'user_not_found'; end if;
  if v_role in ('admin','moderator','service_role') then raise exception 'forbidden'; end if;
  v_request := jsonb_build_object('action',p_action,'reason',trim(p_reason),'version',p_expected_version,'actor',p_actor_id,'role',p_actor_role);
  select * into v_event from public.account_restriction_events where user_id=p_user_id and idempotency_key=p_key;
  if found then
    if v_event.request_payload <> v_request then raise exception 'idempotency_conflict'; end if;
    return v_event.result;
  end if;
  insert into public.account_restrictions(user_id) values(p_user_id) on conflict do nothing;
  select * into v_state from public.account_restrictions where user_id=p_user_id for update;
  if v_state.version <> p_expected_version then raise exception 'version_conflict'; end if;
  update public.account_restrictions set is_banned=(p_action='ban'),
    reason=case when p_action='ban' then trim(p_reason) else null end,
    banned_at=case when p_action='ban' then now() else null end,
    banned_by=case when p_action='ban' then p_actor_id else null end,
    version=version+1 where user_id=p_user_id returning * into v_state;
  v_result := to_jsonb(v_state) - 'banned_by';
  insert into public.account_restriction_events(id,user_id,action,reason,actor_id,actor_role,idempotency_key,request_payload,result)
    values(v_event_id,p_user_id,p_action,trim(p_reason),p_actor_id,p_actor_role,p_key,v_request,v_result);
  if p_action='ban' then
    insert into public.account_review_holds(event_id,user_id,order_id)
      select v_event_id,p_user_id,id from public.orders where (buyer_id=p_user_id or seller_id=p_user_id)
        and status not in ('completed','refunded','cancelled');
    insert into public.account_review_holds(event_id,user_id,withdrawal_id)
      select v_event_id,p_user_id,id from public.wallet_withdrawals where user_id=p_user_id
        and status not in ('completed','rejected','cancelled');
  end if;
  return v_result;
end;
$fn$;
revoke all on function public.set_account_restriction(uuid,text,text,bigint,uuid,text,text) from public,anon,authenticated;
grant execute on function public.set_account_restriction(uuid,text,text,bigint,uuid,text,text) to service_role;

create or replace function public.immutable_account_audit() returns trigger language plpgsql as $fn$
begin raise exception 'account_audit_is_append_only'; end;
$fn$;
drop trigger if exists immutable_account_events on public.account_restriction_events;
create trigger immutable_account_events before update or delete on public.account_restriction_events
  for each row execute function public.immutable_account_audit();
drop trigger if exists immutable_account_decisions on public.account_review_decisions;
create trigger immutable_account_decisions before update or delete on public.account_review_decisions
  for each row execute function public.immutable_account_audit();

create or replace function public.guard_account_write() returns trigger language plpgsql security definer set search_path=public,pg_temp as $fn$
begin
  perform public.assert_account_session();
  if TG_OP='DELETE' then return old; end if;
  return new;
end;
$fn$;
do $do$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity
      and c.relname not in ('account_restrictions','account_restriction_events','account_review_holds','account_review_decisions','contact_requests') loop
    execute format('drop policy if exists account_active_only on public.%I',t.relname);
    execute format('create policy account_active_only on public.%I as restrictive for all to authenticated using (public.account_is_active(auth.uid())) with check (public.account_is_active(auth.uid()))',t.relname);
    execute format('drop trigger if exists account_write_guard on public.%I',t.relname);
    execute format('create trigger account_write_guard before insert or update or delete on public.%I for each row execute function public.guard_account_write()',t.relname);
  end loop;
end;
$do$;
drop policy if exists account_active_storage on storage.objects;
create policy account_active_storage on storage.objects as restrictive for all to authenticated
  using (public.account_is_active(auth.uid())) with check (public.account_is_active(auth.uid()));
drop policy if exists active_listing_seller on public.cards;
create policy active_listing_seller on public.cards as restrictive for select to anon,authenticated
  using (public.account_is_active(seller_id));

create or replace function public.lock_account_statement() returns trigger language plpgsql security definer set search_path=public,pg_temp as $fn$
begin perform public.lock_account_operations(array[]::uuid[]); return null; end;
$fn$;
do $do$
declare t text;
begin
  foreach t in array array['orders','offers','cards','wallets','wallet_withdrawals','wallet_fund_sources','wallet_fund_allocations'] loop
    execute format('drop trigger if exists account_statement_lock on public.%I',t);
    execute format('create trigger account_statement_lock before insert or update or delete on public.%I for each statement execute function public.lock_account_statement()',t);
  end loop;
end;
$do$;

create or replace function public.guard_restricted_trade() returns trigger language plpgsql security definer set search_path=public,pg_temp as $fn$
declare v_seller uuid;
begin
  if TG_TABLE_NAME='offers' then
    select seller_id into v_seller from public.cards where id=new.card_id;
    perform public.lock_account_operations(array[new.buyer_id,v_seller]);
    perform public.assert_active_account(new.buyer_id);
    perform public.assert_active_account(v_seller);
    return new;
  end if;
  perform public.lock_account_operations(array[new.buyer_id,new.seller_id]);
  if TG_OP='INSERT' then
    if current_setting('cardverse.verified_payment',true) is distinct from 'yes' then
      perform public.assert_active_account(new.buyer_id);
      perform public.assert_active_account(new.seller_id);
    end if;
  else
    if new.status='completed' and old.status is distinct from 'completed'
      and exists(select 1 from public.account_review_holds where order_id=new.id and resolved_at is null) then
      raise exception 'account_review_required';
    end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists restricted_order_guard on public.orders;
create trigger restricted_order_guard before insert or update on public.orders for each row execute function public.guard_restricted_trade();
drop trigger if exists restricted_offer_guard on public.offers;
create trigger restricted_offer_guard before insert or update on public.offers for each row
  when (new.status in ('pending','accepted','chosen')) execute function public.guard_restricted_trade();

create or replace function public.hold_restricted_payment() returns trigger language plpgsql security definer set search_path=public,pg_temp as $fn$
begin
  insert into public.account_review_holds(event_id,user_id,order_id)
    select e.id,r.user_id,new.id from public.account_restrictions r
    join lateral (select id from public.account_restriction_events where user_id=r.user_id and action='ban' order by created_at desc,id desc limit 1) e on true
    where r.user_id in (new.buyer_id,new.seller_id) and r.is_banned
      and new.status not in ('completed','cancelled','refunded')
    on conflict do nothing;
  return new;
end;
$fn$;
drop trigger if exists restricted_payment_hold on public.orders;
create trigger restricted_payment_hold after insert or update on public.orders for each row execute function public.hold_restricted_payment();

create or replace function public.guard_restricted_withdrawal() returns trigger language plpgsql security definer set search_path=public,pg_temp as $fn$
begin
  perform public.lock_account_operations(array[new.user_id]);
  if TG_OP='INSERT' then perform public.assert_active_account(new.user_id);
  elsif (new.status='processing' and old.status is distinct from 'processing')
     or (new.active_transfer_attempt_id is distinct from old.active_transfer_attempt_id and new.active_transfer_attempt_id is not null) then
    if not public.account_is_active(new.user_id) or exists(select 1 from public.account_review_holds where withdrawal_id=new.id and resolved_at is null) then
      raise exception 'account_review_required';
    end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists restricted_withdrawal_guard on public.wallet_withdrawals;
create trigger restricted_withdrawal_guard before insert or update on public.wallet_withdrawals for each row execute function public.guard_restricted_withdrawal();

-- Rewrite 1 of 3: inject the session boundary into every SECURITY DEFINER
-- plpgsql function. Skipped per function once the marker is present, and the
-- exclusion list now also covers the functions this migration itself adds
-- after the original block ran (a re-run would otherwise inject into them).
do $do$
declare f record; definition text;
begin
  for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    join pg_language l on l.oid=p.prolang
    where n.nspname='public' and p.prosecdef and l.lanname='plpgsql'
      and p.prorettype <> 'trigger'::regtype
      and p.prosrc not like '%assert_account_session%'
      and p.proname not in ('account_is_active','assert_active_account','assert_account_session',
                            'lock_account_operations','set_account_restriction','account_request_guard',
                            'resolve_account_order_hold','resolve_account_withdrawal_hold') loop
    definition := pg_get_functiondef(f.oid);
    definition := regexp_replace(definition, E'\\mbegin\\M', E'begin\n  perform public.lock_account_operations(array[]::uuid[]);\n  perform public.assert_account_session();', 'i');
    execute definition;
  end loop;
end;
$do$;

create or replace function public.account_request_guard() returns void language plpgsql security definer set search_path=public,pg_temp as $fn$
begin
  if current_setting('request.path',true) = '/account_restrictions' and current_setting('request.method',true)='GET' then return; end if;
  if current_setting('request.path',true) = '/contact_requests' and current_setting('request.method',true)='POST' then return; end if;
  perform public.assert_account_session();
end;
$fn$;
do $do$
begin
  if exists(select 1 from pg_db_role_setting s join pg_roles r on r.oid=s.setrole,
    unnest(s.setconfig) c where r.rolname='authenticator' and c like 'pgrst.db_pre_request=%'
      and c <> 'pgrst.db_pre_request=public.account_request_guard') then
    raise exception 'existing_pre_request_hook_requires_composition';
  end if;
end;
$do$;
alter role authenticator set pgrst.db_pre_request='public.account_request_guard';

revoke all on function public.lock_account_operations(uuid[]) from public,anon,authenticated;
revoke all on function public.assert_active_account(uuid) from public,anon,authenticated;
revoke all on function public.assert_account_session() from public,anon,authenticated;
revoke all on function public.guard_account_write(), public.lock_account_statement(), public.guard_restricted_trade(), public.hold_restricted_payment(), public.guard_restricted_withdrawal(), public.immutable_account_audit() from public,anon,authenticated;
grant execute on function public.account_is_active(uuid) to anon,authenticated,service_role;

do $do$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
                     and schemaname='public' and tablename='account_restrictions') then
    alter publication supabase_realtime add table public.account_restrictions;
  end if;
end $do$;

-- Rewrite 2 of 3: extend the reviewed-settlement and completion functions.
-- Each half is skipped once its marker is present, so the shape assertions no
-- longer fire against an already-patched body.
do $do$
declare d text; old_check text := 'if not found or v_order.status <> ''disputed'' then raise exception ''order_not_disputed''; end if;';
begin
  if not exists(select 1 from pg_proc where proname='resolve_marketplace_dispute'
                  and pronamespace='public'::regnamespace and prosrc like '%account_review_holds%') then
    d := pg_get_functiondef('public.resolve_marketplace_dispute(uuid,text,text,text,uuid)'::regprocedure);
    if position(old_check in d)=0 then raise exception 'dispute_function_shape_changed'; end if;
    d := replace(d,old_check, 'if not found or (v_order.status <> ''disputed'' and not exists (select 1 from public.account_review_holds where order_id=p_order_id and resolved_at=transaction_timestamp() and resolved_by=p_actor_id)) then raise exception ''order_not_disputed''; end if;');
    execute d;
  end if;
  if not exists(select 1 from pg_proc where proname='complete_delivered_orders'
                  and pronamespace='public'::regnamespace and prosrc like '%account_review_holds%') then
    d := pg_get_functiondef('public.complete_delivered_orders()'::regprocedure);
    if position('where o.status in' in d)=0 then raise exception 'completion_function_shape_changed'; end if;
    d := replace(d,'where o.status in','where not exists(select 1 from public.account_review_holds h where h.order_id=o.id and h.resolved_at is null) and o.status in');
    execute d;
  end if;
  if not exists(select 1 from pg_proc where proname='apply_payos_webhook_event'
                  and pronamespace='public'::regnamespace and prosrc like '%cardverse.verified_payment%') then
    d := pg_get_functiondef('public.apply_payos_webhook_event(uuid)'::regprocedure);
    d := regexp_replace(d,E'\\mbegin\\M',E'begin\n  perform set_config(''cardverse.verified_payment'',''yes'',true);','i');
    execute d;
  end if;
end;
$do$;

create or replace function public.resolve_account_order_hold(p_order_id uuid,p_action text,p_reason text,p_actor_id text,p_actor_role text,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare v_request jsonb; v_previous public.account_review_decisions%rowtype; v_result jsonb; v_status text;
begin
  if auth.role() is distinct from 'service_role' or p_actor_role is null or p_actor_role not in ('admin','moderator') or nullif(trim(p_actor_id),'') is null then raise exception 'forbidden'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 10 and 1000 or p_key is null
    or p_action is null or p_action not in ('refund_buyer','release_seller') then raise exception 'invalid_request'; end if;
  perform public.lock_account_operations(array[]::uuid[]);
  v_request:=jsonb_build_object('order_id',p_order_id,'action',p_action,'reason',trim(p_reason),'actor',p_actor_id,'role',p_actor_role);
  select * into v_previous from public.account_review_decisions where idempotency_key=p_key;
  if found then
    if v_previous.request_payload<>v_request then raise exception 'idempotency_conflict'; end if;
    return v_previous.result || jsonb_build_object('replayed',true);
  end if;
  select status into v_status from public.orders where id=p_order_id for update;
  if not found or v_status not in ('paid','shipping','delivered','disputed') then raise exception 'order_not_paid_or_already_closed'; end if;
  update public.account_review_holds set resolved_at=transaction_timestamp(),resolved_by=p_actor_id,resolution=p_action,reason=trim(p_reason)
    where order_id=p_order_id and resolved_at is null;
  if not found then raise exception 'hold_not_found'; end if;
  v_result:=public.resolve_marketplace_dispute(p_order_id,p_action,p_actor_id,p_actor_role,p_key);
  insert into public.account_review_decisions(idempotency_key,request_payload,result) values(p_key,v_request,v_result);
  return v_result;
end;
$fn$;
revoke all on function public.resolve_account_order_hold(uuid,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.resolve_account_order_hold(uuid,text,text,text,text,uuid) to service_role;

create or replace function public.resolve_account_withdrawal_hold(p_withdrawal_id uuid,p_reason text,p_actor_id text,p_actor_role text,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare v_user uuid; v_request jsonb; v_previous public.account_review_decisions%rowtype; v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' or p_actor_role is null or p_actor_role not in ('admin','moderator') or nullif(trim(p_actor_id),'') is null then raise exception 'forbidden'; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 10 and 1000 or p_key is null then raise exception 'invalid_request'; end if;
  perform public.lock_account_operations(array[]::uuid[]);
  v_request:=jsonb_build_object('withdrawal_id',p_withdrawal_id,'reason',trim(p_reason),'actor',p_actor_id,'role',p_actor_role);
  select * into v_previous from public.account_review_decisions where idempotency_key=p_key;
  if found then
    if v_previous.request_payload<>v_request then raise exception 'idempotency_conflict'; end if;
    return v_previous.result;
  end if;
  select user_id into v_user from public.wallet_withdrawals where id=p_withdrawal_id for update;
  if not found then raise exception 'not_found'; end if;
  perform public.assert_active_account(v_user);
  update public.account_review_holds set resolved_at=now(),resolved_by=p_actor_id,resolution='resume_review',reason=trim(p_reason)
    where withdrawal_id=p_withdrawal_id and resolved_at is null;
  if not found then raise exception 'hold_not_found'; end if;
  v_result:=jsonb_build_object('ok',true);
  insert into public.account_review_decisions(idempotency_key,request_payload,result) values(p_key,v_request,v_result);
  return v_result;
end;
$fn$;
revoke all on function public.resolve_account_withdrawal_hold(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.resolve_account_withdrawal_hold(uuid,text,text,text,uuid) to service_role;

-- Rewrite 3 of 3: the block that failed. 'p_user_id' is now matched against the
-- proargnames array itself; the original compared it against the subquery's
-- rows, which are text[], hence "malformed array literal".
do $do$
declare f record; d text;
begin
  for f in select p.oid,p.proname,p.proargnames from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosrc not like '%assert_active_account(p_user_id)%'
      and p.proname in ('spend_verified_wallet','create_server_payment_order','stage_payos_marketplace_checkout','create_verified_wallet_marketplace_orders','claim_payos_payment_link_creation') loop
    d:=pg_get_functiondef(f.oid);
    if not ('p_user_id'=any(coalesce(f.proargnames,'{}'::text[]))) then raise exception 'financial_user_argument_changed: %',f.proname; end if;
    d:=regexp_replace(d,E'\\mbegin\\M',E'begin\n  perform public.assert_active_account(p_user_id);','i');
    execute d;
  end loop;
end;
$do$;

create or replace function public.suppress_held_order_preparation() returns trigger language plpgsql security definer set search_path=public,pg_temp as $fn$
begin
  if new.type='order_new' and exists(select 1 from public.account_review_holds where order_id=new.order_id and resolved_at is null) then return null; end if;
  return new;
end;
$fn$;
drop trigger if exists suppress_held_order_preparation on public.notifications;
create trigger suppress_held_order_preparation before insert on public.notifications for each row execute function public.suppress_held_order_preparation();

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
