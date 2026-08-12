-- Withdrawal verification, verified-fund provenance and transfer statement.
-- Shared Supabase migration for cardverse-web and cardverse-ad.
-- Phase 1/5: additive schema, maintenance gate, RLS and integrity helpers.

create extension if not exists pgcrypto;

-- Dependencies used by atomic notification writes exist in current
-- production migrations; keep the additive migration safe for older schemas.
alter table public.notifications
  add column if not exists offer_id uuid references public.offers(id) on delete set null;
alter table public.orders
  add column if not exists ghn_order_code text,
  add column if not exists ghn_status text;
create index if not exists orders_ghn_order_code_idx
  on public.orders (ghn_order_code) where ghn_order_code is not null;

-- ---------------------------------------------------------------------------
-- 1. Database-backed maintenance gate
-- ---------------------------------------------------------------------------

create table if not exists public.financial_system_state (
  singleton boolean primary key default true check (singleton),
  maintenance_active boolean not null default false,
  cutoff_at timestamptz,
  generation bigint not null default 1 check (generation > 0),
  reason text,
  changed_by text,
  changed_at timestamptz not null default now()
);

insert into public.financial_system_state (singleton)
values (true)
on conflict (singleton) do nothing;

create or replace function public.assert_financial_mutations_enabled()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_maintenance boolean;
begin
  if current_setting('cardverse.maintenance_bypass', true) = 'on' then
    return;
  end if;

  select maintenance_active
  into v_maintenance
  from public.financial_system_state
  where singleton
  for share;

  if coalesce(v_maintenance, true) then
    raise exception 'financial_maintenance_active'
      using errcode = '55000';
  end if;
end;
$$;

create or replace function public.guard_financial_maintenance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_financial_mutations_enabled();
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Fund sources, allocations, evidence and cutover classification
-- ---------------------------------------------------------------------------

create table if not exists public.wallet_fund_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  source_type text not null check (source_type in (
    'payos_deposit', 'marketplace_sale', 'refund', 'legacy_reconciliation',
    'withdrawal_return', 'compensation'
  )),
  source_id text not null,
  original_amount bigint not null check (original_amount > 0),
  remaining_amount bigint not null check (remaining_amount >= 0),
  verification_status text not null check (verification_status in (
    'verified', 'review_required', 'blocked', 'revoked'
  )),
  credits_wallet boolean not null default true,
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_type, source_id),
  check (remaining_amount <= original_amount)
);

create index if not exists wallet_fund_sources_fifo_idx
  on public.wallet_fund_sources (user_id, occurred_at, id)
  where verification_status = 'verified' and remaining_amount > 0;

create table if not exists public.wallet_fund_allocations (
  id uuid primary key default gen_random_uuid(),
  fund_source_id uuid not null references public.wallet_fund_sources(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  purpose_type text not null check (purpose_type in ('wallet_purchase', 'withdrawal')),
  purpose_id text not null,
  amount bigint not null check (amount > 0),
  status text not null check (status in ('reserved', 'consumed', 'released')),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  unique (fund_source_id, idempotency_key),
  check (
    (status = 'reserved' and consumed_at is null and released_at is null)
    or (status = 'consumed' and consumed_at is not null and released_at is null)
    or (status = 'released' and released_at is not null)
  )
);

create index if not exists wallet_fund_allocations_purpose_idx
  on public.wallet_fund_allocations (purpose_type, purpose_id, status);

create unique index if not exists wallet_withdrawal_no_reserved_and_consumed_idx
  on public.wallet_fund_allocations (purpose_id, fund_source_id)
  where purpose_type = 'withdrawal' and status in ('reserved', 'consumed');

create table if not exists public.wallet_reconciliation_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  amount bigint not null check (amount > 0),
  evidence_type text not null,
  evidence_reference text not null,
  reason text not null,
  idempotency_key uuid not null unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (user_id, evidence_type, evidence_reference)
);

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'payos',
  provider_event_key text not null,
  order_code bigint,
  event_code text,
  amount bigint,
  currency text not null default 'VND',
  signature_verified boolean not null,
  payload_sanitized jsonb not null default '{}'::jsonb,
  status text not null check (status in (
    'received', 'deferred', 'processed', 'rejected', 'review_required'
  )),
  result jsonb,
  provider_occurred_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  post_processing_status text not null default 'pending'
    check (post_processing_status in ('pending', 'processing', 'completed', 'failed')),
  post_processing_claim_id uuid,
  post_processing_claimed_at timestamptz,
  post_processing_error text,
  unique (provider, provider_event_key)
);

