-- Run after all migrations against an isolated database. The transaction is
-- rolled back so the same file is replayable.
begin;

do $$
declare
  u_mixed uuid := '10000000-0000-4000-8000-000000000001';
  u_seller uuid := '10000000-0000-4000-8000-000000000002';
  u_withdraw uuid := '10000000-0000-4000-8000-000000000003';
  u_replay uuid := '10000000-0000-4000-8000-000000000004';
  u_partial uuid := '10000000-0000-4000-8000-000000000005';
  u_processing uuid := '10000000-0000-4000-8000-000000000006';
  c_unverified uuid := '20000000-0000-4000-8000-000000000001';
  o_unverified uuid := '30000000-0000-4000-8000-000000000001';
  purchase_id uuid := '30000000-0000-4000-8000-000000000002';
  request_key uuid := '40000000-0000-4000-8000-000000000001';
  withdrawal_id uuid;
  result jsonb;
  balances jsonb;
  stored_before bigint;
  failed boolean;
  attempt_id uuid;
  mixed_source_id uuid;
begin
  insert into auth.users (id, email) values
    (u_mixed, 'mixed@example.test'),
    (u_seller, 'seller@example.test'),
    (u_withdraw, 'withdraw@example.test'),
    (u_replay, 'replay@example.test'),
    (u_partial, 'partial-open@example.test'),
    (u_processing, 'processing-open@example.test');
  insert into public.profiles (id, email, display_name) values
    (u_mixed, 'mixed@example.test', 'Mixed'),
    (u_seller, 'seller@example.test', 'Seller'),
    (u_withdraw, 'withdraw@example.test', 'Withdraw'),
    (u_replay, 'replay@example.test', 'Replay'),
    (u_partial, 'partial-open@example.test', 'Partial Open'),
    (u_processing, 'processing-open@example.test', 'Processing Open')
  on conflict (id) do update
  set email = excluded.email, display_name = excluded.display_name;

  -- Mixed wallet: stored 1,000,000; verified 100,000; unverified 900,000.
  insert into public.wallets (user_id, available_balance) values (u_mixed, 1000000)
  on conflict (user_id) do update
  set available_balance = excluded.available_balance;
  insert into public.wallet_fund_sources (
    user_id, wallet_id, source_type, source_id, original_amount,
    remaining_amount, verification_status, credits_wallet, occurred_at
  ) select u_mixed, id, 'legacy_reconciliation', 'mixed-source', 100000,
      100000, 'verified', false, '2026-01-01T00:00:00Z'
    from public.wallets where user_id = u_mixed;
  balances := public.assert_wallet_fund_integrity(u_mixed);
  assert (balances ->> 'verified_available')::bigint = 100000;
  assert (balances ->> 'unverified_available')::bigint = 900000;
  assert (balances ->> 'unverified_held')::bigint = 0;

  -- Allocation ownership is structural: a source can never back another
  -- user's purpose even if a privileged operator submits malformed rows.
  insert into public.wallets (user_id) values (u_seller)
  on conflict (user_id) do nothing;
  select id into mixed_source_id from public.wallet_fund_sources
  where user_id = u_mixed and source_id = 'mixed-source';
  failed := false;
  begin
    insert into public.wallet_fund_allocations (
      fund_source_id, user_id, purpose_type, purpose_id, amount, status,
      idempotency_key, consumed_at
    ) values (
      mixed_source_id, u_seller, 'wallet_purchase', 'cross-user-test', 1,
      'consumed', '40000000-0000-4000-8000-000000000099', now()
    );
    perform public.assert_wallet_fund_integrity(u_seller);
  exception when others then
    failed := sqlerrm = 'wallet_fund_integrity_failed';
  end;
  assert failed, 'cross-user fund allocation passed integrity checks';

  result := public.spend_verified_wallet(
    u_mixed,
    jsonb_build_array(jsonb_build_object('purpose_id', purchase_id, 'amount', 60000)),
    '40000000-0000-4000-8000-000000000002',
    'mixed-wallet-test'
  );
  balances := public.assert_wallet_fund_integrity(u_mixed);
  assert (balances ->> 'stored_available')::bigint = 940000;
  assert (balances ->> 'verified_available')::bigint = 40000;
  assert (balances ->> 'unverified_available')::bigint = 900000;

  failed := false;
  begin
    perform public.spend_verified_wallet(
      u_mixed,
      jsonb_build_array(jsonb_build_object(
        'purpose_id', '30000000-0000-4000-8000-000000000003', 'amount', 40001
      )),
      '40000000-0000-4000-8000-000000000003',
      'must-fail'
    );
  exception when others then failed := sqlerrm = 'insufficient_verified_balance'; end;
  assert failed, 'unverified available balance became spendable';

  -- An order without verified escrow cannot mint seller earnings.
  insert into public.cards (
    id, seller_id, name, category, listing_type, status
  ) values (
    c_unverified, u_seller, 'Unverified card', 'sports', 'sale', 'sold'
  );
  insert into public.orders (
    id, card_id, seller_id, buyer_id, amount, total_paid,
    payment_method, status
  ) values (
    o_unverified, c_unverified, u_seller, u_mixed, 50000, 50000,
    'wallet', 'completed'
  );
  failed := false;
  begin
    perform public.credit_wallet(
      u_seller, 50000, 'marketplace_sale', 'must fail', o_unverified::text
    );
  exception when others then failed := sqlerrm = 'credit_wallet_unverified_parent'; end;
  assert failed, 'unverified marketplace order minted seller funds';

  -- Legacy reconciliation reclassifies existing stored money only. Replaying
  -- the same evidence/key returns the original record without another source.
  select available_balance into stored_before from public.wallets where user_id = u_mixed;
  result := public.reconcile_legacy_wallet_fund(
    u_mixed, 50000, 'manual_bank_proof', 'MIXED-EVIDENCE-1',
    'approved legacy balance', '40000000-0000-4000-8000-000000000004',
    'operator:test', '{}'::jsonb
  );
  assert not (result ->> 'replayed')::boolean;
  assert (select available_balance = stored_before from public.wallets where user_id = u_mixed);
  result := public.reconcile_legacy_wallet_fund(
    u_mixed, 50000, 'manual_bank_proof', 'MIXED-EVIDENCE-1',
    'approved legacy balance', '40000000-0000-4000-8000-000000000004',
    'operator:test', '{}'::jsonb
  );
  assert (result ->> 'replayed')::boolean;
  assert (select count(*) = 1 from public.wallet_reconciliation_records
    where user_id = u_mixed and evidence_reference = 'MIXED-EVIDENCE-1');

  -- Verified withdrawal request and request retry.
  insert into public.wallets (user_id, available_balance) values (u_withdraw, 100000)
  on conflict (user_id) do update
  set available_balance = excluded.available_balance;
  insert into public.wallet_fund_sources (
    user_id, wallet_id, source_type, source_id, original_amount,
    remaining_amount, verification_status, credits_wallet, occurred_at
  ) select u_withdraw, id, 'legacy_reconciliation', 'withdraw-source', 100000,
      100000, 'verified', false, '2026-01-01T00:00:00Z'
    from public.wallets where user_id = u_withdraw;
  insert into public.seller_verifications (
    user_id, full_name, bank_name, bank_account_number, bank_account_name,
    bank_account_name_verified, bank_verified_at, status
  ) values (
    u_withdraw, 'Verified User', 'Test Bank', '012345678901', 'VERIFIED USER',
    'VERIFIED USER', now(), 'approved'
  );
  perform set_config('request.jwt.claim.sub', u_withdraw::text, true);
  result := public.request_wallet_withdrawal(100000, request_key);
  assert (result ->> 'ok')::boolean;
  withdrawal_id := (result ->> 'withdrawal_id')::uuid;
  assert (select available_balance = 0 and held_balance = 100000
    from public.wallets where user_id = u_withdraw);
  assert (select sum(amount) = 100000
    from public.wallet_fund_allocations
    where purpose_type = 'withdrawal' and purpose_id = withdrawal_id::text
      and status = 'reserved');
  result := public.request_wallet_withdrawal(100000, request_key);
  assert (result ->> 'replayed')::boolean;
  assert (select count(*) = 1 from public.wallet_withdrawals where user_id = u_withdraw);
  result := public.request_wallet_withdrawal(50000, request_key);
  assert not (result ->> 'ok')::boolean
    and result ->> 'error' = 'idempotency_conflict';

  -- GET statement never contains the full destination.
  result := public.get_wallet_withdrawal_statement(withdrawal_id);
  assert position('012345678901' in result::text) = 0, 'GET statement leaked full bank number';
  assert result #>> '{withdrawal,bank_account_masked}' = '••••8901';

  -- start_transfer is the final verification gate. Completion settles only the
  -- frozen attempt; retrying the same action key cannot debit twice.
  result := public.perform_withdrawal_action(
    withdrawal_id, 'verify_for_transfer',
    '50000000-0000-4000-8000-000000000001', 'admin:test', 'admin', '{}'::jsonb
  );
  assert (result ->> 'ok')::boolean;
  result := public.perform_withdrawal_action(
    withdrawal_id, 'start_transfer',
    '50000000-0000-4000-8000-000000000002', 'admin:test', 'admin', '{}'::jsonb
  );
  assert (result ->> 'ok')::boolean;
  attempt_id := (result ->> 'attempt_id')::uuid;
  assert result ->> 'bank_account_number' = '012345678901';
  failed := false;
  begin
    update public.withdrawal_transfer_attempts
    set amount_net = amount_net - 1
    where id = attempt_id;
  exception when others then
    failed := sqlerrm = 'transfer_attempt_snapshot_immutable';
  end;
  assert failed, 'transfer amount snapshot was mutable after start';
  update public.wallet_fund_sources
  set evidence = evidence || jsonb_build_object('reviewed_after_start', true)
  where user_id = u_withdraw;
  assert not exists (
    select 1 from public.withdrawal_action_requests
    where idempotency_key = '50000000-0000-4000-8000-000000000002'
      and action = 'start_transfer'
      and position('012345678901' in coalesce(response_payload::text, '')) > 0
  ), 'start_transfer persisted full bank data in its replay payload';
  result := public.perform_withdrawal_action(
    withdrawal_id, 'start_transfer',
    '50000000-0000-4000-8000-000000000002', 'admin:test', 'admin', '{}'::jsonb
  );
  assert (result ->> 'replayed')::boolean;
  assert result ->> 'bank_account_number' = '012345678901';

  result := public.perform_withdrawal_action(
    withdrawal_id, 'release_claim',
    '50000000-0000-4000-8000-000000000003', 'admin:test', 'admin', '{}'::jsonb
  );
  assert not (result ->> 'ok')::boolean;
  assert result ->> 'error' = 'claim_release_forbidden';

  result := public.perform_withdrawal_action(
    withdrawal_id, 'complete',
    '50000000-0000-4000-8000-000000000004', 'admin:test', 'admin',
    jsonb_build_object('transfer_reference', 'BANK-REF-001')
  );
  assert (result ->> 'ok')::boolean and result ->> 'status' = 'completed';
  assert (select held_balance = 0 and total_withdrawn = 100000
    from public.wallets where user_id = u_withdraw);
  assert (select count(*) = 2 from public.wallet_transactions
    where reference_id = withdrawal_id::text and reference_type = 'withdrawal_transfer_attempt');
  assert (select count(*) = 1 from public.notifications
    where user_id = u_withdraw and type = 'withdrawal_completed');
  result := public.perform_withdrawal_action(
    withdrawal_id, 'complete',
    '50000000-0000-4000-8000-000000000004', 'admin:test', 'admin',
    jsonb_build_object('transfer_reference', 'BANK-REF-001')
  );
  assert (result ->> 'replayed')::boolean;
  assert (select count(*) = 2 from public.wallet_transactions
    where reference_id = withdrawal_id::text and reference_type = 'withdrawal_transfer_attempt');
  assert (select count(*) = 1 from public.notifications
    where user_id = u_withdraw and type = 'withdrawal_completed');
  result := public.perform_withdrawal_action(
    withdrawal_id, 'complete',
    '50000000-0000-4000-8000-000000000004', 'admin:test', 'admin',
    jsonb_build_object('transfer_reference', 'BANK-REF-CONFLICT')
  );
  assert not (result ->> 'ok')::boolean
    and result ->> 'error' = 'idempotency_conflict';

  -- Returned bank transfer credits exactly net; the 5% fee remains retained.
  result := public.perform_withdrawal_action(
    withdrawal_id, 'record_returned',
    '50000000-0000-4000-8000-000000000005', 'moderator:test', 'moderator',
    jsonb_build_object(
      'return_reference', 'RETURN-001',
      'evidence', jsonb_build_object('bank_case', 'CASE-1')
    )
  );
  assert (result ->> 'amount_returned')::bigint = 95000;
  assert not (result ->> 'fee_refunded')::boolean;
  assert (select available_balance = 95000 from public.wallets where user_id = u_withdraw);
  assert (select original_amount = 95000 and remaining_amount = 95000
    from public.wallet_fund_sources
    where user_id = u_withdraw and source_type = 'withdrawal_return'
      and wallet_fund_sources.source_id = attempt_id::text);
  result := public.perform_withdrawal_action(
    withdrawal_id, 'record_returned',
    '50000000-0000-4000-8000-000000000005', 'moderator:test', 'moderator',
    jsonb_build_object(
      'return_reference', 'RETURN-001',
      'evidence', jsonb_build_object('bank_case', 'CASE-1')
    )
  );
  assert (result ->> 'replayed')::boolean;
  result := public.perform_withdrawal_action(
    withdrawal_id, 'record_returned',
    '50000000-0000-4000-8000-000000000005', 'moderator:test', 'moderator',
    jsonb_build_object(
      'return_reference', 'RETURN-CONFLICT',
      'evidence', jsonb_build_object('bank_case', 'CASE-1')
    )
  );
  assert not (result ->> 'ok')::boolean
    and result ->> 'error' = 'idempotency_conflict';
  result := public.perform_withdrawal_action(
    withdrawal_id, 'record_returned',
    '50000000-0000-4000-8000-000000000006', 'moderator:test', 'moderator',
    jsonb_build_object(
      'return_reference', 'RETURN-SECOND',
      'evidence', jsonb_build_object('bank_case', 'CASE-2')
    )
  );
  assert not (result ->> 'ok')::boolean
    and result ->> 'error' = 'return_already_recorded';
  assert (select available_balance = 95000 from public.wallets where user_id = u_withdraw);
  assert (select count(*) = 1 from public.wallet_fund_sources
    where user_id = u_withdraw and source_type = 'withdrawal_return');

  -- Legacy replay interleaves an open withdrawal at its request timestamp.
  insert into public.wallets (user_id, available_balance, held_balance)
  values (u_replay, 100000, 50000)
  on conflict (user_id) do update
  set available_balance = excluded.available_balance,
      held_balance = excluded.held_balance;
  insert into public.wallet_withdrawals (
    id, user_id, amount_requested, fee, amount_net, bank_name,
    bank_account_number, bank_account_name, status, reservation_model,
    ledger_recorded, created_at
  ) values (
    '60000000-0000-4000-8000-000000000001', u_replay, 50000, 2500, 47500,
    'Legacy Bank', '999988887777', 'REPLAY USER', 'pending', 'held', true,
    '2026-01-02T00:00:00Z'
  );
  result := public.replay_legacy_wallet_history(
    u_replay,
    jsonb_build_array(
      jsonb_build_object(
        'event_type', 'credit', 'source_type', 'payos_deposit',
        'source_id', 'legacy-deposit-1', 'amount', 200000,
        'occurred_at', '2026-01-01T00:00:00Z', 'sequence', 0,
        'evidence', jsonb_build_object('provider_export', 'P-1')
      ),
      jsonb_build_object(
        'event_type', 'debit', 'purpose_type', 'wallet_purchase',
        'purpose_id', 'legacy-purchase-1', 'amount', 50000, 'status', 'consumed',
        'occurred_at', '2026-01-03T00:00:00Z', 'sequence', 1
      )
    ),
    '60000000-0000-4000-8000-000000000002', 'operator:test'
  );
  assert (result ->> 'open_withdrawals_reserved')::integer = 1;
  balances := public.assert_wallet_fund_integrity(u_replay);
  assert (balances ->> 'verified_available')::bigint = 100000;
  assert (balances ->> 'verified_held')::bigint = 50000;
  assert (balances ->> 'unverified_available')::bigint = 0;
  assert (balances ->> 'unverified_held')::bigint = 0;
  assert not exists (
    select 1 from public.wallet_fund_allocations r
    join public.wallet_fund_allocations c on c.purpose_id = r.purpose_id
    where r.purpose_type = 'withdrawal' and r.status = 'reserved'
      and c.purpose_type = 'withdrawal' and c.status = 'consumed'
  );

  -- Reconciliation classifies existing money only and is idempotent.
  select available_balance into stored_before from public.wallets where user_id = u_replay;
  failed := false;
  begin
    perform public.reconcile_legacy_wallet_fund(
      u_replay, 1, 'manual_bank_proof', 'E-1', 'approved remainder',
      '60000000-0000-4000-8000-000000000003', 'operator:test', '{}'::jsonb
    );
  exception when others then
    failed := sqlerrm = 'reconciliation_exceeds_unverified_balance';
  end;
  assert failed, 'reconciliation exceeded unresolved balance';
  assert (select available_balance = stored_before from public.wallets where user_id = u_replay);

  -- Open pending withdrawals reserve only the provable amount. The remainder
  -- stays explicit as unverified held and the row remains fail-closed.
  insert into public.wallets (user_id, available_balance, held_balance)
  values (u_partial, 0, 100000)
  on conflict (user_id) do update
  set available_balance = excluded.available_balance,
      held_balance = excluded.held_balance;
  insert into public.wallet_withdrawals (
    id, user_id, amount_requested, fee, amount_net, bank_name,
    bank_account_number, bank_account_name, status, reservation_model,
    ledger_recorded, created_at
  ) values (
    '60000000-0000-4000-8000-000000000010', u_partial,
    100000, 5000, 95000, 'Legacy Bank', '101010109999', 'PARTIAL OPEN',
    'pending', 'held', true, '2026-01-02T00:00:00Z'
  );
  result := public.replay_legacy_wallet_history(
    u_partial,
    jsonb_build_array(jsonb_build_object(
      'event_type', 'credit', 'source_type', 'payos_deposit',
      'source_id', 'partial-open-deposit', 'amount', 60000,
      'occurred_at', '2026-01-01T00:00:00Z', 'sequence', 0,
      'evidence', jsonb_build_object('provider_export', 'P-PARTIAL')
    )),
    '60000000-0000-4000-8000-000000000011', 'operator:test'
  );
  assert (select funding_state = 'legacy_blocked' and recovery_required
    from public.wallet_withdrawals
    where id = '60000000-0000-4000-8000-000000000010');
  assert (select sum(amount) = 60000 from public.wallet_fund_allocations
    where purpose_id = '60000000-0000-4000-8000-000000000010'
      and status = 'reserved');
  balances := public.assert_wallet_fund_integrity(u_partial);
  assert (balances ->> 'verified_held')::bigint = 60000;
  assert (balances ->> 'unverified_held')::bigint = 40000;

  -- Even fully backed processing rows are never treated as a fresh pending
  -- claim at cutover; they require independent bank-transfer review.
  insert into public.wallets (user_id, available_balance, held_balance)
  values (u_processing, 0, 50000)
  on conflict (user_id) do update
  set available_balance = excluded.available_balance,
      held_balance = excluded.held_balance;
  insert into public.wallet_withdrawals (
    id, user_id, amount_requested, fee, amount_net, bank_name,
    bank_account_number, bank_account_name, status, reservation_model,
    ledger_recorded, created_at
  ) values (
    '60000000-0000-4000-8000-000000000020', u_processing,
    50000, 2500, 47500, 'Legacy Bank', '202020209999', 'PROCESSING OPEN',
    'processing', 'held', true, '2026-01-02T00:00:00Z'
  );
  perform public.replay_legacy_wallet_history(
    u_processing,
    jsonb_build_array(jsonb_build_object(
      'event_type', 'credit', 'source_type', 'payos_deposit',
      'source_id', 'processing-open-deposit', 'amount', 50000,
      'occurred_at', '2026-01-01T00:00:00Z', 'sequence', 0,
      'evidence', jsonb_build_object('provider_export', 'P-PROCESSING')
    )),
    '60000000-0000-4000-8000-000000000021', 'operator:test'
  );
  perform public.classify_open_financial_records('2026-01-03T00:00:00Z');
  assert (select funding_state = 'legacy_transfer_review_required'
      and status = 'processing' and recovery_required
    from public.wallet_withdrawals
    where id = '60000000-0000-4000-8000-000000000020');
