-- Hold withdrawal funds until an admin confirms the bank transfer.
--
-- New requests move money from available_balance to held_balance. They are not
-- counted as withdrawn and do not create a negative ledger entry until the
-- transfer is completed. Existing pending requests used the legacy up-front
-- debit model; the backfill below converts those balances to held funds while
-- remembering that their legacy ledger rows already exist.

alter table public.wallets
  add column if not exists held_balance bigint not null default 0;

alter table public.wallet_withdrawals
  add column if not exists reservation_model text not null default 'legacy_debited',
  add column if not exists ledger_recorded boolean not null default true;

do $$
begin
  alter table public.wallets
    add constraint wallets_held_balance_nonnegative check (held_balance >= 0) not valid;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.wallet_withdrawals
    add constraint wallet_withdrawals_reservation_model_check
    check (reservation_model in ('legacy_debited', 'held'));
exception
  when duplicate_object then null;
end $$;

-- Convert legacy pending/processing requests. available_balance was already
-- reduced when these rows were created, so only held_balance and
-- total_withdrawn need reconciliation.
with pending_by_user as (
  select user_id, sum(amount_requested)::bigint as amount
  from public.wallet_withdrawals
  where status in ('pending', 'processing')
    and reservation_model = 'legacy_debited'
  group by user_id
)
update public.wallets w
set held_balance = w.held_balance + p.amount,
    total_withdrawn = greatest(0, w.total_withdrawn - p.amount),
    updated_at = now()
from pending_by_user p
where w.user_id = p.user_id;

update public.wallet_withdrawals
set reservation_model = 'held',
    ledger_recorded = true
where status in ('pending', 'processing')
  and reservation_model = 'legacy_debited';

