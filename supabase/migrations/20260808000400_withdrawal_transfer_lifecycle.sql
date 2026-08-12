-- Withdrawal verification and verified-fund provenance.
-- Phase 4/5: withdrawal request, statement claim and transfer lifecycle.

-- 7. Verified withdrawal request and admin transfer state machine
-- ---------------------------------------------------------------------------

create or replace function public.mask_bank_account(p_account text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_account is null or length(trim(p_account)) < 4 then '••••'
    else '••••' || right(trim(p_account), 4)
  end;
$$;

update public.wallet_withdrawals
set bank_account_masked = public.mask_bank_account(bank_account_number)
where bank_account_masked is null;

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
  v_user_id uuid := auth.uid();
  v_wallet public.wallets%rowtype;
  v_kyc public.seller_verifications%rowtype;
  v_existing public.wallet_withdrawals%rowtype;
  v_withdrawal_id uuid := gen_random_uuid();
  v_fee bigint;
  v_net bigint;
  v_verified_available bigint;
  v_remaining bigint;
  v_source public.wallet_fund_sources%rowtype;
  v_take bigint;
  v_allocation_key uuid;
  v_request_hash text;
begin
  perform public.assert_financial_mutations_enabled();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if p_request_idempotency_key is null then
    return jsonb_build_object('ok', false, 'error', 'idempotency_key_required');
  end if;
  if p_amount is null or p_amount < 50000 then
    return jsonb_build_object('ok', false, 'error', 'amount_too_low');
  end if;

  v_request_hash := jsonb_build_object(
    'version', 1,
    'user_id', v_user_id,
    'amount', p_amount,
    'currency', 'VND'
  )::text;

  select * into v_existing
  from public.wallet_withdrawals
  where user_id = v_user_id
    and request_idempotency_key = p_request_idempotency_key
  for update;

  if found then
    if v_existing.request_hash <> v_request_hash then
      return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'withdrawal_id', v_existing.id,
      'status', v_existing.status,
      'amount_requested', v_existing.amount_requested,
      'fee', v_existing.fee,
      'amount_net', v_existing.amount_net
    );
  end if;

  select * into v_kyc
  from public.seller_verifications
  where user_id = v_user_id
    and status = 'approved'
    and bank_verified_at is not null;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'kyc_or_bank_not_verified');
  end if;
  if coalesce(trim(v_kyc.bank_name), '') = ''
     or coalesce(trim(v_kyc.bank_account_number), '') = ''
     or coalesce(trim(v_kyc.bank_account_name_verified), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_bank');
  end if;

  perform public.ensure_wallet_for_user(v_user_id);
  select * into v_wallet
  from public.wallets
  where user_id = v_user_id
  for update;

  -- Re-check after the per-user wallet lock. Concurrent requests with the same
  -- key now serialize and return the first result instead of racing the unique
  -- index or reserving a second set of sources.
  select * into v_existing
  from public.wallet_withdrawals
  where user_id = v_user_id
    and request_idempotency_key = p_request_idempotency_key
  for update;
  if found then
    if v_existing.request_hash <> v_request_hash then
      return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'replayed', true,
      'withdrawal_id', v_existing.id, 'status', v_existing.status,
      'amount_requested', v_existing.amount_requested,
      'fee', v_existing.fee, 'amount_net', v_existing.amount_net
    );
  end if;

  select coalesce(sum(remaining_amount), 0)::bigint
  into v_verified_available
  from public.wallet_fund_sources
  where user_id = v_user_id and verification_status = 'verified';

  if v_wallet.available_balance < p_amount then
    return jsonb_build_object(
      'ok', false, 'error', 'insufficient_balance',
      'stored_available', v_wallet.available_balance
    );
  end if;
  if v_verified_available < p_amount then
    return jsonb_build_object(
      'ok', false, 'error', 'insufficient_verified_balance',
      'verified_available', v_verified_available
    );
  end if;

  v_fee := round(p_amount::numeric * 0.05)::bigint;
  v_net := p_amount - v_fee;

  insert into public.wallet_withdrawals (
    id, user_id, amount_requested, fee, amount_net, currency,
    bank_name, bank_account_number, bank_account_name, bank_account_masked,
    status, reservation_model, ledger_recorded, funding_state,
    request_idempotency_key, request_hash
  ) values (
    v_withdrawal_id, v_user_id, p_amount, v_fee, v_net, 'VND',
    v_kyc.bank_name, v_kyc.bank_account_number,
    v_kyc.bank_account_name_verified,
    public.mask_bank_account(v_kyc.bank_account_number),
    'pending', 'held', false, 'native_verified',
    p_request_idempotency_key, v_request_hash
  );

  v_remaining := p_amount;
  while v_remaining > 0 loop
    select * into v_source
    from public.wallet_fund_sources
    where user_id = v_user_id
      and verification_status = 'verified'
      and remaining_amount > 0
    order by occurred_at, id
    for update
    limit 1;

    if not found then
      raise exception 'verified_source_exhausted';
    end if;

    v_take := least(v_remaining, v_source.remaining_amount);
    v_allocation_key := public.stable_financial_uuid(
      p_request_idempotency_key::text || ':withdrawal:' || v_source.id::text
    );

    update public.wallet_fund_sources
    set remaining_amount = remaining_amount - v_take, updated_at = now()
    where id = v_source.id;

    insert into public.wallet_fund_allocations (
      fund_source_id, user_id, purpose_type, purpose_id, amount, status,
      idempotency_key, group_idempotency_key
    ) values (
      v_source.id, v_user_id, 'withdrawal', v_withdrawal_id::text,
      v_take, 'reserved', v_allocation_key, p_request_idempotency_key
    );

    v_remaining := v_remaining - v_take;
  end loop;

  update public.wallets
  set available_balance = available_balance - p_amount,
      held_balance = held_balance + p_amount,
      updated_at = now()
  where id = v_wallet.id;

  insert into public.wallet_transactions (
    wallet_id, user_id, type, amount, balance_after, description,
    reference_id, reference_type, idempotency_key, affects_balance, metadata
  ) values (
    v_wallet.id, v_user_id, 'withdrawal_hold', 0,
    v_wallet.available_balance - p_amount,
    'Funds held for withdrawal request', v_withdrawal_id::text,
    'wallet_withdrawal', p_request_idempotency_key, false,
    jsonb_build_object('held_amount', p_amount)
  );

  perform public.assert_wallet_fund_integrity(v_user_id);

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'withdrawal_id', v_withdrawal_id,
    'status', 'pending',
    'amount_requested', p_amount,
    'fee', v_fee,
    'amount_net', v_net,
    'available_balance', v_wallet.available_balance - p_amount,
    'held_balance', v_wallet.held_balance + p_amount,
    'verified_available', v_verified_available - p_amount,
    'verified_held', p_amount
  );
