-- Atomic refund for a rejected withdrawal, called by the admin panel
-- (cardverse-ad) via service role. Supabase JS can't do atomic increments,
-- and a read-then-write refund could race / double-refund. This RPC locks the
-- withdrawal row, guards on status (idempotent), refunds the wallet and marks
-- the request rejected in a single transaction.

create or replace function public.refund_withdrawal(p_withdrawal_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.wallet_withdrawals%rowtype;
  v_wallet_id uuid;
  v_new_balance bigint;
begin
  -- Khoá yêu cầu rút; chỉ xử lý nếu còn pending/processing (chống double-refund).
  select * into w from public.wallet_withdrawals
    where id = p_withdrawal_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if w.status not in ('pending', 'processing') then
    return jsonb_build_object('ok', false, 'error', 'already_processed', 'status', w.status);
  end if;

  -- Hoàn tiền ví atomic, lấy lại số dư + wallet_id.
  update public.wallets
    set available_balance = available_balance + w.amount_requested,
        total_withdrawn   = greatest(0, total_withdrawn - w.amount_requested),
        updated_at = now()
    where user_id = w.user_id
    returning id, available_balance into v_wallet_id, v_new_balance;

  if v_wallet_id is null then
    return jsonb_build_object('ok', false, 'error', 'wallet_not_found');
  end if;

  -- Ghi ledger hoàn tiền (+gross).
  insert into public.wallet_transactions (wallet_id, user_id, type, amount, balance_after, description)
  values (v_wallet_id, w.user_id, 'refund', w.amount_requested, v_new_balance,
          'Hoàn tiền do yêu cầu rút bị từ chối');

  -- Đánh dấu rejected.
  update public.wallet_withdrawals
    set status = 'rejected', rejection_reason = p_reason, processed_at = now()
    where id = p_withdrawal_id;

  return jsonb_build_object('ok', true, 'new_balance', v_new_balance);
end;
$$;

grant execute on function public.refund_withdrawal(uuid, text) to service_role;

notify pgrst, 'reload schema';
