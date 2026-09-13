-- One-time verified compensation credit for quachnha33@gmail.com.
-- Amount: 100,000,000 VND.
-- Idempotent: rerunning this exact script does not credit the wallet twice.

begin;

set local lock_timeout = '15s';
set local statement_timeout = '2min';
select set_config('cardverse.maintenance_bypass', 'on', true);

do $$
declare
  v_email constant text := 'quachnha33@gmail.com';
  v_amount constant bigint := 100000000;
  v_source_reference constant text :=
    'admin-compensation:quachnha33@gmail.com:100000000:2026-09-13:v1';
  v_user_id uuid;
  v_wallet_id uuid;
  v_source_id uuid;
  v_new_balance bigint;
  v_idempotency_key uuid;
begin
  select p.id
  into v_user_id
  from public.profiles p
  where lower(trim(p.email)) = v_email;

  if v_user_id is null then
    raise exception 'target_account_not_found: %', v_email;
  end if;

  v_idempotency_key := public.stable_financial_uuid(
    'wallet-credit:' || v_source_reference
  );
  v_wallet_id := public.ensure_wallet_for_user(v_user_id);

  -- Serialize credits for this wallet before changing its balance.
  perform 1
  from public.wallets
  where id = v_wallet_id
  for update;

  insert into public.wallet_fund_sources (
    user_id,
    wallet_id,
    source_type,
    source_id,
    original_amount,
    remaining_amount,
    verification_status,
    credits_wallet,
    evidence,
    occurred_at
  ) values (
    v_user_id,
    v_wallet_id,
    'compensation',
    v_source_reference,
    v_amount,
    v_amount,
    'verified',
    true,
    jsonb_build_object(
      'reason', 'Owner-authorized wallet compensation',
      'actor', 'manual-supabase-sql',
      'recipient_email', v_email,
      'amount', v_amount,
      'currency', 'VND',
      'requested_at', '2026-09-13T16:00:00+07:00'
    ),
    now()
  )
  on conflict (user_id, source_type, source_id) do nothing
  returning id into v_source_id;

  if v_source_id is not null then
    update public.wallets
    set available_balance = available_balance + v_amount,
        updated_at = now()
    where id = v_wallet_id
    returning available_balance into v_new_balance;

    insert into public.wallet_transactions (
      wallet_id,
      user_id,
      type,
      amount,
      balance_after,
      description,
      reference_id,
      reference_type,
      fund_source_id,
      idempotency_key,
      affects_balance,
      metadata
    ) values (
      v_wallet_id,
      v_user_id,
      'compensation',
      v_amount,
      v_new_balance,
      'Owner-authorized wallet compensation',
      v_source_reference,
      'admin_compensation',
      v_source_id,
      v_idempotency_key,
      true,
      jsonb_build_object('currency', 'VND', 'recipient_email', v_email)
    );
  end if;

  perform public.assert_wallet_fund_integrity(v_user_id);
end;
$$;

commit;

-- Verification. The integrity result is JSONB; read its keys through `value`.
with target as (
  select p.id, p.email
  from public.profiles p
  where lower(trim(p.email)) = 'quachnha33@gmail.com'
), integrity as (
  select
    t.id,
    public.assert_wallet_fund_integrity(t.id) as value
  from target t
)
select
  t.email,
  w.available_balance,
  w.held_balance,
  (i.value ->> 'verified_available')::bigint as verified_available,
  (i.value ->> 'unverified_available')::bigint as unverified_available,
  s.source_type,
  s.source_id,
  s.original_amount,
  s.remaining_amount,
  s.verification_status
from target t
join public.wallets w on w.user_id = t.id
join public.wallet_fund_sources s on s.wallet_id = w.id
join integrity i on i.id = t.id
where s.source_type = 'compensation'
  and s.source_id =
    'admin-compensation:quachnha33@gmail.com:100000000:2026-09-13:v1';
