# CardVerse Money Flow

Definitive reference for how money moves through the marketplace. Last updated: 2026-06-11 (escrow auto-release + withdrawal-only fee model).

## Order state machine

```
pending_payment ──(PayOS webhook success)──→ paid
       │                                       │
       │ (PayOS cancel webhook /               │ (seller ships, GHN order created)
       │  release_expired_card_reservations)   ▼
       └──────────→ cancelled              shipping
                                               │
                                               │ (GHN webhook Status=delivered,
                                               │  sets auto_complete_at = now+72h)
                                               ▼
                                           delivered
                                               │
                ┌──────────────────────────────┼──────────────────────────────┐
                │ (buyer confirms)             │ (72h lapse,                   │ (buyer disputes)
                ▼                              │  complete_delivered_orders)   ▼
            completed ◄────────────────────────┘                          disputed
                                                                              │ (admin, cardverse-ad)
                                                                   ┌──────────┴──────────┐
                                                                   ▼                     ▼
                                                               refunded              completed
```

Wallet checkout skips `pending_payment` — orders are created directly as `paid`.

### Transition owners

| Transition | Code |
|---|---|
| create `paid` (wallet) / `pending_payment` (PayOS) | `src/app/api/checkout/route.ts` (also legacy: `marketplace/buy`, `transaction/[id]/pay`) |
| `pending_payment → paid` | `src/app/api/payos/webhook/route.ts` (signature-verified, idempotent at `payment_orders` level) |
| `pending_payment → cancelled` | PayOS cancel webhook; `release_expired_card_reservations()` (3-min reservation, `20260609_card_reservation_expiry.sql`) |
| `paid → shipping` | `marketplace/orders/route.ts` PATCH `ship` (creates GHN order) |
| `shipping → delivered` | `src/app/api/shipping/webhook/route.ts` (token-authenticated, idempotent; resets `auto_complete_at = now + 72h`) |
| `delivered → completed` (manual) | `marketplace/orders/route.ts` PATCH `confirm_received` (`buyer_confirmed_at` set) |
| `delivered → completed` (auto) | `complete_delivered_orders()` (`20260617_auto_release_escrow.sql`; `buyer_confirmed_at` stays NULL). Called opportunistically from `marketplace/orders` GET and `wallet` GET |
| `shipping/delivered → disputed` | `marketplace/orders/route.ts` PATCH `dispute` |
| `disputed → refunded/completed` | Admin app (cardverse-ad `api/marketplace`: `refund_buyer` / `release_seller`) |
| `pending_payment/paid → cancelled` | `marketplace/orders/route.ts` PATCH `cancel` (wallet refund if paid) |

## Escrow lifecycle

1. **Buyer pays** → money held by the platform. Wallet: debited immediately (optimistic-locked, service client). PayOS: real money lands in the PayOS merchant account.
2. **Seller ships** via GHN. The card is already `sold`.
3. **GHN delivers** → 72h buyer window starts (**at delivery**, not at ship time).
4. **Release**: buyer confirms, or 72h lapses → seller wallet credited the **full sale `amount`** (shipping fee is not part of the seller payout; it was paid to GHN).
5. **Withdrawal**: seller (KYC-approved only) requests payout to their KYC bank account → wallet debited immediately, `wallet_withdrawals` row `pending` → admin transfers manually and marks `completed`, or rejects → `refund_withdrawal()` RPC restores the balance.

## Fee model (owner decision, 2026-06-11)

**The 5% platform fee is charged ONCE, at withdrawal** (`WITHDRAW_FEE_RATE`, `src/app/api/wallet/withdraw/route.ts`).

- Seller is credited 100% of the sale amount at completion.
- `orders.platform_fee` = 0 on all new orders. Legacy rows have non-zero values (the old model deducted 5% at sale — combined with the withdrawal fee, sellers were double-charged; this is why the model changed).
- Consequences (accepted): money spent in-platform escapes the fee; fee revenue is realized at withdrawal; the 5% applies to the whole withdrawn amount including self-deposited funds.

## Wallet & ledger

Tables: `wallets`, `wallet_transactions` (`20260616_create_wallets_schema.sql`).

- **RLS**: owners can SELECT their own rows. **No write policies** — every mutation goes through the service-role client or SECURITY DEFINER functions. Never write wallet tables with a session client.
- All debits use an optimistic lock (`.eq('available_balance', snapshot)`) and return 409 `balance_changed` on conflict.
- `balance_after` = wallet balance snapshot after the transaction; rows written in one operation share the same `balance_after`.
- `reference_id` (text) holds a card uuid, order uuid, or PayOS orderCode depending on context.

Ledger `type` values:

| type | sign | meaning |
|---|---|---|
| `deposit` | + | PayOS wallet top-up (webhook) |
| `marketplace_buy` | − | buyer paid with wallet |
| `marketplace_sale` | + | seller credited at completion (full amount) |
| `withdrawal` | − | net amount sent to seller's bank |
| `platform_fee` | − | 5% withdrawal fee (paired with `withdrawal`) |
| `refund` | + | failed-checkout compensation; rejected withdrawal (RPC) |
| `escrow_release` | + | buyer refund on cancel / admin dispute refund |
| `scan_purchase`, `vip_subscription` | − | PayOS subscription purchases (see gaps) |

## Webhook security

- **PayOS** (`api/payos/webhook`): signature verified via SDK; idempotent (`payment_orders.status='paid'` check); amount cross-checked.
- **GHN** (`api/shipping/webhook`): shared-secret token (`GHN_WEBHOOK_TOKEN` env), constant-time compare, **fail closed** when unset. Configure at khachhang.ghn.vn → Webhook: `https://cardversehub.com/api/shipping/webhook?token=<value>`. Idempotent: terminal-status orders and unchanged `ghn_status` are ignored; only `shipping → delivered` transitions.

## Known gaps / follow-ups

- Manual-tracking (non-GHN) shipments never reach `delivered`, so they never auto-complete — buyer confirmation is required. Deliberate (no delivery proof).
- Old `delivered` orders piled up before auto-release existed will all pay out on the first `complete_delivered_orders()` call after the migration — review them first (`select id, seller_id, amount from orders where status='delivered' and auto_complete_at < now();`).
- Admin dispute `release_seller` (cardverse-ad) pays `amount − platform_fee` — correct for new orders (fee = 0) but under-pays **legacy** disputed orders.
- `orders` table RLS posture not yet audited (the GHN webhook now uses the service client regardless).
- PayOS `vip_pro`/`credit_pack` purchases write `scan_purchase`/`vip_subscription` ledger rows for money that never moved through the wallet (ledger anomaly, cosmetic).
- Old `marketplace_sale` ledger rows are net-of-fee; new rows are the full amount.
