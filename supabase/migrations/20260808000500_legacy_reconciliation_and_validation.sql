-- Withdrawal verification and verified-fund provenance.
-- Phase 5/5: statements, legacy reconciliation, cutover and final validation.

-- 8. Statement, maintenance and fail-closed legacy cutover helpers
-- ---------------------------------------------------------------------------

create or replace function public.get_my_wallet_fund_statement()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_balances jsonb;
begin
  if v_user_id is null then
    raise exception 'unauthorized';
  end if;

  v_balances := public.assert_wallet_fund_integrity(v_user_id);
  return jsonb_build_object(
    'balances', v_balances,
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'source_type', s.source_type,
        'source_id', s.source_id,
        'original_amount', s.original_amount,
        'remaining_amount', s.remaining_amount,
        'verification_status', s.verification_status,
        'occurred_at', s.occurred_at
      ) order by s.occurred_at desc, s.id desc)
      from public.wallet_fund_sources s
      where s.user_id = v_user_id
    ), '[]'::jsonb),
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'purpose_type', a.purpose_type,
        'purpose_id', a.purpose_id,
        'amount', a.amount,
        'status', a.status,
        'created_at', a.created_at
      ) order by a.created_at desc, a.id desc)
      from public.wallet_fund_allocations a
      where a.user_id = v_user_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_wallet_withdrawal_statement(p_withdrawal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_withdrawal public.wallet_withdrawals%rowtype;
  v_balances jsonb;
begin
  select * into v_withdrawal
  from public.wallet_withdrawals
  where id = p_withdrawal_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_balances := public.assert_wallet_fund_integrity(v_withdrawal.user_id);

  return jsonb_build_object(
    'ok', true,
    'withdrawal', jsonb_build_object(
      'id', v_withdrawal.id,
      'user_id', v_withdrawal.user_id,
      'amount_requested', v_withdrawal.amount_requested,
      'fee', v_withdrawal.fee,
      'amount_net', v_withdrawal.amount_net,
      'currency', v_withdrawal.currency,
      'status', v_withdrawal.status,
      'funding_state', v_withdrawal.funding_state,
      'bank_name', v_withdrawal.bank_name,
      'bank_account_name', v_withdrawal.bank_account_name,
      'bank_account_masked', coalesce(v_withdrawal.bank_account_masked,
        public.mask_bank_account(v_withdrawal.bank_account_number)),
      'created_at', v_withdrawal.created_at,
      'processed_at', v_withdrawal.processed_at,
      'processing_expires_at', v_withdrawal.processing_expires_at,
      'claimed_by', v_withdrawal.claimed_by,
      'transfer_started_at', v_withdrawal.transfer_started_at,
      'active_transfer_attempt_id', v_withdrawal.active_transfer_attempt_id,
      'recovery_required', v_withdrawal.recovery_required,
      'recovery_reason', v_withdrawal.recovery_reason,
      'risk_flags', v_withdrawal.risk_flags
    ),
    'user', coalesce((
      select jsonb_build_object(
        'id', p.id, 'email', p.email, 'display_name', p.display_name
      ) from public.profiles p where p.id = v_withdrawal.user_id
    ), '{}'::jsonb),
    'kyc', coalesce((
      select jsonb_build_object(
        'status', k.status,
        'full_name', k.full_name,
        'bank_verified_at', k.bank_verified_at,
        'bank_name', k.bank_name,
        'bank_bin', k.bank_bin,
        'bank_account_name_verified', k.bank_account_name_verified,
        'bank_account_masked', public.mask_bank_account(k.bank_account_number)
      ) from public.seller_verifications k where k.user_id = v_withdrawal.user_id
    ), '{}'::jsonb),
    'balances', v_balances,
    'totals', jsonb_build_object(
      'deposits', (select coalesce(sum(original_amount), 0) from public.wallet_fund_sources
        where user_id = v_withdrawal.user_id and source_type = 'payos_deposit'),
      'sales', (select coalesce(sum(original_amount), 0) from public.wallet_fund_sources
        where user_id = v_withdrawal.user_id and source_type = 'marketplace_sale'),
      'refunds', (select coalesce(sum(original_amount), 0) from public.wallet_fund_sources
        where user_id = v_withdrawal.user_id and source_type in ('refund', 'withdrawal_return')),
      'legacy_reconciled', (select coalesce(sum(original_amount), 0) from public.wallet_fund_sources
        where user_id = v_withdrawal.user_id and source_type = 'legacy_reconciliation'),
      'spending', (select coalesce(sum(amount), 0) from public.wallet_fund_allocations
        where user_id = v_withdrawal.user_id and purpose_type = 'wallet_purchase'
          and status = 'consumed'),
      'withdrawals_completed', (select coalesce(sum(amount), 0) from public.wallet_fund_allocations
        where user_id = v_withdrawal.user_id and purpose_type = 'withdrawal'
          and status = 'consumed'),
      'withdrawals_held', (select coalesce(sum(amount), 0) from public.wallet_fund_allocations
        where user_id = v_withdrawal.user_id and purpose_type = 'withdrawal'
          and status = 'reserved')
    ),
    'reconciliation', jsonb_build_object(
      'funding_state', v_withdrawal.funding_state,
      'legacy_source_count', (select count(*) from public.wallet_fund_sources
        where user_id = v_withdrawal.user_id and source_type = 'legacy_reconciliation'),
      'unverified_available', (v_balances ->> 'unverified_available')::bigint,
      'unverified_held', (v_balances ->> 'unverified_held')::bigint,
      'unresolved_unverified_total', (v_balances ->> 'unverified_total')::bigint
    ),
    'blockers', coalesce(v_withdrawal.risk_flags, '[]'::jsonb)
      || case when v_withdrawal.funding_state like 'legacy_%'
        then jsonb_build_array(jsonb_build_object(
          'code', 'legacy_funding_review_required', 'state', v_withdrawal.funding_state
        )) else '[]'::jsonb end
      || case when v_withdrawal.recovery_required
        then jsonb_build_array(jsonb_build_object(
          'code', 'transfer_recovery_required', 'reason', v_withdrawal.recovery_reason
        )) else '[]'::jsonb end,
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'source_type', s.source_type, 'source_id', s.source_id,
        'original_amount', s.original_amount,
        'remaining_amount', s.remaining_amount,
        'verification_status', s.verification_status,
        'credits_wallet', s.credits_wallet,
        'occurred_at', s.occurred_at
      ) order by s.occurred_at, s.id)
      from public.wallet_fund_sources s
      where s.user_id = v_withdrawal.user_id
    ), '[]'::jsonb),
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'fund_source_id', a.fund_source_id,
        'purpose_type', a.purpose_type, 'purpose_id', a.purpose_id,
        'amount', a.amount, 'status', a.status, 'created_at', a.created_at
      ) order by a.created_at, a.id)
      from public.wallet_fund_allocations a
      where a.user_id = v_withdrawal.user_id
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'type', t.type, 'amount', t.amount,
        'balance_after', t.balance_after, 'description', t.description,
        'reference_id', t.reference_id, 'created_at', t.created_at
      ) order by t.created_at desc, t.id desc)
      from public.wallet_transactions t
      where t.user_id = v_withdrawal.user_id
    ), '[]'::jsonb),
    'transfer_attempts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'status', a.status,
        'amount_requested', a.amount_requested, 'fee_amount', a.fee_amount,
        'amount_net', a.amount_net, 'currency', a.currency,
        'destination_bank_name', a.destination_bank_name,
        'destination_account_name', a.destination_account_name,
        'destination_account_masked', a.destination_account_masked,
        'started_by', a.started_by, 'started_at', a.started_at,
        'transfer_reference', a.transfer_reference,
        'completed_at', a.completed_at,
        'failure_reason', a.failure_reason,
        'return_reference', a.return_reference,
        'returned_at', a.returned_at,
        'recovery_required', a.recovery_required
      ) order by a.started_at desc, a.id desc)
      from public.withdrawal_transfer_attempts a
      where a.withdrawal_id = v_withdrawal.id
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'actor_id', e.actor_id, 'actor_role', e.actor_role,
        'action', e.action, 'reason', e.reason, 'created_at', e.created_at
      ) order by e.created_at desc, e.id desc)
      from public.withdrawal_audit_events e
      where e.withdrawal_id = v_withdrawal.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_financial_maintenance(
  p_active boolean,
  p_actor text,
  p_reason text,
  p_cutoff_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state public.financial_system_state%rowtype;
begin
  if coalesce(trim(p_actor), '') = '' or coalesce(trim(p_reason), '') = '' then
    raise exception 'maintenance_actor_and_reason_required';
  end if;

  update public.financial_system_state
  set maintenance_active = p_active,
      cutoff_at = case when p_active then coalesce(p_cutoff_at, now()) else cutoff_at end,
      generation = generation + 1,
      reason = trim(p_reason),
      changed_by = trim(p_actor),
      changed_at = now()
  where singleton
  returning * into v_state;

  return to_jsonb(v_state);
end;
$$;

create or replace function public.get_financial_cutover_inventory()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'state', (
      select jsonb_build_object(
        'maintenance_active', s.maintenance_active,
        'cutoff_at', s.cutoff_at,
        'generation', s.generation,
        'reason', s.reason,
        'changed_by', s.changed_by
      )
      from public.financial_system_state s where s.singleton
    ),
    'wallets', (select count(*) from public.wallets),
    'openWithdrawals', (
      select count(*) from public.wallet_withdrawals
      where status in ('pending', 'processing')
    ),
    'openOrders', (
      select count(*) from public.orders
      where status in ('paid', 'shipping', 'delivered', 'disputed')
    ),
    'deferredWebhooks', (
      select count(*) from public.payment_webhook_events where status = 'deferred'
    ),
    'reviewWebhooks', (
      select count(*) from public.payment_webhook_events where status = 'review_required'
    )
  );