end;
$$;

create or replace function public.finish_withdrawal_action(
  p_request_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.withdrawal_action_requests
  set status = 'completed', response_payload = p_result, completed_at = now()
  where id = p_request_id;
  return p_result;
end;
$$;

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
  v_request public.withdrawal_action_requests%rowtype;
  v_request_hash text;
  v_withdrawal public.wallet_withdrawals%rowtype;
  v_wallet public.wallets%rowtype;
  v_attempt public.withdrawal_transfer_attempts%rowtype;
  v_balances jsonb;
  v_reserved bigint;
  v_allocations jsonb;
  v_claim_id uuid;
  v_attempt_id uuid;
  v_reference text;
  v_return_reference text;
  v_reason text;
  v_evidence jsonb;
  v_outcome text;
  v_result jsonb;
  v_new_balance bigint;
  v_source_id uuid;
  v_allocation record;
  v_shortfall bigint;
  v_previous_actor text;
begin
  perform public.assert_financial_mutations_enabled();

  if p_withdrawal_id is null or p_idempotency_key is null
     or coalesce(trim(p_actor_id), '') = ''
     or p_actor_role not in ('admin', 'moderator', 'operator')
     or p_action not in (
       'verify_for_transfer', 'start_transfer', 'release_claim', 'complete',
       'reject', 'mark_transfer_failed', 'record_returned', 'resolve_legacy',
       'takeover_recovery'
     ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_action_request');
  end if;

  if not exists (
    select 1 from public.wallet_withdrawals where id = p_withdrawal_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_request_hash := jsonb_build_object(
    'version', 1,
    'withdrawal_id', p_withdrawal_id,
    'action', p_action,
    'actor_id', p_actor_id,
    'actor_role', p_actor_role,
    'payload', coalesce(p_payload, '{}'::jsonb)
  )::text;

  insert into public.withdrawal_action_requests (
    withdrawal_id, actor_id, actor_role, action, idempotency_key,
    request_hash, request_payload
  ) values (
    p_withdrawal_id, p_actor_id, p_actor_role, p_action,
    p_idempotency_key, v_request_hash, coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (withdrawal_id, idempotency_key) do nothing;

  select * into v_request
  from public.withdrawal_action_requests
  where withdrawal_id = p_withdrawal_id
    and idempotency_key = p_idempotency_key
  for update;

  if v_request.request_hash <> v_request_hash then
    return jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
  end if;
  if v_request.status = 'completed' then
    if p_action = 'start_transfer' then
      select w.* into v_withdrawal
      from public.wallet_withdrawals w
      where w.id = p_withdrawal_id;
      if v_withdrawal.status = 'processing'
         and v_withdrawal.claimed_by = p_actor_id
         and v_withdrawal.active_transfer_attempt_id is not null then
        select * into v_attempt
        from public.withdrawal_transfer_attempts
        where id = v_withdrawal.active_transfer_attempt_id
          and withdrawal_id = v_withdrawal.id
          and started_by = p_actor_id
          and status in ('initiated', 'bank_accepted', 'unknown');
        if found then
          -- The full destination is reconstructed only for an authorized,
          -- still-active replay. It is never persisted in response_payload,
          -- audit evidence, or any GET-facing serialized result.
          return v_request.response_payload || jsonb_build_object(
            'replayed', true,
            'bank_name', v_attempt.destination_bank_name,
            'bank_account_name', v_attempt.destination_account_name,
            'bank_account_number', v_attempt.destination_account_number
          );
        end if;
      end if;
    end if;
    return v_request.response_payload || jsonb_build_object('replayed', true);
  end if;

  select * into v_withdrawal
  from public.wallet_withdrawals
  where id = p_withdrawal_id
  for update;

  if not found then
    return public.finish_withdrawal_action(
      v_request.id, jsonb_build_object('ok', false, 'error', 'not_found')
    );
  end if;

  select * into v_wallet
  from public.wallets
  where user_id = v_withdrawal.user_id
  for update;

  if not found then
    return public.finish_withdrawal_action(
      v_request.id, jsonb_build_object('ok', false, 'error', 'wallet_not_found')
    );
  end if;

  if p_action = 'verify_for_transfer' then
    if v_withdrawal.status <> 'pending'
       or v_withdrawal.funding_state not in ('native_verified', 'backfilled_verified') then
      return public.finish_withdrawal_action(
        v_request.id, jsonb_build_object('ok', false, 'error', 'withdrawal_not_verifiable')
      );
    end if;

    select coalesce(sum(amount), 0)::bigint into v_reserved
    from public.wallet_fund_allocations
    where purpose_type = 'withdrawal'
      and purpose_id = v_withdrawal.id::text
      and status = 'reserved';

    if v_reserved <> v_withdrawal.amount_requested then
      return public.finish_withdrawal_action(
        v_request.id,
        jsonb_build_object('ok', false, 'error', 'verified_reservation_mismatch')
      );
    end if;

    v_balances := public.assert_wallet_fund_integrity(v_withdrawal.user_id);
    v_claim_id := gen_random_uuid();

    update public.wallet_withdrawals
    set status = 'processing',
        verification_claim_id = v_claim_id,
        claimed_by = p_actor_id,
        processing_started_at = now(),
        processing_expires_at = now() + interval '15 minutes',
        verification_version = coalesce(verification_version, 0) + 1,
        verification_snapshot = jsonb_build_object(
          'balances', v_balances,
          'reserved_amount', v_reserved,
          'verified_at', now()
        ),
        recovery_required = false,
        recovery_reason = null
    where id = v_withdrawal.id
    returning * into v_withdrawal;

    insert into public.withdrawal_audit_events (
      withdrawal_id, actor_id, actor_role, action, evidence
    ) values (
      v_withdrawal.id, p_actor_id, p_actor_role, p_action,
      jsonb_build_object('claim_id', v_claim_id, 'snapshot', v_withdrawal.verification_snapshot)
    );

    return public.finish_withdrawal_action(
      v_request.id,
      jsonb_build_object(
        'ok', true,
        'claim_id', v_claim_id,
        'processing_expires_at', v_withdrawal.processing_expires_at,
        'verification_snapshot', v_withdrawal.verification_snapshot
      )
    );
  end if;

  if p_action = 'start_transfer' then
    if v_withdrawal.status <> 'processing'
       or v_withdrawal.verification_claim_id is null
       or v_withdrawal.claimed_by <> p_actor_id
       or v_withdrawal.processing_expires_at <= now()
       or v_withdrawal.transfer_started_at is not null
       or v_withdrawal.active_transfer_attempt_id is not null then
      return public.finish_withdrawal_action(
        v_request.id, jsonb_build_object('ok', false, 'error', 'claim_not_startable')
      );
    end if;

    -- Final irreversible verification gate. Everything below is frozen into
    -- the attempt; completion never re-runs these checks.
    perform 1
    from public.wallet_fund_allocations
    where purpose_type = 'withdrawal'
      and purpose_id = v_withdrawal.id::text
      and status = 'reserved'
    order by created_at, id
    for update;

    select coalesce(sum(amount), 0)::bigint,
           coalesce(jsonb_agg(jsonb_build_object(
             'allocation_id', id,
             'fund_source_id', fund_source_id,
             'amount', amount
           ) order by created_at, id), '[]'::jsonb)
    into v_reserved, v_allocations
    from public.wallet_fund_allocations
    where purpose_type = 'withdrawal'
      and purpose_id = v_withdrawal.id::text
      and status = 'reserved';

    if v_reserved <> v_withdrawal.amount_requested then
      return public.finish_withdrawal_action(
        v_request.id, jsonb_build_object('ok', false, 'error', 'final_reservation_mismatch')
      );
    end if;
    v_balances := public.assert_wallet_fund_integrity(v_withdrawal.user_id);

    insert into public.withdrawal_transfer_attempts (
      withdrawal_id, verification_claim_id, verification_version,
      verification_snapshot, allocation_snapshot,
      amount_requested, fee_amount, amount_net, currency,
      destination_bank_name, destination_bank_code,
      destination_account_name, destination_account_number,
      destination_account_masked, status, started_by
    ) values (
      v_withdrawal.id, v_withdrawal.verification_claim_id,
      v_withdrawal.verification_version,
      v_withdrawal.verification_snapshot || jsonb_build_object('start_balances', v_balances),
      v_allocations,
      v_withdrawal.amount_requested, v_withdrawal.fee,
      v_withdrawal.amount_net, v_withdrawal.currency,
      v_withdrawal.bank_name, null,
      v_withdrawal.bank_account_name, v_withdrawal.bank_account_number,
      coalesce(v_withdrawal.bank_account_masked, public.mask_bank_account(v_withdrawal.bank_account_number)),
      'initiated', p_actor_id
    )
    returning id into v_attempt_id;

    update public.wallet_withdrawals
    set transfer_started_at = now(), active_transfer_attempt_id = v_attempt_id
    where id = v_withdrawal.id;

    insert into public.withdrawal_audit_events (
      withdrawal_id, transfer_attempt_id, actor_id, actor_role, action
    ) values (
      v_withdrawal.id, v_attempt_id, p_actor_id, p_actor_role, p_action
    );

    v_result := jsonb_build_object(
      'ok', true,
      'attempt_id', v_attempt_id,
      'amount_requested', v_withdrawal.amount_requested,
      'fee', v_withdrawal.fee,
      'amount_net', v_withdrawal.amount_net,
      'currency', v_withdrawal.currency
    );
    perform public.finish_withdrawal_action(v_request.id, v_result);
    return v_result || jsonb_build_object(
      'bank_name', v_withdrawal.bank_name,
      'bank_account_name', v_withdrawal.bank_account_name,
      'bank_account_number', v_withdrawal.bank_account_number
    );
  end if;

  if p_action = 'release_claim' then
    if v_withdrawal.status <> 'processing'
       or v_withdrawal.claimed_by <> p_actor_id
       or v_withdrawal.transfer_started_at is not null
       or v_withdrawal.active_transfer_attempt_id is not null
       or exists (
         select 1 from public.withdrawal_transfer_attempts
         where withdrawal_id = v_withdrawal.id
       ) then
      return public.finish_withdrawal_action(
        v_request.id, jsonb_build_object('ok', false, 'error', 'claim_release_forbidden')
      );
    end if;

    update public.wallet_withdrawals
    set status = 'pending', verification_claim_id = null, claimed_by = null,
        processing_started_at = null, processing_expires_at = null,
        verification_snapshot = null
    where id = v_withdrawal.id;

    return public.finish_withdrawal_action(v_request.id, jsonb_build_object('ok', true));
  end if;

  if p_action = 'complete' then
    v_reference := nullif(trim(p_payload ->> 'transfer_reference'), '');
    if v_withdrawal.status <> 'processing'
       or v_withdrawal.transfer_started_at is null
       or v_withdrawal.active_transfer_attempt_id is null
       or v_reference is null then
      return public.finish_withdrawal_action(
        v_request.id, jsonb_build_object('ok', false, 'error', 'completion_not_recordable')
      );
    end if;

    select * into v_attempt
    from public.withdrawal_transfer_attempts
    where id = v_withdrawal.active_transfer_attempt_id
    for update;

    if not found or v_attempt.status not in ('initiated', 'bank_accepted', 'unknown') then
      return public.finish_withdrawal_action(
        v_request.id, jsonb_build_object('ok', false, 'error', 'attempt_not_recordable')
      );
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('withdrawal-transfer-reference:' || v_reference, 0)
    );
    if exists (
      select 1 from public.withdrawal_transfer_attempts
      where transfer_reference = v_reference and id <> v_attempt.id
    ) then
      update public.withdrawal_transfer_attempts
      set status = 'unknown', recovery_required = true,
          failure_reason = 'duplicate_transfer_reference',
          failure_evidence = jsonb_build_object(
            'attempted_transfer_reference', v_reference,
            'recorded_at', now()
          )
      where id = v_attempt.id;
      update public.wallet_withdrawals
      set recovery_required = true,
          recovery_reason = 'duplicate_transfer_reference'
      where id = v_withdrawal.id;
      insert into public.withdrawal_audit_events (
        withdrawal_id, transfer_attempt_id, actor_id, actor_role, action,
        reason, evidence
      ) values (
        v_withdrawal.id, v_attempt.id, p_actor_id, p_actor_role,
        'complete_recovery_required', 'duplicate_transfer_reference',
        jsonb_build_object('attempted_transfer_reference', v_reference)
      );
      return public.finish_withdrawal_action(
        v_request.id,
        jsonb_build_object('ok', false, 'error', 'duplicate_transfer_reference', 'recovery_required', true)
      );
    end if;

    select coalesce(sum(amount), 0)::bigint into v_reserved
    from public.wallet_fund_allocations
    where purpose_type = 'withdrawal'
      and purpose_id = v_withdrawal.id::text
      and status = 'reserved';

    if v_reserved <> v_attempt.amount_requested
       or v_wallet.held_balance < v_attempt.amount_requested then
      -- External money is still recorded on the immutable attempt. Accounting
      -- settlement is frozen for moderator recovery and no second transfer can
      -- be started because active_transfer_attempt_id remains set.
      update public.withdrawal_transfer_attempts
      set status = 'unknown', transfer_reference = v_reference,
          recovery_required = true,
          failure_reason = 'post_start_accounting_discrepancy'
      where id = v_attempt.id;
      update public.wallet_withdrawals
      set recovery_required = true,
          recovery_reason = 'post_start_accounting_discrepancy'
      where id = v_withdrawal.id;
      insert into public.withdrawal_audit_events (
        withdrawal_id, transfer_attempt_id, actor_id, actor_role, action,
        reason, evidence
      ) values (
        v_withdrawal.id, v_attempt.id, p_actor_id, p_actor_role,
        'complete_recovery_required', 'post_start_accounting_discrepancy',
        jsonb_build_object('transfer_reference', v_reference, 'reserved', v_reserved,
          'held', v_wallet.held_balance, 'expected', v_attempt.amount_requested)
      );
      return public.finish_withdrawal_action(
        v_request.id,
        jsonb_build_object('ok', true, 'recorded', true, 'recovery_required', true)
      );
    end if;

    update public.wallet_fund_allocations
    set status = 'consumed', consumed_at = now()
    where purpose_type = 'withdrawal'
      and purpose_id = v_withdrawal.id::text
      and status = 'reserved';

    update public.wallets
    set held_balance = held_balance - v_attempt.amount_requested,
        total_withdrawn = total_withdrawn + v_attempt.amount_requested,
        updated_at = now()
    where id = v_wallet.id;

    insert into public.wallet_transactions (
      wallet_id, user_id, type, amount, balance_after, description,
      reference_id, reference_type, idempotency_key, metadata
    ) values
    (
      v_wallet.id, v_withdrawal.user_id, 'withdrawal_net_outflow',
      -v_attempt.amount_net, v_wallet.available_balance,
      'Withdrawal bank transfer', v_withdrawal.id::text,
      'withdrawal_transfer_attempt',
      public.stable_financial_uuid('withdrawal-net:' || v_attempt.id::text),
      jsonb_build_object('attempt_id', v_attempt.id, 'transfer_reference', v_reference)
    ),
    (
      v_wallet.id, v_withdrawal.user_id, 'withdrawal_fee',
      -v_attempt.fee_amount, v_wallet.available_balance,
      'Withdrawal fee', v_withdrawal.id::text,
      'withdrawal_transfer_attempt',
      public.stable_financial_uuid('withdrawal-fee:' || v_attempt.id::text),
      jsonb_build_object('attempt_id', v_attempt.id, 'transfer_reference', v_reference)
    );

    update public.withdrawal_transfer_attempts
    set status = 'confirmed', transfer_reference = v_reference,
        completed_at = now(), recovery_required = false
    where id = v_attempt.id;

    update public.wallet_withdrawals
    set status = 'completed', processed_at = now(), ledger_recorded = true,
        recovery_required = false, recovery_reason = null
    where id = v_withdrawal.id;

    insert into public.withdrawal_audit_events (
      withdrawal_id, transfer_attempt_id, actor_id, actor_role, action, evidence
    ) values (
      v_withdrawal.id, v_attempt.id, p_actor_id, p_actor_role, p_action,
      jsonb_build_object('transfer_reference', v_reference)
    );

    -- The user notification is part of the same idempotent database
    -- transaction as completion. A route retry therefore cannot enqueue it a
    -- second time after a timeout.
    insert into public.notifications (user_id, type, title, message, read)
    values (
      v_withdrawal.user_id,
      'withdrawal_completed',
      'Withdrawal completed',
      v_attempt.amount_net::text || ' VND was transferred to '
        || coalesce(v_attempt.destination_bank_name, 'the destination bank') || ' '
        || coalesce(v_attempt.destination_account_masked, '••••') || '.',
      false
    );

    return public.finish_withdrawal_action(
      v_request.id,
      jsonb_build_object(
        'ok', true, 'recorded', true, 'status', 'completed',
        'user_id', v_withdrawal.user_id,
        'amount_net', v_attempt.amount_net,
        'bank_name', v_attempt.destination_bank_name,
        'bank_account_masked', v_attempt.destination_account_masked
      )
    );
  end if;

  if p_action = 'takeover_recovery' then
    v_reason := nullif(trim(p_payload ->> 'reason'), '');
    v_evidence := p_payload -> 'evidence';
    if p_actor_role <> 'moderator'
       or v_reason is null
       or v_evidence is null or v_evidence = '{}'::jsonb
       or v_withdrawal.status <> 'processing'
       or not v_withdrawal.recovery_required
       or v_withdrawal.active_transfer_attempt_id is null then
      return public.finish_withdrawal_action(
        v_request.id, jsonb_build_object('ok', false, 'error', 'recovery_takeover_forbidden')
      );
    end if;
    v_previous_actor := v_withdrawal.claimed_by;
    update public.wallet_withdrawals
    set claimed_by = p_actor_id
    where id = v_withdrawal.id;
    insert into public.withdrawal_audit_events (
      withdrawal_id, transfer_attempt_id, actor_id, actor_role, action,
      reason, evidence
    ) values (
      v_withdrawal.id, v_withdrawal.active_transfer_attempt_id,
      p_actor_id, p_actor_role, p_action, v_reason,
      v_evidence || jsonb_build_object(
        'previous_actor', v_previous_actor,
        'new_actor', p_actor_id,
        'taken_over_at', now()
      )
    );
    return public.finish_withdrawal_action(
      v_request.id,
      jsonb_build_object('ok', true, 'status', 'processing',
        'previous_actor', v_previous_actor, 'claimed_by', p_actor_id)
    );
  end if;

  if p_action = 'reject' then
    v_reason := nullif(trim(p_payload ->> 'reason'), '');
    if v_reason is null
       or v_withdrawal.status not in ('pending', 'processing')
       or v_withdrawal.transfer_started_at is not null
       or v_withdrawal.active_transfer_attempt_id is not null then
      return public.finish_withdrawal_action(
        v_request.id, jsonb_build_object('ok', false, 'error', 'rejection_forbidden')
      );
    end if;

    for v_allocation in
      select * from public.wallet_fund_allocations
      where purpose_type = 'withdrawal'
        and purpose_id = v_withdrawal.id::text
        and status = 'reserved'
      for update
    loop
      update public.wallet_fund_sources
      set remaining_amount = remaining_amount + v_allocation.amount,
          updated_at = now()
      where id = v_allocation.fund_source_id;
      update public.wallet_fund_allocations
      set status = 'released', released_at = now()
      where id = v_allocation.id;
    end loop;

    update public.wallets
    set available_balance = available_balance + v_withdrawal.amount_requested,
        held_balance = held_balance - v_withdrawal.amount_requested,
        updated_at = now()
    where id = v_wallet.id
    returning available_balance into v_new_balance;

    update public.wallet_withdrawals
    set status = 'rejected', rejection_reason = v_reason,
        processed_at = now(), verification_claim_id = null,
        claimed_by = null, processing_started_at = null,
        processing_expires_at = null, verification_snapshot = null
    where id = v_withdrawal.id;

    insert into public.wallet_transactions (
      wallet_id, user_id, type, amount, balance_after, description,
      reference_id, reference_type, idempotency_key, affects_balance, metadata
    ) values (
      v_wallet.id, v_withdrawal.user_id, 'withdrawal_hold_release', 0,
      v_new_balance, 'Release withdrawal hold after rejection',
      v_withdrawal.id::text, 'wallet_withdrawal',
      public.stable_financial_uuid('withdrawal-release:' || v_withdrawal.id::text),
      false, jsonb_build_object('reason', v_reason, 'action', 'reject')
    );

    insert into public.withdrawal_audit_events (
      withdrawal_id, actor_id, actor_role, action, reason
    ) values (v_withdrawal.id, p_actor_id, p_actor_role, p_action, v_reason);

    perform public.assert_wallet_fund_integrity(v_withdrawal.user_id);
    return public.finish_withdrawal_action(
      v_request.id,
      jsonb_build_object('ok', true, 'status', 'rejected',
        'user_id', v_withdrawal.user_id,
        'amount_requested', v_withdrawal.amount_requested,
        'new_balance', v_new_balance)
    );
  end if;

  if p_action = 'mark_transfer_failed' then
    v_reason := nullif(trim(p_payload ->> 'reason'), '');
    v_evidence := p_payload -> 'evidence';
    v_outcome := p_payload ->> 'outcome';
    if p_actor_role <> 'moderator'
       or v_reason is null
       or v_evidence is null or v_evidence = '{}'::jsonb
       or v_outcome not in ('pending', 'rejected')
       or v_withdrawal.transfer_started_at is null
       or v_withdrawal.active_transfer_attempt_id is null then
      return public.finish_withdrawal_action(
        v_request.id, jsonb_build_object('ok', false, 'error', 'transfer_failure_resolution_forbidden')
      );
    end if;

    select * into v_attempt
    from public.withdrawal_transfer_attempts
    where id = v_withdrawal.active_transfer_attempt_id
    for update;

    update public.withdrawal_transfer_attempts
    set status = 'failed', failure_reason = v_reason,
        failure_evidence = v_evidence, recovery_required = false
    where id = v_attempt.id;

    if v_outcome = 'pending' then
      update public.wallet_withdrawals
      set status = 'pending', verification_claim_id = null, claimed_by = null,
          processing_started_at = null, processing_expires_at = null,
          verification_snapshot = null, transfer_started_at = null,
          active_transfer_attempt_id = null, recovery_required = false,
          recovery_reason = null
      where id = v_withdrawal.id;
    else
      for v_allocation in
        select * from public.wallet_fund_allocations
        where purpose_type = 'withdrawal'
          and purpose_id = v_withdrawal.id::text
          and status = 'reserved'
        for update
      loop
        update public.wallet_fund_sources
        set remaining_amount = remaining_amount + v_allocation.amount,
            updated_at = now()
        where id = v_allocation.fund_source_id;
        update public.wallet_fund_allocations
        set status = 'released', released_at = now()
        where id = v_allocation.id;
      end loop;
      update public.wallets
      set available_balance = available_balance + v_attempt.amount_requested,
          held_balance = held_balance - v_attempt.amount_requested,
          updated_at = now()
      where id = v_wallet.id
      returning available_balance into v_new_balance;
      update public.wallet_withdrawals
      set status = 'rejected', rejection_reason = v_reason,
          processed_at = now(), active_transfer_attempt_id = null,
          recovery_required = false, recovery_reason = null
      where id = v_withdrawal.id;
      insert into public.wallet_transactions (
        wallet_id, user_id, type, amount, balance_after, description,
        reference_id, reference_type, idempotency_key, affects_balance, metadata
      ) values (
        v_wallet.id, v_withdrawal.user_id, 'withdrawal_hold_release', 0,
        v_new_balance, 'Release withdrawal hold after confirmed bank transfer failure',
        v_withdrawal.id::text, 'wallet_withdrawal',
        public.stable_financial_uuid('withdrawal-release:' || v_withdrawal.id::text),
        false, jsonb_build_object(
          'reason', v_reason, 'action', 'mark_transfer_failed', 'attempt_id', v_attempt.id
        )
      );
    end if;

    insert into public.withdrawal_audit_events (
      withdrawal_id, transfer_attempt_id, actor_id, actor_role, action,
      reason, evidence
    ) values (
      v_withdrawal.id, v_attempt.id, p_actor_id, p_actor_role,
      p_action, v_reason, v_evidence || jsonb_build_object('outcome', v_outcome)
    );

    return public.finish_withdrawal_action(
      v_request.id, jsonb_build_object('ok', true, 'status', v_outcome)
    );
  end if;

  if p_action = 'record_returned' then
    v_return_reference := nullif(trim(p_payload ->> 'return_reference'), '');
    v_evidence := p_payload -> 'evidence';
    if p_actor_role <> 'moderator'
       or v_return_reference is null
       or v_evidence is null or v_evidence = '{}'::jsonb
       or v_withdrawal.status <> 'completed'
       or v_withdrawal.active_transfer_attempt_id is null then
      return public.finish_withdrawal_action(
        v_request.id, jsonb_build_object('ok', false, 'error', 'return_recording_forbidden')
      );
    end if;

    select * into v_attempt
    from public.withdrawal_transfer_attempts
    where id = v_withdrawal.active_transfer_attempt_id
    for update;

    perform pg_advisory_xact_lock(
      hashtextextended('withdrawal-return-reference:' || v_return_reference, 0)
    );
    if v_attempt.status = 'returned' then
      if v_attempt.return_reference is distinct from v_return_reference
         or v_attempt.return_evidence is distinct from v_evidence then
        return public.finish_withdrawal_action(
          v_request.id,
          jsonb_build_object('ok', false, 'error', 'return_already_recorded')
        );
      end if;
      return public.finish_withdrawal_action(
        v_request.id, jsonb_build_object('ok', true, 'replayed', true, 'status', 'returned')
      );
    end if;
    if v_attempt.status <> 'confirmed'
       or exists (
         select 1 from public.withdrawal_transfer_attempts
         where return_reference = v_return_reference and id <> v_attempt.id
       ) then
      return public.finish_withdrawal_action(
        v_request.id, jsonb_build_object('ok', false, 'error', 'return_reference_conflict')
      );
    end if;

    insert into public.wallet_fund_sources (
      user_id, wallet_id, source_type, source_id, original_amount,
      remaining_amount, verification_status, credits_wallet, evidence
    ) values (
      v_withdrawal.user_id, v_wallet.id, 'withdrawal_return', v_attempt.id::text,
      v_attempt.amount_net, v_attempt.amount_net, 'verified', true,
      jsonb_build_object('return_reference', v_return_reference, 'evidence', v_evidence)
    )
    returning id into v_source_id;

    update public.wallets
    set available_balance = available_balance + v_attempt.amount_net,
        updated_at = now()
    where id = v_wallet.id
    returning available_balance into v_new_balance;

    insert into public.wallet_transactions (
      wallet_id, user_id, type, amount, balance_after, description,
      reference_id, reference_type, fund_source_id, idempotency_key, metadata
    ) values (
      v_wallet.id, v_withdrawal.user_id, 'withdrawal_return_net',
      v_attempt.amount_net, v_new_balance,
      'Bank returned withdrawal transfer', v_attempt.id::text,
      'withdrawal_transfer_attempt', v_source_id,
      public.stable_financial_uuid('withdrawal-return:' || v_attempt.id::text),
      jsonb_build_object('return_reference', v_return_reference, 'fee_refunded', false)
    );

    update public.withdrawal_transfer_attempts
    set status = 'returned', return_reference = v_return_reference,
        return_evidence = v_evidence, returned_at = now()
    where id = v_attempt.id;

    insert into public.withdrawal_audit_events (
      withdrawal_id, transfer_attempt_id, actor_id, actor_role, action, evidence
    ) values (
      v_withdrawal.id, v_attempt.id, p_actor_id, p_actor_role,
      p_action, v_evidence || jsonb_build_object(
        'return_reference', v_return_reference,
        'amount_returned', v_attempt.amount_net,
        'fee_refunded', false
      )
    );

    perform public.assert_wallet_fund_integrity(v_withdrawal.user_id);
    return public.finish_withdrawal_action(
      v_request.id,
      jsonb_build_object('ok', true, 'status', 'returned',
        'amount_returned', v_attempt.amount_net, 'fee_refunded', false,
        'new_balance', v_new_balance)
    );
  end if;

  if p_action = 'resolve_legacy' then
    if p_actor_role not in ('moderator', 'operator')
       or v_withdrawal.funding_state not in (
         'legacy_blocked', 'legacy_transfer_review_required', 'legacy_unverified_outflow'
       ) then
      return public.finish_withdrawal_action(
        v_request.id, jsonb_build_object('ok', false, 'error', 'legacy_resolution_forbidden')
      );
    end if;

    v_outcome := p_payload ->> 'outcome';
    v_reason := nullif(trim(p_payload ->> 'reason'), '');
    v_evidence := p_payload -> 'evidence';
    if v_outcome = 'unknown' then
      update public.wallet_withdrawals
      set recovery_required = true, recovery_reason = coalesce(v_reason, 'legacy_transfer_unknown')
      where id = v_withdrawal.id;
      return public.finish_withdrawal_action(
        v_request.id, jsonb_build_object('ok', true, 'status', 'recovery_required')
      );
    end if;

    if v_outcome = 'confirmed_not_sent' then
      -- Legacy rejection releases only reserved verified allocations; the
      -- remainder returns to available as unverified.
      for v_allocation in
        select * from public.wallet_fund_allocations
        where purpose_type = 'withdrawal'
          and purpose_id = v_withdrawal.id::text
          and status = 'reserved'
        for update
      loop
        update public.wallet_fund_sources
        set remaining_amount = remaining_amount + v_allocation.amount,
            updated_at = now()
        where id = v_allocation.fund_source_id;
        update public.wallet_fund_allocations
        set status = 'released', released_at = now()
        where id = v_allocation.id;
      end loop;
      update public.wallets
      set available_balance = available_balance + v_withdrawal.amount_requested,
          held_balance = held_balance - v_withdrawal.amount_requested,
          updated_at = now()
      where id = v_wallet.id
      returning available_balance into v_new_balance;
      update public.wallet_withdrawals
      set status = 'rejected', rejection_reason = coalesce(v_reason, 'Legacy transfer not sent'),
          processed_at = now(), recovery_required = false
      where id = v_withdrawal.id;
      insert into public.wallet_transactions (
        wallet_id, user_id, type, amount, balance_after, description,
        reference_id, reference_type, idempotency_key, affects_balance, metadata
      ) values (
        v_wallet.id, v_withdrawal.user_id, 'withdrawal_hold_release', 0,
        v_new_balance, 'Release hold for legacy withdrawal not sent',
        v_withdrawal.id::text, 'wallet_withdrawal',
        public.stable_financial_uuid('withdrawal-release:' || v_withdrawal.id::text),
        false, jsonb_build_object(
          'reason', coalesce(v_reason, 'Legacy transfer not sent'),
          'action', 'resolve_legacy'
        )
      );
      return public.finish_withdrawal_action(
        v_request.id, jsonb_build_object('ok', true, 'status', 'rejected')
      );
    end if;

    if v_outcome = 'confirmed_sent' then
      v_reference := nullif(trim(p_payload ->> 'transfer_reference'), '');
      if v_reference is null or v_evidence is null or v_evidence = '{}'::jsonb then
        return public.finish_withdrawal_action(
          v_request.id, jsonb_build_object('ok', false, 'error', 'legacy_bank_evidence_required')
        );
      end if;

      select coalesce(sum(amount), 0)::bigint into v_reserved
      from public.wallet_fund_allocations
      where purpose_type = 'withdrawal'
        and purpose_id = v_withdrawal.id::text
        and status = 'reserved';
      v_shortfall := v_withdrawal.amount_requested - v_reserved;

      insert into public.withdrawal_transfer_attempts (
        withdrawal_id, verification_claim_id, verification_version,
        verification_snapshot, allocation_snapshot,
        amount_requested, fee_amount, amount_net, currency,
        destination_bank_name, destination_account_name,
        destination_account_number, destination_account_masked,
        status, started_by, started_at, transfer_reference, completed_at,
        recovery_required
      ) values (
        v_withdrawal.id, gen_random_uuid(), 0,
        jsonb_build_object('legacy', true, 'evidence', v_evidence),
        coalesce((select jsonb_agg(jsonb_build_object(
          'allocation_id', id, 'fund_source_id', fund_source_id, 'amount', amount
        )) from public.wallet_fund_allocations
        where purpose_type = 'withdrawal' and purpose_id = v_withdrawal.id::text
          and status = 'reserved'), '[]'::jsonb),
        v_withdrawal.amount_requested, v_withdrawal.fee,
        v_withdrawal.amount_net, v_withdrawal.currency,
        v_withdrawal.bank_name, v_withdrawal.bank_account_name,
        v_withdrawal.bank_account_number,
        coalesce(v_withdrawal.bank_account_masked, public.mask_bank_account(v_withdrawal.bank_account_number)),
        'confirmed', p_actor_id, coalesce(v_withdrawal.processed_at, v_withdrawal.created_at),
        v_reference, now(), v_shortfall > 0
      ) returning id into v_attempt_id;

      update public.wallet_fund_allocations
      set status = 'consumed', consumed_at = now()
      where purpose_type = 'withdrawal'
        and purpose_id = v_withdrawal.id::text
        and status = 'reserved';

      update public.wallets
      set held_balance = held_balance - v_withdrawal.amount_requested,
          total_withdrawn = total_withdrawn + v_withdrawal.amount_requested,
          updated_at = now()
      where id = v_wallet.id;

      insert into public.wallet_transactions (
        wallet_id, user_id, type, amount, balance_after, description,
        reference_id, reference_type, idempotency_key, metadata
      ) values
      (
        v_wallet.id, v_withdrawal.user_id, 'withdrawal_net_outflow',
        -v_withdrawal.amount_net, v_wallet.available_balance,
        'Legacy external transfer recorded', v_withdrawal.id::text,
        'legacy_withdrawal_transfer',
        public.stable_financial_uuid('legacy-withdrawal-net:' || v_withdrawal.id::text),
        jsonb_build_object('attempt_id', v_attempt_id, 'verified_backing', v_reserved,
          'legacy_unverified_outflow', greatest(v_shortfall, 0), 'evidence', v_evidence)
      ),
      (
        v_wallet.id, v_withdrawal.user_id, 'withdrawal_fee',
        -v_withdrawal.fee, v_wallet.available_balance,
        'Legacy withdrawal fee recorded', v_withdrawal.id::text,
        'legacy_withdrawal_transfer',
        public.stable_financial_uuid('legacy-withdrawal-fee:' || v_withdrawal.id::text),
        jsonb_build_object('attempt_id', v_attempt_id)
      );

      update public.wallet_withdrawals
      set status = 'completed', processed_at = now(), ledger_recorded = true,
          transfer_started_at = coalesce(processed_at, created_at),
          active_transfer_attempt_id = v_attempt_id,
          funding_state = case when v_shortfall > 0 then 'legacy_unverified_outflow' else 'backfilled_verified' end,
          recovery_required = v_shortfall > 0,
          recovery_reason = case when v_shortfall > 0 then 'legacy_unverified_outflow' else null end
      where id = v_withdrawal.id;

      return public.finish_withdrawal_action(
        v_request.id,
        jsonb_build_object('ok', true, 'status', 'completed',
          'attempt_id', v_attempt_id, 'legacy_unverified_outflow', greatest(v_shortfall, 0))
      );
    end if;

    return public.finish_withdrawal_action(
      v_request.id, jsonb_build_object('ok', false, 'error', 'invalid_legacy_outcome')
    );
  end if;

  return public.finish_withdrawal_action(
    v_request.id, jsonb_build_object('ok', false, 'error', 'unhandled_action')
  );
end;
$$;

create or replace function public.recover_expired_withdrawal_claims()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  perform public.assert_financial_mutations_enabled();

  update public.wallet_withdrawals w
  set status = 'pending', verification_claim_id = null, claimed_by = null,
      processing_started_at = null, processing_expires_at = null,
      verification_snapshot = null
  where w.status = 'processing'
    and w.processing_expires_at < now()
    and w.transfer_started_at is null
    and w.active_transfer_attempt_id is null
    and not exists (
      select 1 from public.withdrawal_transfer_attempts a
      where a.withdrawal_id = w.id
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.flag_stale_withdrawal_transfers()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  perform public.assert_financial_mutations_enabled();
  update public.wallet_withdrawals
  set recovery_required = true,
      recovery_reason = coalesce(recovery_reason, 'transfer_started_over_30_minutes')
  where status = 'processing'
    and transfer_started_at < now() - interval '30 minutes'
    and active_transfer_attempt_id is not null
    and not recovery_required;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Old bypass RPCs must no longer be callable after this migration.
revoke execute on function public.request_wallet_withdrawal(uuid, bigint) from public, anon, authenticated, service_role;
revoke execute on function public.complete_wallet_withdrawal(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.reject_wallet_withdrawal(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.refund_withdrawal(uuid, text) from public, anon, authenticated, service_role;

revoke execute on function public.mask_bank_account(text) from public, anon;
revoke execute on function public.request_wallet_withdrawal(bigint, uuid) from public, anon;
revoke execute on function public.finish_withdrawal_action(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.perform_withdrawal_action(uuid, text, uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.recover_expired_withdrawal_claims() from public, anon, authenticated;
revoke execute on function public.flag_stale_withdrawal_transfers() from public, anon, authenticated;

grant execute on function public.request_wallet_withdrawal(bigint, uuid) to authenticated;
grant execute on function public.perform_withdrawal_action(uuid, text, uuid, text, text, jsonb) to service_role;
grant execute on function public.recover_expired_withdrawal_claims() to service_role;
grant execute on function public.flag_stale_withdrawal_transfers() to service_role;

-- ---------------------------------------------------------------------------
