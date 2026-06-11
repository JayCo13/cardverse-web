# Cart, Checkout, and Offer Flow Implementation Notes

This document records the cart/checkout work done in this branch so another agent can understand the intended behavior, the files touched, and the remaining operational details.

## Goal

Replace the old Transaction Room purchase flow with a cart and checkout flow:

- Buyers can add sale listings to a Supabase-backed cart.
- Buyers can checkout multiple cart items in one checkout screen.
- Accepted offers route to the same checkout screen via `offerId`.
- The legacy `/transaction/[id]` page remains only as a compatibility redirect.
- The global Transaction Room lock is disabled.
- PayOS webhook logic supports one payment order with multiple marketplace orders.
- Chat and notifications route accepted offers to checkout, not Transaction Room.

## High-Level Flow

### Cart flow

1. Buyer clicks Add to cart on `/buy` or `/cards/[id]`.
2. Client posts to `POST /api/cart` with `card_id`.
3. API validates:
   - user is authenticated,
   - card exists,
   - card is not owned by the buyer,
   - card is active and `listing_type = sale`.
4. Cart item is upserted into `cart_items`.
5. Header cart badge refreshes via the `cardverse:cart-updated` browser event.
6. Buyer opens `/cart`.
7. Buyer reviews items and goes to `/checkout?mode=cart`.
8. Checkout loads cart items, calculates grouped GHN shipping, and posts to `POST /api/checkout`.

### Accepted offer flow

1. Buyer makes or updates an offer.
2. Seller opens chat or card detail and accepts the pending offer.
3. `POST /api/offers/[id]/accept`:
   - validates seller ownership,
   - validates offer is pending,
   - locks the card as `in_transaction`,
   - marks the offer as `chosen`,
   - sends chat/notification metadata with `/checkout?offerId=...`,
   - does not create a legacy transaction.
4. Buyer clicks Pay now in chat or notification.
5. Buyer lands on `/checkout?offerId=<offer id>`.
6. Checkout creates the order and payment using wallet or PayOS.

### Payment methods

Checkout supports:

- `wallet`
- `direct_payos`

For wallet:

- Checks wallet balance before order creation.
- Deducts total amount once.
- Creates one order per item.
- Marks cards sold.
- Notifies each seller.
- Clears cart items after cart checkout.

For PayOS:

- Creates one `payment_orders` row for the total.
- Creates one `orders` row per item, sharing the same `payment_order_id`.
- Creates one PayOS payment link containing all checkout items.
- PayOS webhook completes or cancels all orders under that shared `payment_order_id`.

## Database Migration

### `supabase/migrations/20260614_create_cart_items.sql`

Adds `public.cart_items`.

Columns:

- `id uuid primary key`
- `user_id uuid references profiles(id)`
- `card_id uuid references cards(id)`
- `quantity integer default 1`
- `created_at timestamptz`
- `updated_at timestamptz`

Important constraints and policies:

- `unique (user_id, card_id)` prevents duplicate cart rows.
- RLS enabled.
- Authenticated users can manage only their own cart rows.

Run this migration before testing cart behavior against Supabase.

## New Files

### `src/app/api/cart/route.ts`

Provides cart API.

`GET /api/cart`

- Requires auth.
- Returns current user's cart rows.
- Joins `cards` and seller `profiles`.
- Includes seller pickup fields needed by checkout shipping:
  - `address_district_id`
  - `address_ward_code`

`POST /api/cart`

- Requires auth.
- Body: `{ card_id: string }`
- Validates active sale card and prevents self-purchase.
- Upserts into `cart_items`.
- Returns the inserted/updated item and cart count.

### `src/app/api/cart/[id]/route.ts`

`DELETE /api/cart/[id]`

- Requires auth.
- Deletes only the current user's cart item.

### `src/app/api/checkout/route.ts`

Creates wallet or PayOS checkout orders.

Supported body fields:

- `mode`: `"cart"` or `"offer"`
- `payment_method`: `"wallet"` or `"direct_payos"`
- `items`: cart checkout items, each with `cart_item_id`, `card_id`, `shipping_fee`
- `offer_id`: used for offer checkout
- shipping address fields:
  - `to_name`
  - `to_phone`
  - `to_district_id`
  - `to_district_name`
  - `to_province_id`
  - `to_province_name`
  - `to_ward_code`
  - `to_ward_name`
  - `to_address_detail`
  - `shipping_address`

Important behavior:

- Calls `release_expired_card_reservations`.
- For cart checkout, validates every card is still `active` and `sale`.
- For offer checkout, validates offer belongs to the current buyer and status is `chosen`.
- Prevents duplicate active orders for the same offer.
- Wallet checkout creates paid orders immediately.
- PayOS checkout creates pending orders and one shared payment order.
- Cart items are deleted after successful order creation.

### `src/app/cart/page.tsx`