create or replace function public.request_wallet_withdrawal(
  p_user_id uuid,
  p_amount bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.wallets%rowtype;
  v_kyc public.seller_verifications%rowtype;
  v_withdrawal_id uuid;
  v_fee bigint;
  v_net bigint;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  if p_amount is null or p_amount < 50000 then
    return jsonb_build_object('ok', false, 'error', 'amount_too_low');
  end if;

  select * into v_kyc
  from public.seller_verifications
  where user_id = p_user_id and status = 'approved';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_a_seller');
  end if;

  if coalesce(v_kyc.bank_name, '') = ''
     or coalesce(v_kyc.bank_account_number, '') = ''
     or coalesce(v_kyc.bank_account_name, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_bank');
  end if;

  insert into public.wallets (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;

  if v_wallet.available_balance < p_amount then
    return jsonb_build_object(
      'ok', false,
      'error', 'insufficient_balance',
      'available', v_wallet.available_balance
    );
  end if;

  v_fee := round(p_amount::numeric * 0.05)::bigint;
  v_net := p_amount - v_fee;

  update public.wallets
  set available_balance = available_balance - p_amount,
      held_balance = held_balance + p_amount,
      updated_at = now()
  where id = v_wallet.id;

  insert into public.wallet_withdrawals (
    user_id,
    amount_requested,
    fee,
    amount_net,
    bank_name,
    bank_account_number,
    bank_account_name,
    status,
    reservation_model,
    ledger_recorded
  ) values (
    p_user_id,
    p_amount,
    v_fee,
    v_net,
    v_kyc.bank_name,
    v_kyc.bank_account_number,
    v_kyc.bank_account_name,
    'pending',
    'held',
    false
  )
  returning id into v_withdrawal_id;

  return jsonb_build_object(
    'ok', true,
    'withdrawal_id', v_withdrawal_id,
    'status', 'pending',
    'amount_requested', p_amount,
    'fee', v_fee,
    'amount_net', v_net,
    'available_balance', v_wallet.available_balance - p_amount,
    'held_balance', v_wallet.held_balance + p_amount
  );
end;
$$;

create or replace function public.complete_wallet_withdrawal(p_withdrawal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_withdrawal public.wallet_withdrawals%rowtype;
  v_wallet public.wallets%rowtype;
begin
  select * into v_withdrawal
  from public.wallet_withdrawals
  where id = p_withdrawal_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_withdrawal.status not in ('pending', 'processing') then
    return jsonb_build_object(
      'ok', false,
      'error', 'already_processed',
      'status', v_withdrawal.status
    );
  end if;

  select * into v_wallet
  from public.wallets
  where user_id = v_withdrawal.user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'wallet_not_found');
  end if;

  if v_withdrawal.reservation_model = 'held' then
    if v_wallet.held_balance < v_withdrawal.amount_requested then
      return jsonb_build_object('ok', false, 'error', 'held_balance_mismatch');
    end if;

    update public.wallets
    set held_balance = held_balance - v_withdrawal.amount_requested,
        total_withdrawn = total_withdrawn + v_withdrawal.amount_requested,
        updated_at = now()
    where id = v_wallet.id;
  end if;

  if not v_withdrawal.ledger_recorded then
    insert into public.wallet_transactions (
      wallet_id,
      user_id,
      type,
      amount,
      balance_after,
      description,
      reference_id
    ) values (
      v_wallet.id,
      v_withdrawal.user_id,
      'withdrawal',
      -v_withdrawal.amount_requested,
      v_wallet.available_balance,
      format(
        'Rút tiền %sđ · Phí %sđ · Thực nhận %sđ về %s ****%s',
        v_withdrawal.amount_requested,
        v_withdrawal.fee,
        v_withdrawal.amount_net,
        v_withdrawal.bank_name,
        right(v_withdrawal.bank_account_number, 4)
      ),
      v_withdrawal.id::text
    );
  end if;

  update public.wallet_withdrawals
  set status = 'completed',
      ledger_recorded = true,
      processed_at = now()
  where id = p_withdrawal_id;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_withdrawal.user_id,
    'amount_net', v_withdrawal.amount_net,
    'bank_name', v_withdrawal.bank_name,
    'bank_account_number', v_withdrawal.bank_account_number
  );
end;
$$;

create or replace function public.reject_wallet_withdrawal(
  p_withdrawal_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_withdrawal public.wallet_withdrawals%rowtype;
  v_wallet public.wallets%rowtype;
  v_new_balance bigint;
begin
  if coalesce(trim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'rejection_reason_required');
  end if;

  select * into v_withdrawal
  from public.wallet_withdrawals
  where id = p_withdrawal_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_withdrawal.status not in ('pending', 'processing') then
    return jsonb_build_object(
      'ok', false,
      'error', 'already_processed',
      'status', v_withdrawal.status
    );
  end if;

  select * into v_wallet
  from public.wallets
  where user_id = v_withdrawal.user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'wallet_not_found');
  end if;

  if v_withdrawal.reservation_model = 'held' then
    if v_wallet.held_balance < v_withdrawal.amount_requested then
      return jsonb_build_object('ok', false, 'error', 'held_balance_mismatch');
    end if;

    update public.wallets
    set available_balance = available_balance + v_withdrawal.amount_requested,
        held_balance = held_balance - v_withdrawal.amount_requested,
        updated_at = now()
    where id = v_wallet.id
    returning available_balance into v_new_balance;
  else
    -- Safety fallback for a legacy row that was not converted by the backfill.
    update public.wallets
    set available_balance = available_balance + v_withdrawal.amount_requested,
        total_withdrawn = greatest(0, total_withdrawn - v_withdrawal.amount_requested),
        updated_at = now()
    where id = v_wallet.id
    returning available_balance into v_new_balance;
  end if;

  -- Legacy pending requests already wrote the withdrawal and fee to the ledger,
  -- so retain an offsetting audit row. New held requests have no debit to undo.
  if v_withdrawal.ledger_recorded then
    insert into public.wallet_transactions (
      wallet_id,
      user_id,
      type,
      amount,
      balance_after,
      description,
      reference_id
    ) values (
      v_wallet.id,
      v_withdrawal.user_id,
      'refund',
      v_withdrawal.amount_requested,
      v_new_balance,
      'Hoàn tiền do yêu cầu rút bị từ chối',
      v_withdrawal.id::text
    );
  end if;

  update public.wallet_withdrawals
  set status = 'rejected',
      rejection_reason = trim(p_reason),
      processed_at = now()
  where id = p_withdrawal_id;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_withdrawal.user_id,
    'amount_requested', v_withdrawal.amount_requested,
    'new_balance', v_new_balance
  );
end;
$$;

revoke execute on function public.request_wallet_withdrawal(uuid, bigint)
  from public, anon, authenticated;
revoke execute on function public.complete_wallet_withdrawal(uuid)
  from public, anon, authenticated;
revoke execute on function public.reject_wallet_withdrawal(uuid, text)
  from public, anon, authenticated;

grant execute on function public.request_wallet_withdrawal(uuid, bigint) to service_role;
grant execute on function public.complete_wallet_withdrawal(uuid) to service_role;
grant execute on function public.reject_wallet_withdrawal(uuid, text) to service_role;

notify pgrst, 'reload schema';
