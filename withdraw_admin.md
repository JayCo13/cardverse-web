# Spec: Admin Handling Withdrawals

> This document is for a new session to code the seller withdrawal approval/processing feature.
> There are 2 parts: **(A) preparation in cardverse-web** (RPC + labels) and **(B) implementation in cardverse-ad**.
> Both apps SHARE 1 Supabase project.

---

## 0. Context (already exists)

The web app (cardverse-web) already has the seller "Withdraw" flow:
- API `POST /api/wallet/withdraw` (`src/app/api/wallet/withdraw/route.ts`): requires KYC approved,
  deducts from wallet **immediately** (`available_balance -= amount`, `total_withdrawn += amount`), writes 2 rows
  in `wallet_transactions` (`withdrawal` = −net, `platform_fee` = −fee), creates `wallet_withdrawals` as `pending`
  with **the bank account snapshot from KYC**.
- Wallet UI (`src/app/wallet/page.tsx`) split into 2 tabs: 👤 Buyer (Deposit) / 🏪 Seller (Withdraw).
- Table migration: `supabase/migrations/20260611_create_wallet_withdrawals.sql`.

Because there is NO automatic payout gateway → admin manually transfers the money and then **marks as completed**, or
**rejects** (must **refund back to** the seller's wallet).

### Related Schema
`public.wallet_withdrawals`: `id`, `user_id`, `amount_requested bigint` (gross, already deducted from wallet),
`fee bigint`, `amount_net bigint`, `bank_name`, `bank_account_number`, `bank_account_name`,
`status` ∈ `pending|processing|completed|rejected`, `rejection_reason`, `created_at`, `processed_at`.
RLS is enabled, user only SELECTs their own → **admin must use service-role.**

`wallets`: `id`, `user_id`, `available_balance bigint`, `total_withdrawn bigint`.
`wallet_transactions`: `wallet_id`, `user_id`, `type`, `amount`, `balance_after`, `description`.
`notifications`: `user_id`, `type`, `title`, `message`, `read`.

---

## A. Preparation in cardverse-web (do FIRST)

### A1. Atomic RPC for refund — new migration
File: `supabase/migrations/20260612_refund_withdrawal_rpc.sql`

Reason: Supabase JS cannot do atomic addition/subtraction → rejecting via read-then-write has race conditions + risk of
double-refunds. RPC locks the row, guards the status (idempotent), and adds/subtracts within 1 transaction.

```sql
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
  -- Lock the withdrawal request; process only if pending/processing (prevent double-refund).
  select * into w from public.wallet_withdrawals
    where id = p_withdrawal_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if w.status not in ('pending', 'processing') then
    return jsonb_build_object('ok', false, 'error', 'already_processed', 'status', w.status);
  end if;

  -- Atomic wallet refund, retrieve balance + wallet_id.
  update public.wallets
    set available_balance = available_balance + w.amount_requested,
        total_withdrawn   = greatest(0, total_withdrawn - w.amount_requested),
        updated_at = now()
    where user_id = w.user_id
    returning id, available_balance into v_wallet_id, v_new_balance;

  if v_wallet_id is null then
    return jsonb_build_object('ok', false, 'error', 'wallet_not_found');
  end if;

  -- Record the refund ledger (+gross).
  insert into public.wallet_transactions (wallet_id, user_id, type, amount, balance_after, description)
  values (v_wallet_id, w.user_id, 'refund', w.amount_requested, v_new_balance,
          'Refund due to rejected withdrawal request');

  -- Mark as rejected.
  update public.wallet_withdrawals
    set status = 'rejected', rejection_reason = p_reason, processed_at = now()
    where id = p_withdrawal_id;

  return jsonb_build_object('ok', true, 'new_balance', v_new_balance);
end;
$$;

grant execute on function public.refund_withdrawal(uuid, text) to service_role;

notify pgrst, 'reload schema';
```

(Optional) RPC `complete_withdrawal(p_withdrawal_id uuid)` for symmetry/idempotency — but
completing DOES NOT touch the money so a guarded update in the admin route is sufficient (see B3).

### A2. Add `refund` label for wallet history — `src/app/wallet/page.tsx`
In `TX_TYPE_LABELS` add:
```ts
refund: { label: 'Refund', color: 'text-green-400' },
```
So users see "Refund" instead of the raw `refund` text.

---

## B. Implementation in cardverse-ad

> Read `cardverse-ad/CLAUDE.md` first. Two-tier auth: `getRole()` (`src/utils/auth/getRole.ts`)
> returns `'moderator' | 'admin' | null`; service-role via `createAdminClient()`
> (`src/utils/supabase/admin.ts`) ONLY in API routes AFTER `getRole()` confirms.

### B1. Sidebar — add "Withdrawals" item
`[MODIFY] Sidebar.tsx`: add nav item `/withdrawals`, icon `Bank`/`Wallet` from `@phosphor-icons/react`.

### B2. List page `[NEW] src/app/(dashboard)/withdrawals/page.tsx`
Mock existing `kyc`/`payments` pages:
- Tabs by status: `pending` (default), `processing`, `completed`, `rejected`.
- Each row: seller's name + email, bank + account number + account name, `amount_requested`, `fee`,
  `amount_net`, `created_at`, status badge.
- **Mark as transferred** (complete) and **Reject** buttons (reject — requires input/modal for the reason).

### B3. API `[NEW] src/app/api/withdrawals/route.ts` (GET)
- `getRole()` → 403 if null (for `admin` and `moderator`).
- `createAdminClient()` query `wallet_withdrawals`, filter `?status=`, sort `created_at` desc.
- Join `profiles` (display_name, email) by `user_id`.

### B4. API `[NEW] src/app/api/withdrawals/[id]/route.ts` (PATCH)
- `getRole()` → 403 if null.
- Body: `{ action: 'complete' | 'reject', rejection_reason? }`.
- **complete**: guarded update — `update wallet_withdrawals set status='completed', processed_at=now()
  where id=:id and status in ('pending','processing')`, check rows affected > 0
  (prevents double-processing). Insert `notifications` (`type='withdrawal_completed'`, notifies transferred
  `amount_net`). DOES NOT touch the wallet.
- **reject**: requires `rejection_reason`. Call **RPC**:
  `createAdminClient().rpc('refund_withdrawal', { p_withdrawal_id: id, p_reason: rejection_reason })`.
  If `data.ok !== true` → return corresponding error (`already_processed` → 409). If ok → insert
  `notifications` (`type='withdrawal_rejected'` + reason). **Do not manually add/subtract wallet in the route** —
  RPC handles everything (atomic + idempotent).

### Proper Implementation Notes (CRITICAL)
- Rejection refunds the exact **`amount_requested` (gross)**, NOT `amount_net`.
- Idempotency is guaranteed through status guarding (RPC for reject, conditional update for complete).
- Never trust amounts/accounts from the client — RPC/route re-reads from DB via `id`.
- New notification types (`withdrawal_completed`/`withdrawal_rejected`) on the web side default to the generic bell icon — no error, they will still appear in the list.

---

## C. Verification

**Auto-ish / API:**
1. Call API without auth (not admin/moderator) → 403.
2. Reject without reason → fail.
3. Complete/Reject twice in a row → 2nd time is blocked (RPC returns `already_processed` / update 0 rows).

**Manual:**
1. Seller (cardverse-web) creates a withdrawal request → shows up in `pending` tab with correct amount/fee/net/bank KYC.
2. **Complete** → status `completed`, wallet remains UNCHANGED, seller receives notification.
3. **Reject** + reason → status `rejected`; seller's wallet is refunded the exact `amount_requested`
   (available_balance increases back, total_withdrawn decreases back), 1 `wallet_transactions` of type
   `refund` is created ("Refund" label displays on web), seller gets notification with the reason.
4. Verify wallet history on the web side displays "Refund" rather than the raw text.

## D. Execution Order
1. (web) Run migration A1 (`refund_withdrawal` RPC) + add label A2.
2. (ad) B1 sidebar → B3/B4 API → B2 UI.
3. Test according to section C with 1 seller account (KYC approved, has balance) + 1 admin account.