create index if not exists payment_webhook_events_deferred_idx
  on public.payment_webhook_events (provider_occurred_at, received_at, id)
  where status = 'deferred';

-- Subscription tables were historically created outside migrations. Capture
-- the minimum live shape so PayOS fulfilment can be atomic and replay-safe.
create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  package_type text not null,
  status text not null default 'active',
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  scan_credits_remaining integer,
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_fulfillments (
  id uuid primary key default gen_random_uuid(),
  payment_order_id uuid not null references public.payment_orders(id) on delete restrict,
  fulfillment_type text not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (payment_order_id, fulfillment_type)
);

create table if not exists public.scan_credit_consumptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  subscription_id uuid not null references public.user_subscriptions(id) on delete restrict,
  idempotency_key uuid not null,
  remaining_after integer not null check (remaining_after >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table if not exists public.marketplace_order_funding (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete restrict,
  seller_id uuid not null references auth.users(id) on delete restrict,
  funding_method text not null check (funding_method in ('wallet', 'direct_payos')),
  gross_amount bigint not null check (gross_amount > 0),
  verified_amount bigint not null default 0 check (verified_amount >= 0),
  unverified_amount bigint not null default 0 check (unverified_amount >= 0),
  classification text not null check (classification in (
    'native_verified_escrow', 'backfilled_verified_escrow',
    'legacy_escrow_blocked', 'disputed_frozen', 'released', 'cancelled'
  )),
  payment_order_id uuid references public.payment_orders(id) on delete restrict,
  provider_evidence_event_id uuid references public.payment_webhook_events(id) on delete restrict,
  cutoff_at timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (verified_amount + unverified_amount = gross_amount)
);

-- Ledger metadata is additive and keeps the existing history API compatible.
alter table public.wallet_transactions
  add column if not exists fund_source_id uuid references public.wallet_fund_sources(id) on delete restrict,
  add column if not exists reference_type text,
  add column if not exists idempotency_key uuid,
  add column if not exists affects_balance boolean not null default true,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists wallet_transactions_idempotency_idx
  on public.wallet_transactions (user_id, idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- 3. Withdrawal lifecycle, immutable transfer attempts and action retries
-- ---------------------------------------------------------------------------

alter table public.wallet_withdrawals
  add column if not exists request_idempotency_key uuid,
  add column if not exists request_hash text,
  add column if not exists currency text not null default 'VND',
  add column if not exists funding_state text not null default 'legacy_blocked',
  add column if not exists bank_account_masked text,
  add column if not exists risk_flags jsonb not null default '[]'::jsonb,
  add column if not exists verification_claim_id uuid,
  add column if not exists claimed_by text,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_expires_at timestamptz,
  add column if not exists verification_version integer,
  add column if not exists verification_snapshot jsonb,
  add column if not exists transfer_started_at timestamptz,
  add column if not exists active_transfer_attempt_id uuid,
  add column if not exists recovery_required boolean not null default false,
  add column if not exists recovery_reason text;

create unique index if not exists wallet_withdrawals_request_idempotency_idx
  on public.wallet_withdrawals (user_id, request_idempotency_key)
  where request_idempotency_key is not null;

create table if not exists public.withdrawal_transfer_attempts (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null references public.wallet_withdrawals(id) on delete restrict,
  verification_claim_id uuid not null,
  verification_version integer not null,
  verification_snapshot jsonb not null,
  allocation_snapshot jsonb not null,
  amount_requested bigint not null check (amount_requested > 0),
  fee_amount bigint not null check (fee_amount >= 0),
  amount_net bigint not null check (amount_net > 0),
  currency text not null,
  destination_bank_name text not null,
  destination_bank_code text,
  destination_account_name text not null,
  destination_account_number text not null,
  destination_account_masked text not null,
  status text not null check (status in (
    'initiated', 'bank_accepted', 'confirmed', 'failed', 'returned', 'unknown'
  )),
  started_by text not null,
  started_at timestamptz not null default now(),
  transfer_reference text,
  completed_at timestamptz,
  failure_reason text,
  failure_evidence jsonb,
  return_reference text,
  return_evidence jsonb,
  returned_at timestamptz,
  recovery_required boolean not null default false,
  unique (withdrawal_id, verification_claim_id),
  check (fee_amount + amount_net = amount_requested)
);

create unique index if not exists withdrawal_transfer_reference_idx
  on public.withdrawal_transfer_attempts (transfer_reference)
  where transfer_reference is not null;

create unique index if not exists withdrawal_return_reference_idx
  on public.withdrawal_transfer_attempts (return_reference)
  where return_reference is not null;

create or replace function public.enforce_transfer_attempt_snapshot_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.withdrawal_id is distinct from old.withdrawal_id
     or new.verification_claim_id is distinct from old.verification_claim_id
     or new.verification_version is distinct from old.verification_version
     or new.verification_snapshot is distinct from old.verification_snapshot
     or new.allocation_snapshot is distinct from old.allocation_snapshot
     or new.amount_requested is distinct from old.amount_requested
     or new.fee_amount is distinct from old.fee_amount
     or new.amount_net is distinct from old.amount_net
     or new.currency is distinct from old.currency
     or new.destination_bank_name is distinct from old.destination_bank_name
     or new.destination_bank_code is distinct from old.destination_bank_code
     or new.destination_account_name is distinct from old.destination_account_name
     or new.destination_account_number is distinct from old.destination_account_number
     or new.destination_account_masked is distinct from old.destination_account_masked
     or new.started_by is distinct from old.started_by
     or new.started_at is distinct from old.started_at then
    raise exception 'transfer_attempt_snapshot_immutable';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_transfer_attempt_snapshot_immutable()
  from public, anon, authenticated, service_role;

drop trigger if exists withdrawal_transfer_attempt_snapshot_immutable
  on public.withdrawal_transfer_attempts;
create trigger withdrawal_transfer_attempt_snapshot_immutable
before update on public.withdrawal_transfer_attempts
for each row execute function public.enforce_transfer_attempt_snapshot_immutable();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'wallet_withdrawals_active_transfer_attempt_fkey'
  ) then
    alter table public.wallet_withdrawals
      add constraint wallet_withdrawals_active_transfer_attempt_fkey
      foreign key (active_transfer_attempt_id)
      references public.withdrawal_transfer_attempts(id)
      on delete restrict
      deferrable initially deferred;
  end if;
end $$;

create table if not exists public.withdrawal_action_requests (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null references public.wallet_withdrawals(id) on delete restrict,
  actor_id text not null,
  actor_role text not null check (actor_role in ('admin', 'moderator', 'operator')),
  action text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  request_payload jsonb not null default '{}'::jsonb,
  status text not null default 'processing' check (status in ('processing', 'completed')),
  response_payload jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (withdrawal_id, idempotency_key)
);

create table if not exists public.withdrawal_audit_events (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null references public.wallet_withdrawals(id) on delete restrict,
  transfer_attempt_id uuid references public.withdrawal_transfer_attempts(id) on delete restrict,
  actor_id text not null,
  actor_role text not null,
  action text not null,
  reason text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_login_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  account_hash text not null,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists admin_login_attempts_rate_idx
  on public.admin_login_attempts (ip_hash, account_hash, created_at desc);

create or replace function public.check_and_record_admin_login_attempt(
  p_ip_hash text,
  p_account_hash text,
  p_credentials_valid boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_failures integer;
  v_ip_failures integer;
  v_allowed boolean;
begin
  if p_ip_hash !~ '^[0-9a-f]{64}$'
     or p_account_hash !~ '^[0-9a-f]{64}$'
     or p_credentials_valid is null then
    raise exception 'invalid_login_attempt';
  end if;

  -- Every caller takes locks in the same order, so concurrent requests for an
  -- account/IP cannot all observe the same pre-limit count.
  perform pg_advisory_xact_lock(hashtextextended('login-account:' || p_account_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('login-ip:' || p_ip_hash, 0));

  select count(*)::integer into v_account_failures
  from public.admin_login_attempts
  where account_hash = p_account_hash and not succeeded
    and created_at >= now() - interval '15 minutes';
  select count(*)::integer into v_ip_failures
  from public.admin_login_attempts
  where ip_hash = p_ip_hash and not succeeded
    and created_at >= now() - interval '15 minutes';

  v_allowed := v_account_failures < 5 and v_ip_failures < 10;
  insert into public.admin_login_attempts (ip_hash, account_hash, succeeded)
  values (p_ip_hash, p_account_hash, p_credentials_valid and v_allowed);

  return jsonb_build_object(
    'ok', true,
    'allowed', v_allowed,
    'credentials_valid', p_credentials_valid and v_allowed
  );
end;
$$;

revoke execute on function public.check_and_record_admin_login_attempt(text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.check_and_record_admin_login_attempt(text, text, boolean)
  to service_role;

create table if not exists public.marketplace_dispute_actions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  action text not null check (action in ('refund_buyer', 'release_seller')),
  actor_id text not null,
  actor_role text not null,
  idempotency_key uuid not null,
  result jsonb,
  created_at timestamptz not null default now(),
  unique (order_id, idempotency_key)
);

create table if not exists public.marketplace_order_action_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('ship', 'confirm_received', 'open_dispute')),
  idempotency_key uuid not null,
  request_hash text not null,
  request_payload jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (order_id, idempotency_key)
);

create table if not exists public.admin_subscription_grant_requests (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  actor_id text not null,
  actor_role text not null check (actor_role in ('admin', 'moderator')),
  user_id uuid not null references auth.users(id) on delete restrict,
  package_type text not null check (package_type in ('day_pass', 'credit_pack', 'vip_pro')),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.offer_action_requests (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('accept', 'reject')),
  idempotency_key uuid not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (offer_id, idempotency_key),
  unique (actor_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- 4. RLS/grants: browser clients never write financial truth or read evidence
-- ---------------------------------------------------------------------------

-- Supabase projects often configure permissive public-schema defaults. Make
-- future objects created by this migration owner fail closed as well; every
-- intentional table/function access below is granted explicitly.
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

alter table public.financial_system_state enable row level security;
alter table public.wallet_fund_sources enable row level security;
alter table public.wallet_fund_allocations enable row level security;
alter table public.wallet_reconciliation_records enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.payment_fulfillments enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.scan_credit_consumptions enable row level security;
alter table public.marketplace_order_funding enable row level security;
alter table public.withdrawal_transfer_attempts enable row level security;
alter table public.withdrawal_action_requests enable row level security;
alter table public.withdrawal_audit_events enable row level security;
alter table public.admin_login_attempts enable row level security;
alter table public.marketplace_dispute_actions enable row level security;
alter table public.marketplace_order_action_requests enable row level security;
alter table public.admin_subscription_grant_requests enable row level security;
alter table public.offer_action_requests enable row level security;

revoke all on table public.financial_system_state from public, anon, authenticated;
revoke all on table public.wallet_fund_sources from public, anon, authenticated;
revoke all on table public.wallet_fund_allocations from public, anon, authenticated;
revoke all on table public.wallet_reconciliation_records from public, anon, authenticated;
revoke all on table public.payment_webhook_events from public, anon, authenticated;
revoke all on table public.payment_fulfillments from public, anon, authenticated;
revoke all on table public.user_subscriptions from public, anon, authenticated;
revoke all on table public.scan_credit_consumptions from public, anon, authenticated;
revoke all on table public.marketplace_order_funding from public, anon, authenticated;
revoke all on table public.withdrawal_transfer_attempts from public, anon, authenticated;
revoke all on table public.withdrawal_action_requests from public, anon, authenticated;
revoke all on table public.withdrawal_audit_events from public, anon, authenticated;
revoke all on table public.admin_login_attempts from public, anon, authenticated;
revoke all on table public.marketplace_dispute_actions from public, anon, authenticated;
revoke all on table public.marketplace_order_action_requests from public, anon, authenticated;
revoke all on table public.admin_subscription_grant_requests from public, anon, authenticated;
revoke all on table public.offer_action_requests from public, anon, authenticated;

-- Sensitive evidence and immutable financial truth are accessed by scoped
-- SECURITY DEFINER RPCs, never by ad-hoc service-role table queries.
revoke all on table public.financial_system_state from service_role;
revoke all on table public.wallet_fund_sources from service_role;
revoke all on table public.wallet_fund_allocations from service_role;
revoke all on table public.wallet_reconciliation_records from service_role;
revoke all on table public.payment_webhook_events from service_role;
revoke all on table public.payment_fulfillments from service_role;
revoke all on table public.scan_credit_consumptions from service_role;
revoke all on table public.marketplace_order_funding from service_role;
revoke all on table public.withdrawal_transfer_attempts from service_role;
revoke all on table public.withdrawal_action_requests from service_role;
revoke all on table public.withdrawal_audit_events from service_role;
revoke all on table public.admin_login_attempts from service_role;
revoke all on table public.marketplace_dispute_actions from service_role;
revoke all on table public.marketplace_order_action_requests from service_role;
revoke all on table public.admin_subscription_grant_requests from service_role;
revoke all on table public.offer_action_requests from service_role;

-- Offer state is a checkout authorization input. Browser users may create and
-- view offers but cannot self-promote one to chosen/accepted or mutate price
-- after submission; seller decisions go through the locked RPC below.
drop policy if exists "Buyers can update pending offers" on public.offers;
drop policy if exists "Sellers can update offers for their cards" on public.offers;
revoke update, delete on table public.offers from public, anon, authenticated;

drop policy if exists wallet_fund_sources_owner_select on public.wallet_fund_sources;
create policy wallet_fund_sources_owner_select
  on public.wallet_fund_sources for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists wallet_fund_allocations_owner_select on public.wallet_fund_allocations;
create policy wallet_fund_allocations_owner_select
  on public.wallet_fund_allocations for select to authenticated
  using (auth.uid() = user_id);

-- No direct SELECT grant: owner-facing summaries are returned by a filtered
-- RPC so evidence and cross-table relationships never reach PostgREST clients.

drop policy if exists user_subscriptions_owner_select on public.user_subscriptions;
create policy user_subscriptions_owner_select
  on public.user_subscriptions for select to authenticated
  using (auth.uid() = user_id);
grant select on table public.user_subscriptions to authenticated;

-- payment_orders were client writable. Creation and lifecycle are server/RPC only.
drop policy if exists "own payment orders - insert" on public.payment_orders;
drop policy if exists "own payment orders - update" on public.payment_orders;
revoke insert, update, delete on table public.payment_orders from public, anon, authenticated;
grant select on table public.payment_orders to authenticated;

-- Explicit maintenance enforcement for both old and new mutation paths.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'wallets', 'wallet_transactions', 'wallet_withdrawals', 'payment_orders', 'orders',
    'wallet_fund_sources', 'wallet_fund_allocations',
    'wallet_reconciliation_records', 'marketplace_order_funding',
    'withdrawal_transfer_attempts', 'withdrawal_action_requests',
    'withdrawal_audit_events', 'payment_fulfillments', 'user_subscriptions',
    'scan_credit_consumptions',
    'marketplace_dispute_actions', 'marketplace_order_action_requests',
    'admin_subscription_grant_requests', 'offer_action_requests',
    'cards', 'offers', 'transactions'
  ]
  loop
    execute format('drop trigger if exists financial_maintenance_guard on public.%I', v_table);
    execute format(
      'create trigger financial_maintenance_guard before insert or update or delete on public.%I for each statement execute function public.guard_financial_maintenance()',
      v_table
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Conservation and statement helpers
-- ---------------------------------------------------------------------------

create or replace function public.assert_wallet_fund_integrity(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet public.wallets%rowtype;
  v_verified_available bigint;
  v_verified_held bigint;
  v_unverified_available bigint;
  v_unverified_held bigint;
  v_bad_sources bigint;
  v_bad_allocations bigint;
begin
  select * into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'wallet_not_found';
  end if;

  select coalesce(sum(remaining_amount), 0)::bigint
  into v_verified_available
  from public.wallet_fund_sources
  where user_id = p_user_id and verification_status = 'verified';

  select coalesce(sum(a.amount), 0)::bigint
  into v_verified_held
  from public.wallet_fund_allocations a
  where a.user_id = p_user_id
    and a.purpose_type = 'withdrawal'
    and a.status = 'reserved';

  select count(*) into v_bad_sources
  from public.wallet_fund_sources s
  join public.wallets sw on sw.id = s.wallet_id
  where s.user_id = p_user_id
    and (
      sw.user_id <> s.user_id
      or s.original_amount <> s.remaining_amount + coalesce((
        select sum(a.amount)
        from public.wallet_fund_allocations a
        where a.fund_source_id = s.id and a.status in ('reserved', 'consumed')
      ), 0)
    );

  select count(*) into v_bad_allocations
  from public.wallet_fund_allocations a
  join public.wallet_fund_sources s on s.id = a.fund_source_id
  where (a.user_id = p_user_id or s.user_id = p_user_id)
    and a.user_id <> s.user_id;

  v_unverified_available := v_wallet.available_balance - v_verified_available;
  v_unverified_held := v_wallet.held_balance - v_verified_held;

  if v_unverified_available < 0
     or v_unverified_held < 0
     or v_bad_sources > 0
     or v_bad_allocations > 0 then
    raise exception 'wallet_fund_integrity_failed'
      using detail = jsonb_build_object(
        'user_id', p_user_id,
        'unverified_available', v_unverified_available,
        'unverified_held', v_unverified_held,
        'bad_sources', v_bad_sources,
        'bad_allocations', v_bad_allocations
      )::text;
  end if;

  return jsonb_build_object(
    'stored_available', v_wallet.available_balance,
    'stored_held', v_wallet.held_balance,
    'stored_total', v_wallet.available_balance + v_wallet.held_balance,
    'verified_available', v_verified_available,
    'verified_held', v_verified_held,
    'verified_total', v_verified_available + v_verified_held,
    'unverified_available', v_unverified_available,
    'unverified_held', v_unverified_held,
    'unverified_total', v_unverified_available + v_unverified_held
  );
end;
$$;

revoke execute on function public.assert_financial_mutations_enabled() from public, anon, authenticated;
revoke execute on function public.guard_financial_maintenance() from public, anon, authenticated;
revoke execute on function public.assert_wallet_fund_integrity(uuid) from public, anon, authenticated;
grant execute on function public.assert_wallet_fund_integrity(uuid) to service_role;

-- ---------------------------------------------------------------------------