end $$;

do $$
declare
  u_discrepancy uuid := '90000000-0000-4000-8000-000000000001';
  v_withdrawal_id uuid;
  result jsonb;
begin
  insert into auth.users (id, email)
  values (u_discrepancy, 'post-start-discrepancy@example.test');
  insert into public.profiles (id, email)
  values (u_discrepancy, 'post-start-discrepancy@example.test')
  on conflict (id) do update set email = excluded.email;
  insert into public.wallets (user_id, available_balance)
  values (u_discrepancy, 100000)
  on conflict (user_id) do update
  set available_balance = excluded.available_balance;
  insert into public.wallet_fund_sources (
    user_id, wallet_id, source_type, source_id, original_amount,
    remaining_amount, verification_status, credits_wallet
  ) select u_discrepancy, id, 'legacy_reconciliation', 'discrepancy-source',
      100000, 100000, 'verified', false
    from public.wallets where user_id = u_discrepancy;
  insert into public.seller_verifications (
    user_id, full_name, bank_name, bank_account_number, bank_account_name,
    bank_account_name_verified, bank_verified_at, status
  ) values (
    u_discrepancy, 'Discrepancy User', 'Test Bank', '888877776666',
    'DISCREPANCY USER', 'DISCREPANCY USER', now(), 'approved'
  );

  perform set_config('request.jwt.claim.sub', u_discrepancy::text, true);
  result := public.request_wallet_withdrawal(
    100000, '91000000-0000-4000-8000-000000000001'
  );
  v_withdrawal_id := (result ->> 'withdrawal_id')::uuid;
  perform public.perform_withdrawal_action(
    v_withdrawal_id, 'verify_for_transfer',
    '91000000-0000-4000-8000-000000000002', 'admin:discrepancy', 'admin', '{}'::jsonb
  );
  perform public.perform_withdrawal_action(
    v_withdrawal_id, 'start_transfer',
    '91000000-0000-4000-8000-000000000003', 'admin:discrepancy', 'admin', '{}'::jsonb
  );

  -- Simulate a post-start accounting discrepancy. Completion must preserve
  -- the external transfer reference and freeze recovery, never erase the
  -- attempt or reopen the withdrawal for a second transfer.
  update public.wallets set held_balance = 50000 where user_id = u_discrepancy;
  result := public.perform_withdrawal_action(
    v_withdrawal_id, 'complete',
    '91000000-0000-4000-8000-000000000004', 'admin:discrepancy', 'admin',
    jsonb_build_object('transfer_reference', 'BANK-DISCREPANCY-1')
  );
  assert (result ->> 'ok')::boolean
    and (result ->> 'recorded')::boolean
    and (result ->> 'recovery_required')::boolean;
  assert (select status = 'processing' and recovery_required
      and active_transfer_attempt_id is not null
    from public.wallet_withdrawals where id = v_withdrawal_id);
  assert (select status = 'unknown' and recovery_required
      and transfer_reference = 'BANK-DISCREPANCY-1'
    from public.withdrawal_transfer_attempts where withdrawal_id = v_withdrawal_id);
  result := public.perform_withdrawal_action(
    v_withdrawal_id, 'start_transfer',
    '91000000-0000-4000-8000-000000000005', 'admin:discrepancy', 'admin', '{}'::jsonb
  );
  assert not (result ->> 'ok')::boolean;
  assert (select count(*) = 1 from public.withdrawal_transfer_attempts
    where withdrawal_id = v_withdrawal_id);

  -- Restore the simulated corruption so deferred conservation constraints can
  -- validate the fixture transaction at commit/rollback time.
  update public.wallets set held_balance = 100000 where user_id = u_discrepancy;
  perform public.assert_wallet_fund_integrity(u_discrepancy);
