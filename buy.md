# Buy / Checkout — Work Summary

This document is the handoff for the `/buy` marketplace flow: checkout, buyer
address book, make-an-offer, shipping fees, PayOS QR payments, and the
concurrency / reservation logic that keeps a single-copy card from being
oversold or stranded.

Written for both humans and agents. Read it before touching the buy flow.

---

## Scope

The `/buy` marketplace path end to end:

- buyer checkout modal
- **buyer address book** (TikTok-style: many addresses, one default, managed from checkout)
- **buyer make-an-offer** (negotiate price when the seller allows it)
- GHN shipping-fee calculation
- PayOS QR payment order creation + webhook handling
- **card reservation + self-heal** (stuck-card fix)
- **atomic claim** (two buyers, one card — no oversell)
- marketplace listing price parsing

---

## 1. Buyer address book (TikTok-style)

Replaces the old single `profiles.default_shipping_*` model with a real address
book so a buyer can save many addresses, mark one default, and add / edit /
delete / pick them **straight from the checkout modal** — no detour through
profile settings.

**Data** — `supabase/migrations/20260609_create_shipping_addresses.sql`
- table `shipping_addresses` (id, user_id, recipient_name, phone, province/district/ward ids+names, detail, is_default, timestamps)
- RLS: a user fully owns their own rows; partial unique index enforces **one default per user**
- backfills one default row per user from existing `profiles.default_shipping_*`

**API** — `src/app/api/shipping-addresses/route.ts` (GET list, POST create) and
`src/app/api/shipping-addresses/[id]/route.ts` (PATCH update / set-default,
DELETE). All auth-gated. Creating/promoting a default clears the previous one;
deleting the default promotes the most recent remaining address.

**UI** — `src/components/address-book.tsx` is a reusable manager (select / add /
edit / delete / set-default). Used two ways:
- `<AddressBook selectable />` inside `src/components/checkout-modal.tsx` —
  opens with the default pre-selected and the shipping fee already calculated;
  the buyer can add a new address and pay immediately.
- `<AddressBook />` in `src/app/profile/edit/page.tsx` under a new **"Sổ địa chỉ"** tab.

The buy route (`src/app/api/marketplace/buy/route.ts`) no longer writes
`profiles.default_shipping_*` — the address book is the source of truth. (The
old columns remain only because the migration backfills from them.)

---

## 2. Buyer make-an-offer (negotiate)

The offer infrastructure already existed (table `offers`, `cards.accept_offers`,
`cards.min_offer_percent`, the seller-side accept flow on the card-detail page).
This exposes the **buyer side directly on `/buy`**.

- `src/components/card-item.tsx` — new `onOfferClick` prop + a **"Trả giá"**
  button, shown only for an active sale that isn't the user's own and whose
  seller has `accept_offers` on.
- `src/components/offer-modal.tsx` — buyer enters a price (VND-formatted) +
  optional message, validated against the seller's `min_offer_percent` floor;
  inserts into `offers` (status `pending`) and notifies the seller. If the buyer
  already has a pending offer it **updates** it instead of duplicating.
- `src/app/buy/page.tsx` — maps `min_offer_percent`, lazy-loads `OfferModal`,
  wires `onOfferClick`.

Seller accepts/rejects from the card-detail page (unchanged).

---

## 3. GHN shipping fee

Card shipments default to a small envelope: weight `30g`, `16×12×1 cm`. The fee
call resolves a real GHN `service_id` from available services and only falls
back to `service_type_id` if needed. See `src/lib/ghn.ts` and
`src/app/api/shipping/fee/route.ts`.

> **Sandbox caveat:** `GHN_ENV` is unset, so the app talks to the GHN **dev
> gateway** (`dev-online-gateway.ghn.vn`), which returns simulated/inflated
> fees (e.g. ~70–80k for a 30g card). Set `GHN_ENV=production` to get real
> prices (~22k inner-city, ~30–44k cross-region). Real fee optimisation
> (free-ship/subsidy, cheapest service, GHTK/VNPost for light parcels) is
> deferred until production rates are live.

---

## 4. PayOS payment order types

`payment_orders.package_type` was extended from `day_pass | credit_pack |
vip_pro` to also allow `deposit` and `marketplace_order`
(`supabase/migrations/20260609_checkout_defaults_and_payment_order_types.sql`).
Marketplace QR checkout creates `package_type = 'marketplace_order'`. The PayOS
webhook (`src/app/api/payos/webhook/route.ts`) handles each type separately:
- `deposit` → credit wallet + wallet transaction
- `marketplace_order` → finalize the marketplace order
- subscription packages → original activation flow

Constants live in `src/lib/payos.ts`.

---

## 5. Card reservation + self-heal (stuck-card fix)