New cart page.

Features:

- Auth-gated; opens auth modal when unauthenticated.
- Loads `/api/cart`.
- Shows available and unavailable items.
- Allows deleting cart items.
- Shows sticky order summary on desktop.
- Checkout button goes to `/checkout?mode=cart`.
- Dispatches `cardverse:cart-updated` after deletion.

Latest cart item UI:

- Larger card image.
- Category badge.
- Condition and availability chips.
- Seller block.
- Info chips for ship, payment, and CardVerse protection.
- Separate price/action column.
- View detail button.
- Remove button.

### `src/app/checkout/page.tsx`

New checkout page.

Supports:

- Cart checkout via `/checkout?mode=cart`.
- Offer checkout via `/checkout?offerId=<offer id>`.
- Address selection using `AddressBook`.
- Wallet or PayOS payment.
- Sticky order summary.
- Full UI copy in Vietnamese, English, and Japanese inside a local `copy` object.

Important shipping behavior:

- Previously GHN fee was calculated per item, causing duplicate shipping charges when multiple cards came from the same seller/pickup address.
- Current behavior groups shipping by:
  - `sellerId`
  - seller pickup district
  - seller pickup ward
  - selected buyer destination
- For each group, checkout calls `/api/shipping/fee` once.
- The first item in the group receives the shipping fee.
- Other items in the same group receive `shippingFee = 0`.
- UI shows `0 đ · Combined shipment` / localized equivalent for grouped items.
- The summary total only includes the grouped shipping fee once.

Latest product card UI in checkout:

- Image with category badge.
- Condition and quantity chips.
- Seller row.
- Ship, payment, and protection chips.
- Separate right column for item price.
- Compact shipping row instead of a large heavy shipping card.

## Modified Files

### `src/components/layout/header.tsx`

Changes:

- Added cart icon in the header.
- Displays cart count badge.
- Fetches `/api/cart` when user is authenticated.
- Listens to `cardverse:cart-updated` to refresh count.
- Adjusted responsive breakpoints around `lg` so the header behaves better on tablet/mobile.

### `src/components/card-item.tsx`

Changes:

- Added optional `onAddToCart?: (card) => void`.
- Added Add to cart buttons for list and grid cards when:
  - item is not sold,
  - current user is not the owner,
  - parent provides `onAddToCart`.
- Opens auth modal if unauthenticated.
- Added localized add-to-cart text in local copy object.

### `src/app/buy/page.tsx`

Changes:

- Wires `CardItem.onAddToCart`.
- Calls `POST /api/cart`.
- Shows success toast: `Thêm vào giỏ hàng thành công`.
- Dispatches `cardverse:cart-updated`.

Note:

- `/buy` may still be beta-gated by middleware in some local states. That is pre-existing behavior controlled by `src/middleware.ts`.

### `src/app/cards/[id]/page.tsx`

Changes:

- Added Add to cart action in the detail CTA area.
- Calls `POST /api/cart`.
- Dispatches `cardverse:cart-updated`.
- Redirects accepted offers to checkout:
  - `payload.checkoutUrl || /checkout?offerId=<offer id>`
- Adjusted related rail arrows to orange outlined style and moved them outside card content.

### `src/app/api/offers/[id]/accept/route.ts`

Changed accepted-offer behavior.

Old behavior:

- Created a legacy `transactions` row.
- Stored `transaction_id` on the offer.
- Routed user to `/transaction/<id>`.

New behavior:

- Validates seller and offer state.
- Locks the card by setting:
  - `status = in_transaction`
  - `reserved_until = now + 2 hours`
- Updates offer:
  - `status = chosen`
  - `transaction_id = null`
- Updates or creates conversation.
- Stores checkout metadata:
  - `offerId`
  - `cardId`
  - `checkoutUrl`
- Creates buyer notification pointing to checkout.
- Returns:
  - `offerId`
  - `checkoutUrl`
  - `conversationId`

### `src/components/chat-drawer.tsx`

Changes:

- Accept offer button routes to checkout instead of Transaction Room.
- Buyer Pay now button routes to `/checkout?offerId=<offer id>`.
- Offer lookup no longer trusts only `conversation.offerId`.
- Fix for stale offer bug:
  - The drawer scans latest message metadata for `offerId`.
  - It loads that offer first if it is still `pending` or `chosen`.
  - Then it falls back to latest offer by `card_id + buyer_id`.
- Seller detection now checks both:
  - `conversation.sellerId`
  - `conversation.card.seller_id`

This fixes the case where:

1. Buyer sends offer.
2. Seller rejects or ignores it.
3. Buyer updates/sends another offer.
4. Conversation still points at the old offer.
5. Seller cannot accept the new pending offer.

### `src/app/api/chat/conversations/route.ts`

Changes:

- When creating or opening a conversation with a new `offerId`, the route now updates `conversation.offer_id` even if an old offer id already exists.
- Previously it only filled `offer_id` when it was empty, causing stale offer bugs.

### `src/app/api/chat/messages/route.ts`

Changes:

- When posting an `offer_auto` message, if `metadata.offerId` or `metadata.offer_id` exists, the route updates `conversations.offer_id` to that new offer id.
- This makes offer updates robust even if the conversation already existed.

### `src/components/notification-bell.tsx`

Changes:

- `offer_accepted` notifications prefer `/checkout?offerId=<offer id>`.
- Legacy fallback remains:
  - if an old notification only has `transactionId`, it still routes to `/transaction/<id>`.

### `src/app/transaction/[id]/page.tsx`

Replaced the old Transaction Room UI with a compatibility redirect page.

Behavior:

- Loads legacy transaction.
- If completed or paid, redirects to `/orders`.
- If cancelled/expired, redirects to card detail or `/buy`.
- If active and has `offer_id` and current user is buyer, redirects to `/checkout?offerId=<offer id>`.
- Otherwise redirects to card detail or `/buy`.

Purpose:

- Old links do not break.
- New users are not shown the old Transaction Room.

### `src/components/transaction-lock-provider.tsx`

Changes:

- Removed `useTransactionLock`.
- Provider now just renders children.

Reason:

- The old global lock forced users back to `/transaction/<id>`.
- This conflicts with the new checkout flow.

### `src/app/api/payos/webhook/route.ts`

Updated for multi-order payment orders.

Changes:

- Completion now selects all marketplace orders sharing the same `payment_order_id`.
- Marks all pending orders as paid.
- Marks all related cards as sold.
- Completes active legacy transactions for those cards if present.
- Sends notifications to each seller.
- Cancellation now cancels all pending orders under the payment order.
- Releases all related card reservations.
- Handles reacquire/refund for cancelled orders in a loop.

### `src/components/ui/carousel.tsx`

Changes:

- Carousel arrows are orange outlined buttons.
- Slightly larger and moved outside card content.
- Reduced chance of arrows covering product cards.

## Known Verification Results

### Build

`npm run build` passes.

Note:

- Build required network because Next fetches Google Fonts.
- `next.config.ts` ignores TypeScript build errors, so build passing does not mean the whole repo type-checks.

### Type Check

`npx tsc --noEmit` still fails, but after fixing checkout-specific implicit-any errors, remaining failures are pre-existing repo-wide issues:

- Supabase generated types return `never` in several older routes/pages.
- Deno edge functions do not type-check in the Node TypeScript project.
- Some old mock data does not match the current `Card` type.

## Operational Notes

- Apply the cart migration before testing.
- Existing users may have conversations with stale `offer_id`; the chat drawer now handles this by reading latest message metadata and querying latest pending/chosen offers.
- Existing legacy Transaction Room payment route still exists at `src/app/api/transaction/[id]/pay/route.ts`, but new UI paths no longer use it.
- The `/transaction/[id]` route is intentionally kept as a redirect compatibility layer.
- If product managers want to fully remove transactions later, also audit:
  - `transactions` table usage
  - `src/hooks/use-transaction-lock.ts`
  - `src/app/api/transaction/[id]/pay/route.ts`
  - profile links to legacy transaction ids

## Important Edge Cases Covered

- Buyer cannot add own listing to cart.
- Buyer cannot add inactive/sold/non-sale card to cart.
- Duplicate add-to-cart upserts instead of creating duplicates.
- Cart checkout re-validates card availability at payment time.
- Accepted offer checkout prevents duplicate active orders for the same offer.
- Multiple cart items from the same seller pickup address share one GHN shipping fee.
- Seller can accept an updated pending offer even if conversation previously pointed to an older rejected/chosen offer.
- Old accepted-offer notifications with `transactionId` still route somewhere useful.

## Suggested Manual Test Checklist

1. Add an active sale listing to cart from `/buy`.
2. Add the same listing again; cart count should not duplicate.
3. Add another card from the same seller.
4. Open `/cart`; items should show detailed card rows and correct subtotal.
5. Open `/checkout?mode=cart`.
6. Select a shipping address.
7. Confirm same-seller items show one real shipping fee and remaining grouped items show `0 đ · Combined shipment`.
8. Try wallet checkout with insufficient wallet balance; button should be disabled and warning shown.
9. Select PayOS; payment link should open and orders should be pending.
10. Simulate PayOS webhook success; all orders under the payment order should become paid and cards sold.
11. Buyer sends offer.
12. Buyer updates offer.
13. Seller opens chat and sees the latest pending offer with Accept button.
14. Seller accepts offer.
15. Buyer clicks Pay now and lands on `/checkout?offerId=<latest offer id>`.
16. Legacy `/transaction/<id>` link redirects instead of rendering old room UI.