end $$;

do $$
declare
  u_buyer uuid := '65000000-0000-4000-8000-000000000001';
  u_seller uuid := '65000000-0000-4000-8000-000000000002';
  card_id uuid := '66000000-0000-4000-8000-000000000001';
  cancel_card_id uuid := '66000000-0000-4000-8000-000000000002';
  staged_order_id uuid := '67000000-0000-4000-8000-000000000001';
  cancel_order_id uuid := '67000000-0000-4000-8000-000000000002';
  action_key uuid := '68000000-0000-4000-8000-000000000001';
  spec jsonb;
  result jsonb;
  payment_id uuid;
  link_claim_id uuid;
  failed boolean;
begin
  insert into auth.users (id, email) values
    (u_buyer, 'payos-stage-buyer@example.test'),
    (u_seller, 'payos-stage-seller@example.test');
  insert into public.profiles (id, email) values
    (u_buyer, 'payos-stage-buyer@example.test'),
    (u_seller, 'payos-stage-seller@example.test')
  on conflict (id) do update set email = excluded.email;
  insert into public.cards (
    id, seller_id, name, category, listing_type, price, status
  ) values (
    card_id, u_seller, 'PayOS staged card', 'sports', 'sale', 70000, 'active'
  );

  spec := jsonb_build_array(jsonb_build_object(
    'order_id', staged_order_id, 'card_id', card_id, 'seller_id', u_seller,
    'amount', 70000, 'shipping_fee', 5000, 'total_paid', 75000,
    'metadata', jsonb_build_object('api_request_hash', repeat('a', 64)),
    'shipping_address', 'Test address',
    'to_name', 'PayOS Buyer', 'to_phone', '0900000000',
    'to_district_id', 1, 'to_district_name', 'District',
    'to_province_id', 1, 'to_province_name', 'Province',
    'to_ward_code', '001', 'to_ward_name', 'Ward',
    'to_address_detail', 'Test address'
  ));
  result := public.stage_payos_marketplace_checkout(
    u_buyer, 86000001, spec, action_key, now() + interval '15 minutes'
  );
  assert (result ->> 'ok')::boolean and not (result ->> 'replayed')::boolean;
  payment_id := (result #>> '{payment_order,id}')::uuid;
  assert (select status = 'pending' and amount = 75000
    from public.payment_orders where id = payment_id);
  assert (select status = 'pending_payment' and payment_order_id = payment_id
    from public.orders where id = staged_order_id);
  assert (select status = 'in_transaction' and reserved_until is not null
    from public.cards where id = card_id);
  result := public.get_marketplace_checkout_replay(
    u_buyer, action_key, repeat('a', 64)
  );
  assert (result ->> 'found')::boolean and (result ->> 'replayed')::boolean;
  assert result ->> 'payment_method' = 'direct_payos';
  failed := false;
  begin
    perform public.get_marketplace_checkout_replay(
      u_buyer, action_key, repeat('c', 64)
    );
  exception when others then failed := sqlerrm = 'idempotency_conflict'; end;
  assert failed, 'PayOS route replay accepted a conflicting request hash';

  result := public.stage_payos_marketplace_checkout(
    u_buyer, 86009999, spec, action_key, now() + interval '20 minutes'
  );
  assert (result ->> 'replayed')::boolean;
  assert (select count(*) = 1 from public.payment_orders
    where user_id = u_buyer and server_idempotency_key = action_key);
  assert (select count(*) = 1 from public.orders where payment_order_id = payment_id);

  failed := false;
  begin
    perform public.stage_payos_marketplace_checkout(
      u_buyer, 86000002,
      jsonb_set(spec, '{0,to_phone}', '"0911111111"'::jsonb),
      action_key, now() + interval '15 minutes'
    );
  exception when others then failed := sqlerrm = 'idempotency_conflict'; end;
  assert failed, 'PayOS staging accepted a conflicting idempotency payload';

  result := public.claim_payos_payment_link_creation(u_buyer, 86000001);
  assert (result ->> 'claimed')::boolean;
  link_claim_id := (result ->> 'claim_id')::uuid;
  result := public.claim_payos_payment_link_creation(u_buyer, 86000001);
  assert not (result ->> 'claimed')::boolean
    and (result ->> 'recovery_required')::boolean;
  perform public.attach_claimed_payos_payment_link(
    u_buyer, 86000001, link_claim_id, 'PAYOS-LINK-1', 'https://pay.test/link-1'
  );
  result := public.claim_payos_payment_link_creation(u_buyer, 86000001);
  assert (result ->> 'attached')::boolean;
  assert result ->> 'checkout_url' = 'https://pay.test/link-1';

  result := public.record_payos_webhook(
    'payos-marketplace-paid-1', 86000001, '00', 75000, 'VND', true,
    jsonb_build_object('reference', 'PAYOS-MARKET-1'), now()
  );
  assert (result ->> 'ok')::boolean and result ->> 'payment_status' = 'paid';
  assert (select status = 'paid' from public.orders where id = staged_order_id);
  assert (select status = 'sold' from public.cards where id = card_id);
  assert (select verified_amount = 75000 and classification = 'native_verified_escrow'
    from public.marketplace_order_funding f where f.order_id = staged_order_id);

  result := public.record_payos_webhook(
    'payos-marketplace-late-cancel-1', 86000001, '01', 75000, 'VND', true,
    '{}'::jsonb, now() + interval '1 second'
  );
  assert result ->> 'payment_status' = 'paid';
  assert (result ->> 'ignored_out_of_order_event')::boolean;
  assert (select status = 'paid' from public.orders where id = staged_order_id);
  assert (select status = 'sold' from public.cards where id = card_id);

  perform public.perform_marketplace_order_action(
    staged_order_id, 'ship', u_seller,
    '68000000-0000-4000-8000-000000000003',
    jsonb_build_object(
      'shipping_provider', 'ghn', 'tracking_number', 'PAYOS-TRACK-1',
      'auto_complete_at', now() + interval '8 days'
    )
  );
  result := public.perform_marketplace_order_action(
    staged_order_id, 'confirm_received', u_buyer,
    '68000000-0000-4000-8000-000000000004', '{}'::jsonb
  );
  assert result ->> 'status' = 'completed';
  assert (select available_balance = 70000 from public.wallets where user_id = u_seller);
  assert (select verification_status = 'verified' and original_amount = 70000
    from public.wallet_fund_sources
    where user_id = u_seller and source_type = 'marketplace_sale'
      and source_id = staged_order_id::text);

  insert into public.cards (
    id, seller_id, name, category, listing_type, price, status
  ) values (
    cancel_card_id, u_seller, 'Cancelled PayOS card', 'sports', 'sale', 30000, 'active'
  );
  spec := jsonb_build_array(jsonb_build_object(
    'order_id', cancel_order_id, 'card_id', cancel_card_id, 'seller_id', u_seller,
    'amount', 30000, 'shipping_fee', 0, 'total_paid', 30000,
    'metadata', jsonb_build_object('api_request_hash', repeat('b', 64)),
    'shipping_address', 'Test address',
    'to_name', 'PayOS Buyer', 'to_phone', '0900000000',
    'to_district_id', 1, 'to_district_name', 'District',
    'to_province_id', 1, 'to_province_name', 'Province',
    'to_ward_code', '001', 'to_ward_name', 'Ward',
    'to_address_detail', 'Test address'
  ));
  perform public.stage_payos_marketplace_checkout(
    u_buyer, 86000002, spec, '68000000-0000-4000-8000-000000000002',
    now() + interval '15 minutes'
  );
  result := public.record_payos_webhook(
    'payos-marketplace-cancel-1', 86000002, '01', 30000, 'VND', true,
    '{}'::jsonb, now()
  );
  assert result ->> 'payment_status' = 'cancelled';
  assert (select status = 'cancelled' from public.orders where id = cancel_order_id);
  assert (select status = 'active' and reserved_until is null
    from public.cards where id = cancel_card_id);
  assert not exists (select 1 from public.marketplace_order_funding
    where order_id = cancel_order_id);
end $$;

do $$
declare
  u_buyer uuid := '61000000-0000-4000-8000-000000000001';
  u_seller uuid := '61000000-0000-4000-8000-000000000002';
  card_ok uuid := '62000000-0000-4000-8000-000000000001';
  card_fail uuid := '62000000-0000-4000-8000-000000000002';
  order_ok uuid := '63000000-0000-4000-8000-000000000001';
  order_fail uuid := '63000000-0000-4000-8000-000000000002';
  action_key uuid := '64000000-0000-4000-8000-000000000001';
  spec jsonb;
  ship_payload jsonb;
  result jsonb;
  failed boolean;
begin
  insert into auth.users (id, email) values
    (u_buyer, 'atomic-buyer@example.test'),
    (u_seller, 'atomic-seller@example.test');
  insert into public.profiles (id, email) values
    (u_buyer, 'atomic-buyer@example.test'),
    (u_seller, 'atomic-seller@example.test')
  on conflict (id) do update set email = excluded.email;
  insert into public.wallets (user_id, available_balance) values (u_buyer, 100000)
  on conflict (user_id) do update
  set available_balance = excluded.available_balance;
  insert into public.wallet_fund_sources (
    user_id, wallet_id, source_type, source_id, original_amount,
    remaining_amount, verification_status, credits_wallet
  ) select u_buyer, id, 'legacy_reconciliation', 'atomic-source', 100000,
      100000, 'verified', false from public.wallets where user_id = u_buyer;
  insert into public.cards (
    id, seller_id, name, category, listing_type, price, status
  )
  values
    (card_ok, u_seller, 'Atomic card', 'sports', 'sale', 60000, 'active'),
    (card_fail, u_seller, 'Rollback card', 'sports', 'sale', 80000, 'active');

  spec := jsonb_build_array(jsonb_build_object(
    'order_id', order_ok, 'card_id', card_ok, 'seller_id', u_seller,
    'amount', 60000, 'shipping_fee', 0, 'total_paid', 60000,
    'metadata', jsonb_build_object('api_request_hash', repeat('b', 64)),
    'shipping_address', 'Test address',
    'to_name', 'Atomic Buyer', 'to_phone', '0900000000',
    'to_district_id', 1, 'to_district_name', 'District',
    'to_province_id', 1, 'to_province_name', 'Province',
    'to_ward_code', '001', 'to_ward_name', 'Ward',
    'to_address_detail', 'Test address'
  ));
  result := public.create_verified_wallet_marketplace_orders(
    u_buyer, spec, action_key, 'atomic wallet order test'
  );
  assert (result ->> 'ok')::boolean and not (result ->> 'replayed')::boolean;
  assert (select available_balance = 40000 from public.wallets where user_id = u_buyer);
  assert (select status = 'paid' from public.orders where id = order_ok);
  assert (select status = 'sold' from public.cards where id = card_ok);
  assert (select verified_amount = 60000 and classification = 'native_verified_escrow'
    from public.marketplace_order_funding where order_id = order_ok);
  assert (select coalesce(sum(amount), 0) = 60000
    from public.wallet_fund_allocations
    where purpose_type = 'wallet_purchase' and purpose_id = order_ok::text
      and status = 'consumed');
  result := public.get_marketplace_checkout_replay(
    u_buyer, action_key, repeat('b', 64)
  );
  assert (result ->> 'found')::boolean and (result ->> 'replayed')::boolean;
  assert result ->> 'payment_method' = 'wallet';

  result := public.create_verified_wallet_marketplace_orders(
    u_buyer, spec, action_key, 'atomic wallet order test'
  );
  assert (result ->> 'replayed')::boolean;
  assert (select count(*) = 1 from public.orders where id = order_ok);
  assert (select count(*) = 1 from public.wallet_transactions
    where user_id = u_buyer and idempotency_key = action_key);

  failed := false;
  begin
    perform public.create_verified_wallet_marketplace_orders(
      u_buyer,
      jsonb_set(spec, '{0,to_phone}', '"0911111111"'::jsonb),
      action_key,
      'conflicting retry'
    );
  exception when others then failed := sqlerrm = 'idempotency_conflict'; end;
  assert failed, 'wallet order action key accepted a conflicting payload';

  failed := false;
  begin
    perform public.create_verified_wallet_marketplace_orders(
      u_buyer,
      jsonb_build_array(jsonb_build_object(
        'order_id', order_fail, 'card_id', card_fail, 'seller_id', u_seller,
        'amount', 80000, 'shipping_fee', 0, 'total_paid', 80000,
        'metadata', '{}'::jsonb, 'shipping_address', 'Test address',
        'to_name', 'Atomic Buyer', 'to_phone', '0900000000',
        'to_district_id', 1, 'to_district_name', 'District',
        'to_province_id', 1, 'to_province_name', 'Province',
        'to_ward_code', '001', 'to_ward_name', 'Ward',
        'to_address_detail', 'Test address'
      )),
      '64000000-0000-4000-8000-000000000002',
      'must roll back'
    );
  exception when others then failed := sqlerrm = 'insufficient_verified_balance'; end;
  assert failed, 'underfunded atomic order did not fail';
  assert not exists (select 1 from public.orders where id = order_fail);
  assert (select status = 'active' from public.cards where id = card_fail);
  assert (select available_balance = 40000 from public.wallets where user_id = u_buyer);

  ship_payload := jsonb_build_object(
    'shipping_provider', 'ghn', 'tracking_number', 'TRACK-ATOMIC-1',
    'auto_complete_at', now() + interval '8 days'
  );
  result := public.perform_marketplace_order_action(
    order_ok, 'ship', u_seller, '64000000-0000-4000-8000-000000000003',
    ship_payload
  );
  assert result ->> 'status' = 'shipping';
  result := public.perform_marketplace_order_action(
    order_ok, 'ship', u_seller, '64000000-0000-4000-8000-000000000003',
    ship_payload
  );
  assert (result ->> 'replayed')::boolean;
  assert (select count(*) = 1 from public.notifications
    where order_id = order_ok and type = 'order_shipped');

  result := public.perform_marketplace_order_action(
    order_ok, 'confirm_received', u_buyer,
    '64000000-0000-4000-8000-000000000004', '{}'::jsonb
  );
  assert result ->> 'status' = 'completed';
  assert (select available_balance = 60000 from public.wallets where user_id = u_seller);
  result := public.perform_marketplace_order_action(
    order_ok, 'confirm_received', u_buyer,
    '64000000-0000-4000-8000-000000000004', '{}'::jsonb
  );
  assert (result ->> 'replayed')::boolean;
  assert (select count(*) = 1 from public.notifications
    where order_id = order_ok and type = 'order_completed');
end $$;

do $$
declare
  u_payos uuid := '70000000-0000-4000-8000-000000000001';
  u_market_seller uuid := '70000000-0000-4000-8000-000000000002';
  u_claim uuid := '70000000-0000-4000-8000-000000000003';
  u_legacy uuid := '70000000-0000-4000-8000-000000000004';
  card_id uuid := '71000000-0000-4000-8000-000000000001';
  order_id uuid := '72000000-0000-4000-8000-000000000001';
  payment_id uuid := '73000000-0000-4000-8000-000000000001';
  withdrawal_id uuid;
  result jsonb;
  event_id uuid;
  failed boolean;
begin
  insert into auth.users (id, email) values
    (u_payos, 'payos@example.test'),
    (u_market_seller, 'market-seller@example.test'),
    (u_claim, 'claim@example.test'),
    (u_legacy, 'legacy@example.test');
  insert into public.profiles (id, email) values
    (u_payos, 'payos@example.test'),
    (u_market_seller, 'market-seller@example.test'),
    (u_claim, 'claim@example.test'),
    (u_legacy, 'legacy@example.test')
  on conflict (id) do update set email = excluded.email;

  -- Signed successful deposit creates one source/ledger; webhook replay does
  -- not credit again. Cancel/fraud events never create sources.
  insert into public.payment_orders (
    id, user_id, order_code, package_type, amount, currency, status,
    server_idempotency_key
  ) values (
    payment_id, u_payos, 81000001, 'deposit', 200000, 'VND', 'pending',
    '74000000-0000-4000-8000-000000000001'
  );
  result := public.record_payos_webhook(
    'payos-valid-1', 81000001, '00', 200000, 'VND', true,
    jsonb_build_object('reference', 'PAYOS-VALID-1'), now()
  );
  assert (result ->> 'ok')::boolean;
  assert (select available_balance = 200000 and total_deposited = 200000
    from public.wallets where user_id = u_payos);
  assert (select count(*) = 1 from public.wallet_fund_sources
    where user_id = u_payos and source_type = 'payos_deposit');
  result := public.record_payos_webhook(
    'payos-valid-1', 81000001, '00', 200000, 'VND', true,
    jsonb_build_object('reference', 'PAYOS-VALID-1'), now()
  );
  assert (select available_balance = 200000 from public.wallets where user_id = u_payos);

  insert into public.payment_orders (
    user_id, order_code, package_type, amount, currency, status,
    server_idempotency_key
  ) values
    (u_payos, 81000002, 'deposit', 50000, 'VND', 'pending',
      '74000000-0000-4000-8000-000000000002'),
    (u_payos, 81000003, 'deposit', 50000, 'VND', 'pending',
      '74000000-0000-4000-8000-000000000003');
  perform public.record_payos_webhook(
    'payos-cancel-1', 81000002, '01', 50000, 'VND', true, '{}'::jsonb, now()
  );
  result := public.record_payos_webhook(
    'payos-fraud-1', 81000003, '00', 49999, 'VND', true, '{}'::jsonb, now()
  );
  assert not (result ->> 'ok')::boolean;
  assert (select count(*) = 1 from public.wallet_fund_sources
    where user_id = u_payos and source_type = 'payos_deposit');

  -- A valid provider payment cannot fund marketplace escrow for a buyer that
  -- does not match the server-owned payment order user binding.
  insert into public.cards (
    id, seller_id, name, category, listing_type, status
  ) values (
    '71000000-0000-4000-8000-000000000099', u_payos,
    'Mismatched PayOS buyer', 'sports', 'sale', 'in_transaction'
  );
  insert into public.payment_orders (
    id, user_id, order_code, package_type, amount, currency, status,
    server_idempotency_key
  ) values (
    '73000000-0000-4000-8000-000000000099', u_payos, 81000007,
    'marketplace_order', 50000, 'VND', 'pending',
    '74000000-0000-4000-8000-000000000099'
  );
  insert into public.orders (
    id, card_id, seller_id, buyer_id, amount, total_paid,
    payment_method, payment_order_id, status
  ) values (
    '72000000-0000-4000-8000-000000000099',
    '71000000-0000-4000-8000-000000000099', u_payos, u_market_seller,
    50000, 50000, 'direct_payos',
    '73000000-0000-4000-8000-000000000099', 'pending_payment'
  );
  result := public.record_payos_webhook(
    'payos-user-binding-mismatch', 81000007, '00', 50000, 'VND', true,
    jsonb_build_object('reference', 'PAYOS-BINDING-MISMATCH'), now()
  );
  assert not (result ->> 'ok')::boolean
    and result ->> 'error' = 'marketplace_order_binding_mismatch';
  assert (select status = 'review_required' from public.payment_webhook_events
    where provider_event_key = 'payos-user-binding-mismatch');
  assert not exists (select 1 from public.marketplace_order_funding
    where marketplace_order_funding.order_id = '72000000-0000-4000-8000-000000000099');

  -- DB maintenance blocks old direct money mutations while signed webhooks are
  -- accepted into a deferred inbox.
  perform public.set_financial_maintenance(true, 'test', 'cutover-test', now());
  failed := false;
  begin
    update public.wallets set available_balance = available_balance + 1 where user_id = u_payos;
  exception when others then failed := sqlerrm = 'financial_maintenance_active'; end;
  assert failed, 'maintenance gate allowed direct wallet mutation';
end $$;

-- Continue with an explicit operator bypass for cutover fixture setup.
do $$
declare
  u_payos uuid := '70000000-0000-4000-8000-000000000001';
  u_market_seller uuid := '70000000-0000-4000-8000-000000000002';
  u_claim uuid := '70000000-0000-4000-8000-000000000003';
  u_legacy uuid := '70000000-0000-4000-8000-000000000004';
  card_id uuid := '71000000-0000-4000-8000-000000000001';
  blocked_card_id uuid := '71000000-0000-4000-8000-000000000002';
  partial_card_id uuid := '71000000-0000-4000-8000-000000000003';
  disputed_card_id uuid := '71000000-0000-4000-8000-000000000004';
  v_order_id uuid := '72000000-0000-4000-8000-000000000001';
  blocked_order_id uuid := '72000000-0000-4000-8000-000000000002';
  partial_order_id uuid := '72000000-0000-4000-8000-000000000003';
  disputed_order_id uuid := '72000000-0000-4000-8000-000000000004';
  payment_id uuid := '73000000-0000-4000-8000-000000000002';
  blocked_payment_id uuid := '73000000-0000-4000-8000-000000000003';
  v_source_id uuid;
  v_withdrawal_id uuid;
  result jsonb;
begin
  perform set_config('cardverse.maintenance_bypass', 'on', true);
  insert into public.payment_orders (
    user_id, order_code, package_type, amount, currency, status,
    server_idempotency_key
  ) values (
    u_payos, 81000004, 'deposit', 50000, 'VND', 'pending',
    '74000000-0000-4000-8000-000000000004'
  );
  perform set_config('cardverse.maintenance_bypass', 'off', true);
  result := public.record_payos_webhook(
    'payos-deferred-1', 81000004, '00', 50000, 'VND', true, '{}'::jsonb, now()
  );
  assert result ->> 'status' = 'deferred';
  assert (select available_balance = 200000 from public.wallets where user_id = u_payos);

  -- Independent legacy PayOS evidence classifies an open direct-PayOS escrow
  -- without running the live webhook credit path.
  perform set_config('cardverse.maintenance_bypass', 'on', true);
  insert into public.cards (
    id, seller_id, name, category, listing_type, status
  ) values (
    card_id, u_market_seller, 'Open escrow card', 'sports', 'sale', 'sold'
  );
  insert into public.payment_orders (
    id, user_id, order_code, package_type, amount, currency, status,
    server_idempotency_key
  ) values (
    payment_id, u_payos, 81000005, 'marketplace_order', 75000, 'VND', 'paid',
    '74000000-0000-4000-8000-000000000005'
  );
  insert into public.orders (
    id, card_id, seller_id, buyer_id, amount, total_paid, payment_method,
    payment_order_id, status, created_at
  ) values (
    v_order_id, card_id, u_market_seller, u_payos, 75000, 75000,
    'direct_payos', payment_id, 'shipping', now() - interval '1 hour'
  );
  perform public.record_legacy_payos_evidence(
    'legacy-open-order-proof', 81000005, 75000, 'VND',
    jsonb_build_object('provider_export', 'EXPORT-1'), now() - interval '2 hours'
  );
  insert into public.cards (
    id, seller_id, name, category, listing_type, status
  ) values
    (blocked_card_id, u_market_seller, 'Unproven paid row', 'sports', 'sale', 'sold'),
    (partial_card_id, u_market_seller, 'Partial wallet escrow', 'sports', 'sale', 'sold'),
    (disputed_card_id, u_market_seller, 'Disputed escrow', 'sports', 'sale', 'sold');
  insert into public.payment_orders (
    id, user_id, order_code, package_type, amount, currency, status,
    server_idempotency_key
  ) values (
    blocked_payment_id, u_payos, 81000006, 'marketplace_order', 75000, 'VND', 'paid',
    '74000000-0000-4000-8000-000000000006'
  );
  insert into public.orders (
    id, card_id, seller_id, buyer_id, amount, total_paid, payment_method,
    payment_order_id, status, created_at
  ) values
    (blocked_order_id, blocked_card_id, u_market_seller, u_payos, 75000, 75000,
      'direct_payos', blocked_payment_id, 'shipping', now() - interval '1 hour'),
    (partial_order_id, partial_card_id, u_market_seller, u_payos, 75000, 75000,
      'wallet', null, 'paid', now() - interval '1 hour'),
    (disputed_order_id, disputed_card_id, u_market_seller, u_payos, 75000, 75000,
      'direct_payos', null, 'disputed', now() - interval '1 hour');
  select id into v_source_id from public.wallet_fund_sources
  where user_id = u_payos and source_type = 'payos_deposit' limit 1;
  update public.wallet_fund_sources set remaining_amount = remaining_amount - 30000
  where id = v_source_id;
  insert into public.wallet_fund_allocations (
    fund_source_id, user_id, purpose_type, purpose_id, amount, status,
    idempotency_key, group_idempotency_key, consumed_at
  ) values (
    v_source_id, u_payos, 'wallet_purchase', partial_order_id::text, 30000,
    'consumed', '74000000-0000-4000-8000-000000000007',
    '74000000-0000-4000-8000-000000000008', now() - interval '1 hour'
  );
  result := public.classify_open_financial_records(now());
  assert (select classification = 'backfilled_verified_escrow'
      and verified_amount = 75000 and unverified_amount = 0
    from public.marketplace_order_funding f where f.order_id = v_order_id);
  assert (select classification = 'legacy_escrow_blocked'
      and verified_amount = 0 and unverified_amount = 75000
    from public.marketplace_order_funding where order_id = blocked_order_id),
    'historical paid row without independent PayOS evidence became verified';
  assert (select classification = 'legacy_escrow_blocked'
      and verified_amount = 30000 and unverified_amount = 45000
    from public.marketplace_order_funding where order_id = partial_order_id),
    'partial wallet escrow was not classified fail-closed';
  assert (select classification = 'disputed_frozen'
    from public.marketplace_order_funding where order_id = disputed_order_id),
    'open disputed escrow was not frozen';
  perform public.record_legacy_payos_evidence(
    'legacy-open-order-proof-late', 81000006, 75000, 'VND',
    jsonb_build_object('provider_export', 'EXPORT-LATE'), now() - interval '30 minutes'
  );
  perform public.classify_open_financial_records(now());
  assert (select classification = 'backfilled_verified_escrow'
      and verified_amount = 75000 and unverified_amount = 0
    from public.marketplace_order_funding where order_id = blocked_order_id),
    'approved incremental PayOS evidence did not upgrade blocked escrow';
  perform public.set_financial_maintenance(false, 'test', 'cutover-finished', null);
  perform set_config('cardverse.maintenance_bypass', 'off', true);

  -- Deferred inbox events drain exactly once after maintenance is disabled.
  result := public.drain_deferred_payos_webhooks(100);
  assert jsonb_array_length(result -> 'results') = 1;
  assert (select available_balance = 250000 from public.wallets where user_id = u_payos);
  assert (select count(*) = 2 from public.wallet_fund_sources
    where user_id = u_payos and source_type = 'payos_deposit');
  result := public.drain_deferred_payos_webhooks(100);
  assert jsonb_array_length(result -> 'results') = 0;
  assert (select available_balance = 250000 from public.wallets where user_id = u_payos),
    'deferred webhook replay double-credited the wallet';

  -- Expired claims return to pending only before an attempt exists.
  insert into public.wallets (user_id, available_balance) values (u_claim, 100000)
  on conflict (user_id) do update
  set available_balance = excluded.available_balance;
  insert into public.wallet_fund_sources (
    user_id, wallet_id, source_type, source_id, original_amount,
    remaining_amount, verification_status, credits_wallet
  ) select u_claim, id, 'legacy_reconciliation', 'claim-source', 100000,
      100000, 'verified', false from public.wallets where user_id = u_claim;
  insert into public.seller_verifications (
    user_id, full_name, bank_name, bank_account_number, bank_account_name,
    bank_account_name_verified, bank_verified_at, status
  ) values (
    u_claim, 'Claim User', 'Bank', '111122223333', 'CLAIM USER',
    'CLAIM USER', now(), 'approved'
  );
  perform set_config('request.jwt.claim.sub', u_claim::text, true);
  result := public.request_wallet_withdrawal(
    100000, '75000000-0000-4000-8000-000000000001'
  );
  v_withdrawal_id := (result ->> 'withdrawal_id')::uuid;
  perform public.perform_withdrawal_action(
    v_withdrawal_id, 'verify_for_transfer',
    '75000000-0000-4000-8000-000000000002', 'admin:claim', 'admin', '{}'::jsonb
  );
  update public.wallet_withdrawals set processing_expires_at = now() - interval '1 minute'
  where id = v_withdrawal_id;
  assert public.recover_expired_withdrawal_claims() = 1;
  assert (select status = 'pending' and verification_claim_id is null
    from public.wallet_withdrawals where id = v_withdrawal_id);

  -- A transfer-started failure can only enter the moderator recovery path;
  -- returning to pending preserves the original reservation/held funds.
  perform public.perform_withdrawal_action(
    v_withdrawal_id, 'verify_for_transfer',
    '75000000-0000-4000-8000-000000000003', 'moderator:claim', 'moderator', '{}'::jsonb
  );
  perform public.perform_withdrawal_action(
    v_withdrawal_id, 'start_transfer',
    '75000000-0000-4000-8000-000000000004', 'moderator:claim', 'moderator', '{}'::jsonb
  );
  update public.wallet_withdrawals
  set transfer_started_at = now() - interval '31 minutes'
  where id = v_withdrawal_id;
  assert public.flag_stale_withdrawal_transfers() = 1;
  assert (select status = 'processing' and recovery_required
    from public.wallet_withdrawals where id = v_withdrawal_id),
    'started stale transfer was reset instead of entering recovery';
  result := public.perform_withdrawal_action(
    v_withdrawal_id, 'mark_transfer_failed',
    '75000000-0000-4000-8000-000000000005', 'moderator:claim', 'moderator',
    jsonb_build_object(
      'reason', 'bank rejected before debit', 'outcome', 'pending',
      'evidence', jsonb_build_object('bank_case', 'FAIL-1')
    )
  );
  assert result ->> 'status' = 'pending';
  assert (select held_balance = 100000 from public.wallets where user_id = u_claim);
  assert (select sum(amount) = 100000 from public.wallet_fund_allocations
    where purpose_id = v_withdrawal_id::text and status = 'reserved');

  -- A later bank-confirmed failure may reject and release the exact original
  -- reservation. The available/held mutation has one idempotent release ledger.
  perform public.perform_withdrawal_action(
    v_withdrawal_id, 'verify_for_transfer',
    '75000000-0000-4000-8000-000000000006', 'moderator:claim', 'moderator', '{}'::jsonb
  );
  perform public.perform_withdrawal_action(
    v_withdrawal_id, 'start_transfer',
    '75000000-0000-4000-8000-000000000007', 'moderator:claim', 'moderator', '{}'::jsonb
  );
  result := public.perform_withdrawal_action(
    v_withdrawal_id, 'mark_transfer_failed',
    '75000000-0000-4000-8000-000000000008', 'moderator:claim', 'moderator',
    jsonb_build_object(
      'reason', 'bank confirmed no debit', 'outcome', 'rejected',
      'evidence', jsonb_build_object('bank_case', 'FAIL-2')
    )
  );
  assert result ->> 'status' = 'rejected';
  result := public.perform_withdrawal_action(
    v_withdrawal_id, 'mark_transfer_failed',
    '75000000-0000-4000-8000-000000000008', 'moderator:claim', 'moderator',
    jsonb_build_object(
      'reason', 'bank confirmed no debit', 'outcome', 'rejected',
      'evidence', jsonb_build_object('bank_case', 'FAIL-2')
    )
  );
  assert (result ->> 'replayed')::boolean;
  result := public.perform_withdrawal_action(
    v_withdrawal_id, 'mark_transfer_failed',
    '75000000-0000-4000-8000-000000000008', 'moderator:claim', 'moderator',
    jsonb_build_object(
      'reason', 'conflicting retry', 'outcome', 'rejected',
      'evidence', jsonb_build_object('bank_case', 'FAIL-2')
    )
  );
  assert not (result ->> 'ok')::boolean
    and result ->> 'error' = 'idempotency_conflict';
  assert (select available_balance = 100000 and held_balance = 0
    from public.wallets where user_id = u_claim);
  assert (select sum(amount) = 100000 from public.wallet_fund_allocations
    where purpose_id = v_withdrawal_id::text and status = 'released');
  assert (select count(*) = 1 from public.wallet_transactions
    where user_id = u_claim and reference_id = v_withdrawal_id::text
      and type = 'withdrawal_hold_release' and not affects_balance);

  -- A legacy withdrawal confirmed externally sent is always represented by an
  -- immutable attempt and separate net/fee ledger entries, even with no
  -- verified backing; the shortfall remains explicitly in recovery.
  insert into public.wallets (user_id, available_balance, held_balance)
  values (u_legacy, 0, 50000)
  on conflict (user_id) do update
  set available_balance = excluded.available_balance,
      held_balance = excluded.held_balance;
  insert into public.wallet_withdrawals (
    id, user_id, amount_requested, fee, amount_net, bank_name,
    bank_account_number, bank_account_name, status, reservation_model,
    ledger_recorded, funding_state, recovery_required
  ) values (
    '76000000-0000-4000-8000-000000000001', u_legacy, 50000, 2500, 47500,
    'Legacy Bank', '444455556666', 'LEGACY USER', 'processing', 'held', true,
    'legacy_transfer_review_required', true
  );
  result := public.perform_withdrawal_action(
    '76000000-0000-4000-8000-000000000001', 'resolve_legacy',
    '76000000-0000-4000-8000-000000000002', 'operator:test', 'operator',
    jsonb_build_object(
      'outcome', 'confirmed_sent', 'reason', 'bank statement matched',
      'transfer_reference', 'LEGACY-BANK-1',
      'evidence', jsonb_build_object('statement', 'S-1')
    )
  );
  assert result ->> 'status' = 'completed';
  assert (result ->> 'legacy_unverified_outflow')::bigint = 50000;
  assert (select count(*) = 2 from public.wallet_transactions
    where reference_id = '76000000-0000-4000-8000-000000000001'
      and reference_type = 'legacy_withdrawal_transfer');
  assert (select status = 'confirmed' and transfer_reference = 'LEGACY-BANK-1'
    from public.withdrawal_transfer_attempts a
    where a.withdrawal_id = '76000000-0000-4000-8000-000000000001');
end $$;

do $$
declare
  u_owner uuid := '77000000-0000-4000-8000-000000000001';
  u_other uuid := '77000000-0000-4000-8000-000000000002';
  subscription_id uuid := '78000000-0000-4000-8000-000000000001';
  other_subscription_id uuid := '78000000-0000-4000-8000-000000000002';
  request_key uuid := '79000000-0000-4000-8000-000000000001';
  result jsonb;
  failed boolean;
begin
  insert into auth.users (id, email) values
    (u_owner, 'scan-credit-owner@example.test'),
    (u_other, 'scan-credit-other@example.test');
  insert into public.user_subscriptions (
    id, user_id, package_type, status, scan_credits_remaining
  ) values
    (subscription_id, u_owner, 'credit_pack', 'active', 2),
    (other_subscription_id, u_other, 'credit_pack', 'active', 2);

  result := public.consume_scan_credit(u_owner, subscription_id, request_key);
  assert (result ->> 'credits_remaining')::integer = 1;
  assert not (result ->> 'replayed')::boolean;

  result := public.consume_scan_credit(u_owner, subscription_id, request_key);
  assert (result ->> 'credits_remaining')::integer = 1;
  assert (result ->> 'replayed')::boolean;
  assert (select scan_credits_remaining = 1
    from public.user_subscriptions where id = subscription_id);
  assert (select count(*) = 1 from public.scan_credit_consumptions
    where user_id = u_owner and idempotency_key = request_key);

  failed := false;
  begin
    perform public.consume_scan_credit(u_owner, other_subscription_id,
      '79000000-0000-4000-8000-000000000002');
  exception when others then failed := sqlerrm = 'scan_credit_not_available'; end;
  assert failed, 'scan credit RPC accepted a subscription owned by another user';

  failed := false;
  begin
    perform public.consume_scan_credit(u_owner, other_subscription_id, request_key);
  exception when others then failed := sqlerrm = 'idempotency_conflict'; end;
  assert failed, 'scan credit action key accepted a conflicting subscription';
end $$;

do $$
declare
  u_seller uuid := '7a000000-0000-4000-8000-000000000001';
  u_buyer uuid := '7a000000-0000-4000-8000-000000000002';
  u_loser uuid := '7a000000-0000-4000-8000-000000000003';
  u_grant uuid := '7a000000-0000-4000-8000-000000000004';
  card_id uuid := '7b000000-0000-4000-8000-000000000001';
  shipping_card_id uuid := '7b000000-0000-4000-8000-000000000002';
  offer_id uuid := '7c000000-0000-4000-8000-000000000001';
  loser_offer_id uuid := '7c000000-0000-4000-8000-000000000002';
  shipping_order_id uuid := '7d000000-0000-4000-8000-000000000001';
  result jsonb;
  failed boolean;
begin
  insert into auth.users (id, email) values
    (u_seller, 'offer-seller@example.test'),
    (u_buyer, 'offer-buyer@example.test'),
    (u_loser, 'offer-loser@example.test'),
    (u_grant, 'grant-target@example.test');
  insert into public.profiles (id, email) values
    (u_seller, 'offer-seller@example.test'),
    (u_buyer, 'offer-buyer@example.test'),
    (u_loser, 'offer-loser@example.test'),
    (u_grant, 'grant-target@example.test')
  on conflict (id) do update set email = excluded.email;
  insert into public.cards (
    id, seller_id, name, category, listing_type, price, status
  ) values
    (card_id, u_seller, 'Offer card', 'sports', 'sale', 100000, 'active'),
    (shipping_card_id, u_seller, 'Shipping card', 'sports', 'sale', 100000, 'sold');
  insert into public.offers (id, card_id, buyer_id, price, status) values
    (offer_id, card_id, u_buyer, 90000, 'pending'),
    (loser_offer_id, card_id, u_loser, 80000, 'pending');

  perform set_config('request.jwt.claim.sub', u_seller::text, true);
  result := public.perform_offer_action(
    offer_id, 'accept', '7e000000-0000-4000-8000-000000000001'
  );
  assert result ->> 'action' = 'accept' and not (result ->> 'replayed')::boolean;
  assert (select status = 'chosen' from public.offers where id = offer_id);
  assert (select status = 'rejected' from public.offers where id = loser_offer_id);
  assert (select status = 'in_transaction' from public.cards where id = card_id);
  assert (select count(*) = 1 from public.notifications n
    where n.offer_id = '7c000000-0000-4000-8000-000000000001'
      and n.type = 'offer_accepted');
  result := public.perform_offer_action(
    offer_id, 'accept', '7e000000-0000-4000-8000-000000000001'
  );
  assert (result ->> 'replayed')::boolean;
  assert (select count(*) = 1 from public.notifications n
    where n.offer_id = '7c000000-0000-4000-8000-000000000001'
      and n.type = 'offer_accepted');
  failed := false;
  begin
    perform public.perform_offer_action(
      offer_id, 'reject', '7e000000-0000-4000-8000-000000000001'
    );
  exception when others then failed := sqlerrm = 'idempotency_conflict'; end;
  assert failed, 'offer action key accepted a conflicting action';

  result := public.grant_admin_subscription_package(
    u_grant, 'credit_pack', 'moderator:test', 'moderator',
    '7e000000-0000-4000-8000-000000000002'
  );
  assert not (result ->> 'replayed')::boolean;
  result := public.grant_admin_subscription_package(
    u_grant, 'credit_pack', 'moderator:test', 'moderator',
    '7e000000-0000-4000-8000-000000000002'
  );
  assert (result ->> 'replayed')::boolean;
  assert (select scan_credits_remaining = 100 from public.user_subscriptions
    where user_id = u_grant and package_type = 'credit_pack');

  insert into public.orders (
    id, card_id, seller_id, buyer_id, amount, total_paid,
    payment_method, status, ghn_order_code, ghn_status
  ) values (
    shipping_order_id, shipping_card_id, u_seller, u_buyer, 100000, 100000,
    'direct_payos', 'shipping', 'GHN-TEST-1', 'picked'
  );
  insert into public.marketplace_order_funding (
    order_id, buyer_id, seller_id, funding_method, gross_amount,
    verified_amount, unverified_amount, classification
  ) values (
    shipping_order_id, u_buyer, u_seller, 'direct_payos', 100000,
    100000, 0, 'native_verified_escrow'
  );
  result := public.apply_shipping_webhook_event('GHN-TEST-1', 'delivered');
  assert result ->> 'status' = 'delivered';
  assert (select status = 'delivered' and auto_complete_at is not null
    from public.orders where id = shipping_order_id);
  result := public.apply_shipping_webhook_event('GHN-TEST-1', 'delivered');
  assert (result ->> 'replayed')::boolean;
  result := public.apply_shipping_webhook_event('GHN-TEST-1', 'delivering');
  assert (result ->> 'ignored')::boolean and result ->> 'reason' = 'out_of_order';
  assert (select count(*) = 2 from public.notifications
    where order_id = shipping_order_id and type = 'shipping_update');
  update public.orders set auto_complete_at = now() - interval '1 minute'
  where id = shipping_order_id;
  assert public.complete_delivered_orders() = 1;
  assert (select status = 'disputed' from public.orders where id = shipping_order_id);
  assert (select classification = 'disputed_frozen'
    from public.marketplace_order_funding where order_id = shipping_order_id);
  assert not exists (select 1 from public.wallet_fund_sources
    where user_id = u_seller and source_type = 'marketplace_sale'
      and source_id = shipping_order_id::text),
    'stale delivered order auto-paid seller without admin review';

  perform public.set_financial_maintenance(true, 'test', 'drain-guard-test', now());
  failed := false;
  begin
    perform public.drain_deferred_payos_webhooks(10);
  exception when others then failed := sqlerrm = 'financial_maintenance_active'; end;
  assert failed, 'deferred PayOS drain bypassed active maintenance';
  perform public.set_financial_maintenance(false, 'test', 'drain-guard-finished', null);
end $$;

do $$
declare
  result jsonb;
  attempt integer;
begin
  for attempt in 1..5 loop
    result := public.check_and_record_admin_login_attempt(
      repeat('1', 64), repeat('2', 64), false
    );
    assert (result ->> 'allowed')::boolean;
    assert not (result ->> 'credentials_valid')::boolean;
  end loop;
  result := public.check_and_record_admin_login_attempt(
    repeat('1', 64), repeat('2', 64), true
  );
  assert not (result ->> 'allowed')::boolean,
    'moderator login rate limit allowed a request after five account failures';
  result := public.get_financial_cutover_inventory();
  assert result ? 'state' and result ? 'wallets' and result ? 'deferredWebhooks';
end $$;

do $$
declare
  table_name text;
begin
  assert not exists (
    select 1
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) acl
    where n.nspname = 'public'
      and d.defaclrole = (select oid from pg_roles where rolname = current_user)
      and d.defaclobjtype in ('r', 'S', 'f')
      and acl.grantee in (
        0,
        (select oid from pg_roles where rolname = 'anon'),
        (select oid from pg_roles where rolname = 'authenticated')
      )
  ), 'financial migration owner retained permissive default privileges';

  foreach table_name in array array[
    'financial_system_state', 'wallet_fund_sources',
    'wallet_fund_allocations', 'wallet_reconciliation_records',
    'payment_webhook_events', 'payment_fulfillments',
    'scan_credit_consumptions',
    'marketplace_order_funding', 'withdrawal_transfer_attempts',
    'withdrawal_action_requests', 'withdrawal_audit_events',
    'admin_login_attempts', 'marketplace_dispute_actions',
    'marketplace_order_action_requests', 'admin_subscription_grant_requests',
    'offer_action_requests'
  ] loop
    assert not has_table_privilege('anon', 'public.' || table_name, 'SELECT');
    assert not has_table_privilege('anon', 'public.' || table_name, 'INSERT');
    assert not has_table_privilege('authenticated', 'public.' || table_name, 'SELECT');
    assert not has_table_privilege('authenticated', 'public.' || table_name, 'INSERT');
    assert not has_table_privilege('authenticated', 'public.' || table_name, 'UPDATE');
    assert not has_table_privilege('authenticated', 'public.' || table_name, 'DELETE');
  end loop;
  assert has_table_privilege('authenticated', 'public.payment_orders', 'SELECT');
  assert not has_table_privilege('authenticated', 'public.payment_orders', 'INSERT');
  assert not has_table_privilege('authenticated', 'public.payment_orders', 'UPDATE');
  assert not has_table_privilege('anon', 'public.user_subscriptions', 'SELECT');
  assert has_table_privilege('authenticated', 'public.user_subscriptions', 'SELECT');
  assert not has_table_privilege('authenticated', 'public.user_subscriptions', 'INSERT');
  assert not has_table_privilege('authenticated', 'public.user_subscriptions', 'UPDATE');
  assert not has_table_privilege('authenticated', 'public.offers', 'UPDATE');
  assert has_function_privilege(
    'authenticated', 'public.request_wallet_withdrawal(bigint,uuid)', 'EXECUTE'
  );
  assert not has_function_privilege(
    'service_role', 'public.attach_payos_payment_link(uuid,bigint,text,text)', 'EXECUTE'
  );
  assert has_function_privilege(
    'service_role', 'public.claim_payos_payment_link_creation(uuid,bigint)', 'EXECUTE'
  );
  assert has_function_privilege(
    'service_role', 'public.attach_claimed_payos_payment_link(uuid,bigint,uuid,text,text)', 'EXECUTE'
  );
  assert not has_function_privilege(
    'authenticated',
    'public.perform_withdrawal_action(uuid,text,uuid,text,text,jsonb)',
    'EXECUTE'
  );
  assert not has_function_privilege(
    'service_role', 'public.spend_verified_wallet(uuid,jsonb,uuid,text)', 'EXECUTE'
  );
  assert has_function_privilege(
    'service_role',
    'public.create_verified_wallet_marketplace_orders(uuid,jsonb,uuid,text)',
    'EXECUTE'
  );
  assert has_function_privilege(
    'service_role',
    'public.stage_payos_marketplace_checkout(uuid,bigint,jsonb,uuid,timestamp with time zone)',
    'EXECUTE'
  );
  assert not has_function_privilege(
    'authenticated', 'public.get_marketplace_checkout_replay(uuid,uuid,text)', 'EXECUTE'
  );
  assert has_function_privilege(
    'service_role', 'public.get_marketplace_checkout_replay(uuid,uuid,text)', 'EXECUTE'
  );
  assert not has_function_privilege(
    'authenticated', 'public.consume_scan_credit(uuid,uuid,uuid)', 'EXECUTE'
  );
  assert has_function_privilege(
    'service_role', 'public.consume_scan_credit(uuid,uuid,uuid)', 'EXECUTE'
  );
  assert has_function_privilege(
    'authenticated', 'public.perform_offer_action(uuid,text,uuid)', 'EXECUTE'
  );
  assert not has_function_privilege(
    'anon', 'public.perform_offer_action(uuid,text,uuid)', 'EXECUTE'
  );
  assert has_function_privilege(
    'service_role',
    'public.grant_admin_subscription_package(uuid,text,text,text,uuid)',
    'EXECUTE'
  );
  assert not has_function_privilege(
    'authenticated',
    'public.grant_admin_subscription_package(uuid,text,text,text,uuid)',
    'EXECUTE'
  );
  assert has_function_privilege(
    'service_role', 'public.apply_shipping_webhook_event(text,text)', 'EXECUTE'
  );
  assert has_function_privilege(
    'service_role', 'public.check_and_record_admin_login_attempt(text,text,boolean)', 'EXECUTE'
  );
  assert has_function_privilege(
    'service_role', 'public.get_financial_cutover_inventory()', 'EXECUTE'
  );
  foreach table_name in array array[
    'financial_system_state', 'wallet_fund_sources',
    'wallet_fund_allocations', 'wallet_reconciliation_records',
    'payment_webhook_events', 'payment_fulfillments',
    'scan_credit_consumptions', 'marketplace_order_funding',
    'withdrawal_transfer_attempts', 'withdrawal_action_requests',
    'withdrawal_audit_events', 'admin_login_attempts',
    'marketplace_dispute_actions', 'marketplace_order_action_requests',
    'admin_subscription_grant_requests', 'offer_action_requests'
  ] loop
    assert not has_table_privilege('service_role', 'public.' || table_name, 'SELECT');
    assert not has_table_privilege('service_role', 'public.' || table_name, 'INSERT');
    assert not has_table_privilege('service_role', 'public.' || table_name, 'UPDATE');
    assert not has_table_privilege('service_role', 'public.' || table_name, 'DELETE');
  end loop;
  assert not has_function_privilege(
    'authenticated', 'public.subtract_bundle_selection(jsonb,jsonb)', 'EXECUTE'
  );
  assert not has_function_privilege(
    'authenticated', 'public.perform_marketplace_order_action(uuid,text,uuid,uuid,jsonb)', 'EXECUTE'
  );
  assert has_function_privilege(
    'service_role', 'public.perform_marketplace_order_action(uuid,text,uuid,uuid,jsonb)', 'EXECUTE'
  );
end $$;

rollback;