**Problem:** picking QR/PayOS marked the card `in_transaction` *indefinitely*.
The webhook only releases it on an explicit PayOS cancel — so if the buyer just
closed the QR tab (no webhook), the card vanished from the market forever and
the seller was stuck.

**Fix** — `supabase/migrations/20260609_card_reservation_expiry.sql`
- adds `cards.reserved_until timestamptz`
- function `release_expired_card_reservations()` (SECURITY DEFINER, granted to
  anon/authenticated): frees every card whose reservation lapsed and cancels its
  dangling `pending_payment` order + `pending` payment_order.

Three cooperating layers:
1. **PayOS `expiredAt`** — the link is set to expire with the reservation, so
   PayOS itself fires a cancel webhook when time runs out.
2. **Self-heal on browse** — `src/app/buy/page.tsx` and the buy route call
   `release_expired_card_reservations()` before reading cards, so a stuck card
   reappears on its own. No cron needed.
3. **Consistent webhook** — `completeMarketplaceOrderPayment` now marks the card
   `sold` + clears `reserved_until` on success (previously it left the card
   `in_transaction`); `cancelMarketplaceOrder` clears `reserved_until` on
   release. It also handles the late-payment edge: if the reservation expired
   and the order was auto-cancelled just before payment landed, it re-acquires
   the card if still free, otherwise notifies the buyer (`refund_needed`).

Reservation window: `RESERVATION_MINUTES = 15` in the buy route.

---

## 6. Atomic claim (two buyers, one card)

**Problem:** two buyers clicking at the same time both passed the
`SELECT ... status='active'` check and both created orders → the single card was
sold twice.

**Fix** (`src/app/api/marketplace/buy/route.ts`) — Shopee/TikTok-style atomic
compare-and-set:
- wallet balance is pre-checked **before** claiming (don't lock the card for a
  buyer who can't pay).
- the **claim** is one conditional update — `UPDATE cards SET
  status='in_transaction', reserved_until=now()+15m WHERE id=? AND
  status='active' AND listing_type='sale' RETURNING id`. The first buyer wins;
  a simultaneous second buyer matches **0 rows** and gets **409
  `card_unavailable`**. (Also blocks one user double-clicking.)
- all post-claim mutation is wrapped in `try/catch`; on any failure the claim is
  **rolled back** (card → `active`, `reserved_until` → null) so a broken
  transaction never strands the card.
- wallet success → card `sold` + `reserved_until` cleared; payos success → card
  stays reserved (`in_transaction`) until the webhook resolves it.

**Losing-buyer UX** (`src/components/checkout-modal.tsx`): a 409 shows a toast
("Thẻ không còn khả dụng"), closes the modal, and refreshes the list so the card
disappears — like Shopee's "out of stock".

Two layers together: **atomic claim** stops oversell at click time; the
**15-minute reservation** frees the card if the winner abandons checkout.

---

## 7. Listing price parsing

Seller listing creation used `parseFloat` on VND-formatted input, so `10.000`
became `10`. The form now strips separators before conversion (`10.000` →
`10000`), with a minimum-price check in both the form schema and the listing API
(`src/app/sell/create/page.tsx`, `src/app/api/marketplace/listings/route.ts`).
**Limitation:** listings already saved wrong are not auto-repaired.

---

## Database migrations to apply

Apply these to the Supabase project (in order):

1. `20260609_checkout_defaults_and_payment_order_types.sql` — default-shipping columns (legacy) + `payment_orders.package_type` (`deposit`, `marketplace_order`)
2. `20260609_create_shipping_addresses.sql` — address book table + RLS + backfill
3. `20260609_card_reservation_expiry.sql` — `cards.reserved_until` + `release_expired_card_reservations()`

> Note: the connected sandbox project has been observed missing core tables
> (e.g. `wallets`) — `/api/*` return PGRST205 / 500 until the full schema is
> applied.

---

## Mental model

If a checkout total looks wrong:
1. Is the listing price already wrong in the DB (old `parseFloat` data)?
2. Is `GHN_ENV` unset → sandbox fees inflated?
3. Is the route genuinely long-distance?

If QR payment fails: check `payment_orders.package_type`, the webhook, and that
all three migrations above are applied.

If a card disappeared from the market: it's reserved (`in_transaction` +
`reserved_until`). It auto-releases at the reservation expiry, on the next
`/buy` browse, or when PayOS sends the expiry webhook.

If a buyer reports "thẻ vừa được người khác mua" (409): expected — another buyer
won the atomic claim.

---

## Remaining / follow-up

- **Real shipping-fee optimisation** — only meaningful after `GHN_ENV=production`
  (free-ship threshold/subsidy, cheapest service selection, GHTK/VNPost for
  light parcels).
- **Refund automation** for the `refund_needed` late-payment edge (currently a
  notification for manual handling).
- **Repair old invalid listing prices** — needs an admin/migration pass; the
  parser fix only prevents new bad data.