$$;

create or replace function public.reconcile_legacy_wallet_fund(
  p_user_id uuid,
  p_amount bigint,
  p_evidence_type text,
  p_evidence_reference text,
  p_reason text,
  p_idempotency_key uuid,
  p_actor text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet public.wallets%rowtype;
  v_existing public.wallet_reconciliation_records%rowtype;
  v_verified_available bigint;
  v_verified_held bigint;
  v_unresolved bigint;
  v_record_id uuid;
  v_source_id uuid;
  v_previous_bypass text;
begin
  if p_amount is null or p_amount <= 0
     or p_idempotency_key is null
     or coalesce(trim(p_evidence_type), '') = ''
     or coalesce(trim(p_evidence_reference), '') = ''
     or coalesce(trim(p_reason), '') = ''
     or coalesce(trim(p_actor), '') = '' then
    raise exception 'invalid_reconciliation_request';
  end if;

  v_previous_bypass := current_setting('cardverse.maintenance_bypass', true);
  perform set_config('cardverse.maintenance_bypass', 'on', true);

  select * into v_existing
  from public.wallet_reconciliation_records
  where idempotency_key = p_idempotency_key
     or (user_id = p_user_id
       and evidence_type = p_evidence_type
       and evidence_reference = p_evidence_reference)
  for update;

  if found then
    if v_existing.amount <> p_amount or v_existing.user_id <> p_user_id then
      raise exception 'reconciliation_idempotency_conflict';
    end if;
    perform set_config('cardverse.maintenance_bypass', coalesce(v_previous_bypass, ''), true);
    return jsonb_build_object('ok', true, 'replayed', true,
      'record_id', v_existing.id);
  end if;

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
  where a.user_id = p_user_id and a.purpose_type = 'withdrawal'
    and a.status = 'reserved';

  -- This function reclassifies currently available money. Held legacy money is
  -- resolved through the open-withdrawal recovery path so it can be created as
  -- an immediately reserved source rather than masquerading as available.
  v_unresolved := v_wallet.available_balance - v_verified_available;
  if p_amount > v_unresolved then
    raise exception 'reconciliation_exceeds_unverified_balance';
  end if;

  insert into public.wallet_reconciliation_records (
    user_id, wallet_id, amount, evidence_type, evidence_reference,
    reason, idempotency_key, created_by
  ) values (
    p_user_id, v_wallet.id, p_amount, trim(p_evidence_type),
    trim(p_evidence_reference), trim(p_reason), p_idempotency_key, trim(p_actor)
  ) returning id into v_record_id;

  insert into public.wallet_fund_sources (
    user_id, wallet_id, source_type, source_id, original_amount,
    remaining_amount, verification_status, credits_wallet, evidence, occurred_at
  ) values (
    p_user_id, v_wallet.id, 'legacy_reconciliation', v_record_id::text,
    p_amount, p_amount, 'verified', false,
    coalesce(p_evidence, '{}'::jsonb) || jsonb_build_object(
      'evidence_type', trim(p_evidence_type),
      'evidence_reference', trim(p_evidence_reference),
      'reason', trim(p_reason)
    ),
    coalesce(nullif(p_evidence ->> 'occurred_at', '')::timestamptz, now())
  ) returning id into v_source_id;

  -- Reclassification only: intentionally no wallet UPDATE and no positive
  -- balance-affecting wallet transaction.
  perform public.assert_wallet_fund_integrity(p_user_id);
  perform set_config('cardverse.maintenance_bypass', coalesce(v_previous_bypass, ''), true);
  return jsonb_build_object('ok', true, 'replayed', false,
    'record_id', v_record_id, 'fund_source_id', v_source_id);
end;
$$;

-- Replay one user's independently evidenced legacy history as a single
-- transaction. Credit rows classify money that is already present in the
-- stored wallet (credits_wallet=false); completed debits consume those sources
-- FIFO. Open withdrawals are deliberately rejected here and are reserved only
-- by classify_open_financial_records(), so no withdrawal can be both consumed
-- and reserved during cutover.
create or replace function public.replay_legacy_wallet_history(
  p_user_id uuid,
  p_events jsonb,
  p_batch_id uuid,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet public.wallets%rowtype;
  v_event jsonb;
  v_event_type text;
  v_source_type text;
  v_source_id text;
  v_purpose_type text;
  v_purpose_id text;
  v_amount bigint;
  v_occurred_at timestamptz;
  v_existing_source public.wallet_fund_sources%rowtype;
  v_source public.wallet_fund_sources%rowtype;
  v_existing_amount bigint;
  v_remaining bigint;
  v_take bigint;
  v_key uuid;
  v_credits integer := 0;
  v_debits integer := 0;
  v_open_withdrawals integer := 0;
  v_previous_bypass text;
begin
  if p_user_id is null or p_batch_id is null
     or coalesce(trim(p_actor), '') = ''
     or p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'invalid_legacy_replay_request';
  end if;

  v_previous_bypass := current_setting('cardverse.maintenance_bypass', true);
  perform set_config('cardverse.maintenance_bypass', 'on', true);
  select * into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;
  if not found then raise exception 'wallet_not_found'; end if;

  -- Open withdrawals are injected into the same chronological stream. This is
  -- what prevents a later completed debit from consuming money that was
  -- already held by an earlier withdrawal request.
  for v_event in
    select event
    from (
      select value as event
      from jsonb_array_elements(p_events)
      union all
      select jsonb_build_object(
        'event_type', 'open_withdrawal',
        'purpose_type', 'withdrawal',
        'purpose_id', w.id,
        'amount', w.amount_requested,
        'occurred_at', w.created_at,
        'status', w.status,
        'sequence', 0
      )
      from public.wallet_withdrawals w
      where w.user_id = p_user_id and w.status in ('pending', 'processing')
    ) replay_events
    order by (event ->> 'occurred_at')::timestamptz,
             case when event ->> 'event_type' = 'credit' then 0 else 1 end,
             coalesce((event ->> 'sequence')::bigint, 0),
             event ->> 'purpose_id'
  loop
    v_event_type := v_event ->> 'event_type';
    v_amount := (v_event ->> 'amount')::bigint;
    v_occurred_at := (v_event ->> 'occurred_at')::timestamptz;
    if v_amount is null or v_amount <= 0 or v_occurred_at is null then
      raise exception 'invalid_legacy_replay_event';
    end if;

    if v_event_type = 'credit' then
      v_source_type := v_event ->> 'source_type';
      v_source_id := nullif(trim(v_event ->> 'source_id'), '');
      if v_source_type not in ('payos_deposit', 'marketplace_sale', 'refund')
         or v_source_id is null then
        raise exception 'invalid_legacy_credit';
      end if;

      select * into v_existing_source
      from public.wallet_fund_sources
      where user_id = p_user_id
        and source_type = v_source_type
        and source_id = v_source_id
      for update;
      if found then
        if v_existing_source.original_amount <> v_amount
           or v_existing_source.occurred_at <> v_occurred_at
           or v_existing_source.verification_status <> 'verified' then
          raise exception 'legacy_credit_idempotency_conflict';
        end if;
      else
        insert into public.wallet_fund_sources (
          user_id, wallet_id, source_type, source_id, original_amount,
          remaining_amount, verification_status, credits_wallet, evidence,
          occurred_at
        ) values (
          p_user_id, v_wallet.id, v_source_type, v_source_id, v_amount,
          v_amount, 'verified', false,
          coalesce(v_event -> 'evidence', '{}'::jsonb) || jsonb_build_object(
            'legacy_replay_batch_id', p_batch_id,
            'replayed_by', trim(p_actor)
          ),
          v_occurred_at
        );
        v_credits := v_credits + 1;
      end if;
    elsif v_event_type in ('debit', 'open_withdrawal') then
      v_purpose_type := v_event ->> 'purpose_type';
      v_purpose_id := nullif(trim(v_event ->> 'purpose_id'), '');
      if v_purpose_type not in ('wallet_purchase', 'withdrawal')
         or v_purpose_id is null
         or (v_event_type = 'debit' and coalesce(v_event ->> 'status', 'consumed') <> 'consumed') then
        raise exception 'invalid_legacy_completed_debit';
      end if;

      if v_event_type = 'debit' and v_purpose_type = 'withdrawal' and exists (
        select 1 from public.wallet_withdrawals w
        where w.id::text = v_purpose_id and w.status <> 'completed'
      ) then
        raise exception 'open_withdrawal_must_be_reserved_not_consumed';
      end if;

      select coalesce(sum(amount), 0)::bigint into v_existing_amount
      from public.wallet_fund_allocations
      where user_id = p_user_id
        and purpose_type = v_purpose_type
        and purpose_id = v_purpose_id
        and status = case when v_event_type = 'open_withdrawal' then 'reserved' else 'consumed' end;
      if v_existing_amount > 0 then
        if v_existing_amount <> v_amount then
          if v_event_type = 'debit' then
            raise exception 'legacy_debit_idempotency_conflict';
          end if;
          -- A partially backed open withdrawal resumes from its existing
          -- reservation when more approved evidence is replayed later.
          v_remaining := v_amount - v_existing_amount;
        else
          continue;
        end if;
      else
        v_remaining := v_amount;
      end if;

      while v_remaining > 0 loop
        select * into v_source
        from public.wallet_fund_sources
        where user_id = p_user_id
          and verification_status = 'verified'
          and remaining_amount > 0
          and occurred_at <= v_occurred_at
        order by occurred_at, id
        for update
        limit 1;
        if not found and v_event_type = 'debit' then
          raise exception 'legacy_replay_unbacked_debit'
            using detail = jsonb_build_object(
              'purpose_type', v_purpose_type,
              'purpose_id', v_purpose_id,
              'remaining', v_remaining
            )::text;
        elsif not found then
          exit;
        end if;

        v_take := least(v_remaining, v_source.remaining_amount);
        v_key := public.stable_financial_uuid(
          'legacy-replay:' || p_batch_id::text || ':' || v_purpose_type || ':' ||
          v_purpose_id || ':' || v_source.id::text
        );
        update public.wallet_fund_sources
        set remaining_amount = remaining_amount - v_take, updated_at = now()
        where id = v_source.id;
        insert into public.wallet_fund_allocations (
          fund_source_id, user_id, purpose_type, purpose_id, amount, status,
          idempotency_key, group_idempotency_key, occurred_at, consumed_at
        ) values (
          v_source.id, p_user_id, v_purpose_type, v_purpose_id, v_take,
          case when v_event_type = 'open_withdrawal' then 'reserved' else 'consumed' end,
          v_key,
          public.stable_financial_uuid('legacy-replay-purpose:' || v_purpose_type || ':' || v_purpose_id),
          v_occurred_at,
          case when v_event_type = 'open_withdrawal' then null else v_occurred_at end
        );
        v_remaining := v_remaining - v_take;
      end loop;

      if v_event_type = 'open_withdrawal' then
        update public.wallet_withdrawals
        set funding_state = case
              when v_remaining > 0 then 'legacy_blocked'
              when status = 'processing' then 'legacy_transfer_review_required'
              else 'backfilled_verified'
            end,
            recovery_required = v_remaining > 0 or status = 'processing',
            recovery_reason = case
              when v_remaining > 0 then 'legacy_withdrawal_underfunded'
              when status = 'processing' then 'legacy_processing_requires_bank_review'
              else null
            end
        where id::text = v_purpose_id;
        v_open_withdrawals := v_open_withdrawals + 1;
      else
        v_debits := v_debits + 1;
      end if;
    else
      raise exception 'unknown_legacy_replay_event_type';
    end if;
  end loop;

  perform public.assert_wallet_fund_integrity(p_user_id);
  perform set_config('cardverse.maintenance_bypass', coalesce(v_previous_bypass, ''), true);
  return jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'batch_id', p_batch_id,
    'credits_created', v_credits,
    'completed_debits_created', v_debits,
    'open_withdrawals_reserved', v_open_withdrawals
  );
end;
$$;

create or replace function public.classify_open_financial_records(p_cutoff_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_withdrawal public.wallet_withdrawals%rowtype;
  v_order public.orders%rowtype;
  v_source public.wallet_fund_sources%rowtype;
  v_remaining bigint;
  v_take bigint;
  v_reserved bigint;
  v_withdrawals integer := 0;
  v_orders integer := 0;
  v_previous_bypass text;
begin
  if p_cutoff_at is null then
    raise exception 'cutoff_required';
  end if;
  v_previous_bypass := current_setting('cardverse.maintenance_bypass', true);
  perform set_config('cardverse.maintenance_bypass', 'on', true);

  -- Pending/processing withdrawals are reservations only. Completed rows are
  -- never replayed here; rejected/cancelled rows receive no active allocation.
  for v_withdrawal in
    select * from public.wallet_withdrawals
    where created_at <= p_cutoff_at and status in ('pending', 'processing')
    order by created_at, id
    for update
  loop
    if exists (
      select 1 from public.wallet_fund_allocations
      where purpose_type = 'withdrawal'
        and purpose_id = v_withdrawal.id::text
        and status = 'consumed'
    ) then
      update public.wallet_withdrawals
      set funding_state = 'legacy_blocked', recovery_required = true,
          recovery_reason = 'withdrawal_consumed_and_open'
      where id = v_withdrawal.id;
      continue;
    end if;

    select coalesce(sum(amount), 0)::bigint into v_reserved
    from public.wallet_fund_allocations
    where purpose_type = 'withdrawal'
      and purpose_id = v_withdrawal.id::text
      and status = 'reserved';
    v_remaining := v_withdrawal.amount_requested - v_reserved;

    while v_remaining > 0 loop
      select * into v_source
      from public.wallet_fund_sources
      where user_id = v_withdrawal.user_id
        and verification_status = 'verified'
        and remaining_amount > 0
        and occurred_at <= v_withdrawal.created_at
      order by occurred_at, id
      for update
      limit 1;
      exit when not found;

      v_take := least(v_remaining, v_source.remaining_amount);
      update public.wallet_fund_sources
      set remaining_amount = remaining_amount - v_take, updated_at = now()
      where id = v_source.id;
      insert into public.wallet_fund_allocations (
        fund_source_id, user_id, purpose_type, purpose_id, amount, status,
        idempotency_key, group_idempotency_key
      ) values (
        v_source.id, v_withdrawal.user_id, 'withdrawal', v_withdrawal.id::text,
        v_take, 'reserved', public.stable_financial_uuid(
          'legacy-open-withdrawal:' || v_withdrawal.id::text || ':' || v_source.id::text
        ), public.stable_financial_uuid('legacy-open-withdrawal:' || v_withdrawal.id::text)
      );
      v_remaining := v_remaining - v_take;
    end loop;

    update public.wallet_withdrawals
    set funding_state = case
          when v_remaining = 0 then 'backfilled_verified'
          else 'legacy_blocked'
        end,
        recovery_required = v_remaining > 0,
        recovery_reason = case when v_remaining > 0 then 'legacy_withdrawal_underfunded' else null end,
        status = case when status = 'processing' then 'processing' else status end
    where id = v_withdrawal.id;

    if v_withdrawal.status = 'processing' then
      update public.wallet_withdrawals
      set funding_state = 'legacy_transfer_review_required',
          recovery_required = true,
          recovery_reason = 'legacy_processing_requires_bank_review'
      where id = v_withdrawal.id;
    end if;
    v_withdrawals := v_withdrawals + 1;
  end loop;

  with to_release as (
    select a.fund_source_id, sum(a.amount)::bigint as amount
    from public.wallet_fund_allocations a
    join public.wallet_withdrawals w on a.purpose_id = w.id::text
    where a.purpose_type = 'withdrawal'
      and a.status = 'reserved'
      and w.created_at <= p_cutoff_at
      and w.status = 'rejected'
    group by a.fund_source_id
  )
  update public.wallet_fund_sources s
  set remaining_amount = s.remaining_amount + r.amount,
      updated_at = now()
  from to_release r
  where s.id = r.fund_source_id;

  update public.wallet_fund_allocations a
  set status = 'released', released_at = coalesce(released_at, now())
  from public.wallet_withdrawals w
  where a.purpose_type = 'withdrawal'
    and a.purpose_id = w.id::text
    and a.status = 'reserved'
    and w.created_at <= p_cutoff_at
    and w.status = 'rejected';

  for v_order in
    select * from public.orders
    where created_at <= p_cutoff_at
      and status in ('paid', 'shipping', 'delivered', 'disputed')
    order by created_at, id
    for update
  loop
    if v_order.payment_method = 'wallet' then
      select coalesce(sum(a.amount), 0)::bigint into v_reserved
      from public.wallet_fund_allocations a
      where a.purpose_type = 'wallet_purchase'
        and a.purpose_id = v_order.id::text
        and a.status = 'consumed';
    else
      select case when exists (
        select 1
        from public.payment_orders p
        join public.payment_webhook_events e
          on e.order_code = p.order_code
         and e.status = 'processed'
         and e.signature_verified
         and e.event_code = '00'
         and e.amount = p.amount
        where p.id = v_order.payment_order_id
          and p.user_id = v_order.buyer_id
          and p.amount = v_order.total_paid
      ) then v_order.total_paid else 0 end
      into v_reserved;
    end if;

    if exists (
      select 1 from public.marketplace_order_funding f
      where f.order_id = v_order.id
        and (f.buyer_id <> v_order.buyer_id
          or f.seller_id <> v_order.seller_id
          or f.gross_amount <> v_order.total_paid
          or f.funding_method <> v_order.payment_method)
    ) then
      raise exception 'open_order_funding_identity_conflict';
    end if;

    insert into public.marketplace_order_funding (
      order_id, buyer_id, seller_id, funding_method, gross_amount,
      verified_amount, unverified_amount, classification, payment_order_id,
      cutoff_at, evidence
    ) values (
      v_order.id, v_order.buyer_id, v_order.seller_id, v_order.payment_method,
      v_order.total_paid, least(v_reserved, v_order.total_paid),
      v_order.total_paid - least(v_reserved, v_order.total_paid),
      case
        when v_order.status = 'disputed' then 'disputed_frozen'
        when v_reserved >= v_order.total_paid then 'backfilled_verified_escrow'
        else 'legacy_escrow_blocked'
      end,
      v_order.payment_order_id, p_cutoff_at,
      jsonb_build_object('cutoff_classification', true)
    )
    on conflict (order_id) do update
    set verified_amount = greatest(
          public.marketplace_order_funding.verified_amount,
          excluded.verified_amount
        ),
        unverified_amount = public.marketplace_order_funding.gross_amount - greatest(
          public.marketplace_order_funding.verified_amount,
          excluded.verified_amount
        ),
        classification = case
          when public.marketplace_order_funding.classification in (
            'released', 'cancelled', 'disputed_frozen'
          ) then public.marketplace_order_funding.classification
          when greatest(
            public.marketplace_order_funding.verified_amount,
            excluded.verified_amount
          ) >= public.marketplace_order_funding.gross_amount
            then 'backfilled_verified_escrow'
          else 'legacy_escrow_blocked'
        end,
        payment_order_id = coalesce(
          public.marketplace_order_funding.payment_order_id,
          excluded.payment_order_id
        ),
        cutoff_at = excluded.cutoff_at,
        evidence = public.marketplace_order_funding.evidence || excluded.evidence,
        updated_at = now();
    v_orders := v_orders + 1;
  end loop;

  perform set_config('cardverse.maintenance_bypass', coalesce(v_previous_bypass, ''), true);
  return jsonb_build_object('ok', true,
    'withdrawals_classified', v_withdrawals,
    'orders_classified', v_orders);
end;
$$;

create or replace function public.wallet_fund_integrity_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
begin
  v_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  if v_user_id is not null then
    perform public.assert_wallet_fund_integrity(v_user_id);
  end if;
  return null;
end;
$$;

revoke execute on function public.wallet_fund_integrity_trigger() from public, anon, authenticated;

drop trigger if exists wallet_fund_sources_integrity on public.wallet_fund_sources;
create constraint trigger wallet_fund_sources_integrity
after insert or update or delete on public.wallet_fund_sources
deferrable initially deferred
for each row execute function public.wallet_fund_integrity_trigger();

drop trigger if exists wallet_fund_allocations_integrity on public.wallet_fund_allocations;
create constraint trigger wallet_fund_allocations_integrity
after insert or update or delete on public.wallet_fund_allocations
deferrable initially deferred
for each row execute function public.wallet_fund_integrity_trigger();

drop trigger if exists wallets_fund_integrity on public.wallets;
create constraint trigger wallets_fund_integrity
after insert or update on public.wallets
deferrable initially deferred
for each row execute function public.wallet_fund_integrity_trigger();

revoke execute on function public.get_my_wallet_fund_statement() from public, anon;
revoke execute on function public.get_wallet_withdrawal_statement(uuid) from public, anon, authenticated;
revoke execute on function public.set_financial_maintenance(boolean, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.get_financial_cutover_inventory() from public, anon, authenticated;
revoke execute on function public.reconcile_legacy_wallet_fund(uuid, bigint, text, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.replay_legacy_wallet_history(uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke execute on function public.classify_open_financial_records(timestamptz) from public, anon, authenticated;

grant execute on function public.get_my_wallet_fund_statement() to authenticated;
grant execute on function public.get_wallet_withdrawal_statement(uuid) to service_role;
grant execute on function public.set_financial_maintenance(boolean, text, text, timestamptz) to service_role;
grant execute on function public.get_financial_cutover_inventory() to service_role;
grant execute on function public.reconcile_legacy_wallet_fund(uuid, bigint, text, text, text, uuid, text, jsonb) to service_role;
grant execute on function public.replay_legacy_wallet_history(uuid, jsonb, uuid, text) to service_role;
grant execute on function public.classify_open_financial_records(timestamptz) to service_role;

create or replace function public.complete_delivered_orders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_order record;
  v_done integer := 0;
begin
  perform public.assert_financial_mutations_enabled();

  if v_user_id is null and not v_is_service then
    raise exception 'unauthorized';
  end if;

  for v_order in
    select o.id, o.buyer_id, o.seller_id, o.card_id
    from public.orders o
    join public.marketplace_order_funding f on f.order_id = o.id
    where o.status in ('shipping', 'delivered')
      and o.auto_complete_at is not null
      and o.auto_complete_at < now()
      and o.buyer_confirmed_at is null
      and (v_is_service or o.seller_id = v_user_id)
      and f.verified_amount = o.total_paid
      and f.classification in ('native_verified_escrow', 'backfilled_verified_escrow')
    order by o.auto_complete_at, o.id
    for update of o skip locked
  loop
    update public.orders
    set status = 'disputed',
        dispute_reason = coalesce(
          dispute_reason,
          'Automatic review: buyer confirmation is overdue; an administrator must verify delivery status.'
        ),
        updated_at = now()
    where id = v_order.id and status in ('shipping', 'delivered');
    if not found then
      continue;
    end if;

    update public.marketplace_order_funding
    set classification = 'disputed_frozen', updated_at = now()
    where order_id = v_order.id;
    insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
    values
      (v_order.buyer_id, 'order_disputed', 'Order under review',
       'Receipt was not confirmed in time, so the order was sent for administrator review. The funds remain safely held.',
       v_order.card_id, v_order.id, false),
      (v_order.seller_id, 'order_disputed', 'Order under review',
       'The buyer has not confirmed receipt. An administrator will review the order before releasing payment.',
       v_order.card_id, v_order.id, false);
    v_done := v_done + 1;
  end loop;

  return v_done;
end;
$$;

revoke execute on function public.complete_delivered_orders() from public, anon;
grant execute on function public.complete_delivered_orders() to authenticated, service_role;

notify pgrst, 'reload schema';
