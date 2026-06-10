# CardVerse Message / Offer / Detail Context

This document records the current status of implemented parts in the CardVerse marketplace, specifically Product Detail, Offer flow, Checkout conflict, and Direct Messaging between buyer/seller. The goal is so that readers and the next agent can continue with the correct context without having to trace the entire conversation again.

## 1. General Context

CardVerse has a marketplace for sellers to list cards and buyers to buy/make offers. Users want:

- A detail card page similar to eBay in layout, but still following the CardVerse dark/orange design pattern.
- Buyers can send offers to sellers.
- Buyers and sellers can chat directly to negotiate.
- Prevent scams by keeping transactions/payments within CardVerse.
- If a card has been bought by someone else or is being held for payment, the UI must clearly report it.
- If a seller accepts an offer, the buyer must proceed to the payment/transaction flow.

## 2. Completed Work

### 2.1 Checkout / Payment Conflict

Fixed the case where two buyers are paying for the same card:

- If the card is no longer `active` or is `in_transaction`, the buy API returns a clearer error instead of a generic `Card not found`.
- API returns `409` with `code: card_unavailable`.
- Differentiated messages:
  - Card is being held for payment: `This card is currently being held by someone else for payment...`
  - Card is sold/no longer available: `This card has been bought by someone else or is no longer for sale...`
- Checkout modal displays clear toasts:
  - `Card already bought by someone else`
  - `This card is no longer available. Please choose another card.`

Related files:

- `src/app/api/marketplace/buy/route.ts`
- `src/components/checkout-modal.tsx`

### 2.2 React Render Loop / Wallet Fetch

Fixed React minified error related to checkout/wallet fetch:

- Previously, the effect depended directly on the `user` object, easily causing re-render/subscription loops.
- Changed to `userId = user?.id ?? null`.
- The wallet fetch effect now depends on `[open, userId]`.

Related files:

- `src/components/checkout-modal.tsx`

### 2.3 eBay-Like Product Detail Page

Rebuilt/changed the detail card page `/cards/[id]` to an eBay-like direction:

- Has a header/search row in detail.
- Has sponsored/store strip.
- Has a `People who viewed this item also viewed` carousel.
- Has a main product section with image gallery on the left and buy/sell info on the right.
- Has price, condition, quantity, Buy It Now, Make Offer, Watchlist.
- Has shipping/returns/payments block.
- Has `About this item`, item specifics, seller description.
- Has seller feedback/about seller section.
- Has related rails: `Similar Items`, `Explore related items`, `You may also like`.
- Changed eBay blue to orange to unify with CardVerse.
- Used the logo `/assets/logo-verse.png` instead of hard-coded `CardVerse` text.
- Adjusted image layout to prevent overlapping the text section on the right.

Related files:

- `src/app/cards/[id]/page.tsx`

### 2.4 Click Card Item to Detail

Added behavior to click on a card/listing to go to the detail page:

- Clicking image/title card routes to `/cards/${card.id}`.
- Keyboard Enter/Space also supports routing.
- Buy Now and Offer buttons still keep separate quick actions.

Related files:

- `src/components/card-item.tsx`

### 2.5 Offers Table / RLS

Checked the existing offers migration:

- `supabase/migrations/20260609_create_offers_table_and_rls.sql`
- Migration created the `offers` table with columns:
  - `id`
  - `card_id`
  - `buyer_id`
  - `price`
  - `message`
  - `status`
  - `transaction_id`
  - `created_at`
- Has RLS:
  - Buyer inserts their own offer.
  - Buyer views their own offers.
  - Seller views offers on their cards.
  - Buyer updates a pending offer.
  - Seller updates an offer on their card.
- Has `NOTIFY pgrst, 'reload schema'` for PostgREST reload.

Note: this migration has grants for `anon`, so if security needs to be hardened later, consider removing `anon` grant for the offers table.

### 2.6 Direct Messaging / Chat System

Added buyer-seller chat system v1.

New database migration:

- `supabase/migrations/20260610_create_chat_system.sql`

New tables:

- `conversations`
- `messages`

Main `conversations` fields:

- `id`
- `buyer_id`
- `seller_id`
- `card_id`
- `offer_id`
- `last_message_id`
- `last_message_preview`
- `last_message_at`
- `buyer_last_read_at`
- `seller_last_read_at`
- `status`
- `created_at`
- `updated_at`

Main `messages` fields:

- `id`
- `conversation_id`
- `sender_id`
- `body`
- `message_type`
- `metadata`
- `flagged_terms`
- `created_at`
- `edited_at`
- `deleted_at`

Message types:

- `user`
- `system`
- `offer_auto`
- `safety_warning`

RLS:

- Only participant buyer/seller can view conversations.
- Only participant can view messages.
- Only participant can send messages.
- Seller or buyer in the correct card/offer context can create a conversation.
- No `anon` grant for chat tables.

Realtime:

- Migration added `conversations` and `messages` to `supabase_realtime`.

### 2.7 Chat API Routes

Added APIs:

- `src/app/api/chat/conversations/route.ts`
- `src/app/api/chat/messages/route.ts`
- `src/app/api/chat/read/route.ts`

`GET /api/chat/conversations`:

- Gets the current user's list of conversations.
- Includes the other user's profile.
- Includes the card summary.
- Calculates unread status using `last_message_at` and participant's read timestamp.

`POST /api/chat/conversations`:

- Creates or gets a conversation by `cardId`, optional `offerId`.
- Server automatically determines buyer/seller from card/offer.
- Disallows self-chat.
- Disallows users other than the buyer/seller from opening a conversation.

`GET /api/chat/messages?conversationId=...`:

- Gets messages of a conversation.
- RLS protects participants.

`POST /api/chat/messages`:

- Inserts a message.
- Updates `last_message_*` in the conversation.
- Inserts a `message_received` notification for the recipient.
- Currently only warns about off-platform keywords, not hard-blocking phone numbers/links yet.

`POST /api/chat/read`:

- Updates `buyer_last_read_at` or `seller_last_read_at`.

### 2.8 Chat UI

Added components:

- `src/components/chat-drawer.tsx`

Main components:

- `ChatDrawer`
- `ChatInboxButton`

Features:

- Header has a message icon next to the NotificationBell.
- Click to open the right-side inbox drawer.
- Desktop layout has a conversation list on the left, thread on the right.
- Realtime subscription for `conversations`.
- Realtime subscription for `messages` based on the selected conversation.
- Has an unread badge.
- Has a persistent safety banner in the chat:
  - `⚠️ Safety Warning: To protect yourself from scams...`
- Has an input for sending messages.
- Enter sends a message, Shift+Enter adds a new line.

Attached Header files:

- `src/components/layout/header.tsx`

### 2.9 Chat Integration into Product Detail

Integrated chat into `/cards/[id]`:

- `Message` button in the right panel.
- `Message seller` button.
- Seller offer management has a `Chat` button per offer.
- On click, calls `POST /api/chat/conversations`, sets `chatConversationId`, opens `ChatDrawer`.

Related files:

- `src/app/cards/[id]/page.tsx`

### 2.10 Chat Integration into Offer Modal

Integrated Offer Modal:

- When a buyer sends a new offer:
  - Insert offer.
  - Notify seller as before.
  - Create/get conversation.
  - Send `offer_auto` message.
- When a buyer updates an offer:
  - Update offer.
  - Create/get conversation.
  - Send `offer_auto` message.
- After success, if `conversationId` exists, the detail page opens the chat drawer.

Auto-message currently switched to Vietnamese:

- `Sent an offer of 900.000đ for "EDERSON": ...`
- `Updated offer of 900.000đ for "EDERSON": ...`

Related files:

- `src/components/offer-modal.tsx`
- `src/app/cards/[id]/page.tsx`

### 2.11 Fix Chat Bubble Wrong Role

Issue reported by user:

- Buyer sends an offer but in the chat bubble, it looks like the seller sent it.
- Cause: `offer_auto` is rendered like a system message or left-aligned, not based on `sender_id`.

Fixed:

- `offer_auto` is now aligned according to the correct `sender_id`.
- If the current user is the sender, it's aligned to the right.
- Display label:
  - `You · Made an offer`
  - or the other user's name if sent by the other side.
- `system` and `safety_warning` are now displayed as centered notifications.

Related files:

- `src/components/chat-drawer.tsx`

### 2.12 Seller Accept Offer

Currently, seller accept offer in card detail has the logic:

- Insert `transactions` status `active`.
- `expires_at` = now + 2 hours.
- Update `offers.status = chosen`.
- Set `offers.transaction_id`.
- Update `cards.status = in_transaction`.
- Insert notification for the buyer:
  - type `offer_accepted`
  - title `Offer accepted!`
  - message directing the buyer to the transaction room.
- Insert system chat message:
  - `The seller has accepted the offer... Please complete the payment directly on CardVerse.`
- Route seller to `/transaction/{transactionId}`.

Related files:

- `src/app/cards/[id]/page.tsx`

## ✅ Update 2026-06-10: Completed All Plans in Section 7

This time, the remaining tasks have been completed (Step 1 → Step 6 in section 7):

1. **Hard-block phone/link in chat** (`src/app/api/chat/messages/route.ts`):
   - Added `detectBlocked()`: regex to block links (`http(s)://`, `www.`, domains `.com/.vn/...`) and VN phone numbers
     (`+84/84/0` + 8-10 digits, or string of 9-12 digits after removing spaces/symbols).
   - Only applies to `messageType === 'user'`; `offer_auto`/`system` are not blocked.
   - Returns `422` with `code: blocked_external_link | blocked_phone_number`, does not insert message.
   - Client (`chat-drawer.tsx`) catches 422, keeps the draft, and shows a toast: "Cannot send links or phone numbers".

2. **Migration notification context** (`supabase/migrations/20260611_add_chat_context_to_notifications.sql`):
   - Added columns `conversation_id`, `transaction_id` (FK, on delete set null) + index.
   - Updated `src/lib/supabase/database.types.ts` and `src/lib/types.ts`.

3. **Notification insert with context**:
   - `chat/messages`: notification `message_received` sets `conversation_id`.
   - `offer-modal.tsx`: notification `offer_received` moved down after creating a conversation, sets `conversation_id` + `offer_id`.
   - API accept offer: notification `offer_accepted` sets `conversation_id` + `transaction_id`.

4. **Notification click routing** (`notification-bell.tsx`):
   - `offer_accepted` + `transactionId` → `router.push('/transaction/{id}')`.
   - `message_received` / `offer_received` + `conversationId` → dispatches window event `cardverse:open-chat`.
   - Fallback → `/cards/{cardId}`.
   - `ChatInboxButton` (header, global) listens to `cardverse:open-chat` and opens `ChatDrawer` to the exact conversation.

5. **Accept offer moved to API** (`src/app/api/offers/[id]/accept/route.ts`):
   - Verify auth + seller + offer `pending` + card `active`.
   - Race guard: only request to flip card `active → in_transaction` is allowed to proceed; rollback if creating a transaction fails.
   - Create transaction (expires +2h), update offer `chosen` + `transaction_id`, get/create conversation,
     insert system message, insert notification with `conversation_id` + `transaction_id`.
   - Returns `{ transactionId, conversationId }`. `cards/[id]/page.tsx` `handleAcceptOffer` now only calls the API.

6. **Offer action card in ChatDrawer** (`chat-drawer.tsx`):
   - When `conversation.offerId` exists, fetch offer summary (price/status/buyer/transaction).
   - Seller + offer `pending` → "Accept offer" button (calls API, then routes to transaction).
   - Buyer + offer `chosen` + `transaction_id` → "Pay now" button → routes to transaction.
   - Displays offer status (pending/chosen/rejected).

**Need to run migrations before testing:** `20260610_create_chat_system.sql` (if not done yet) and
`20260611_add_chat_context_to_notifications.sql`.

Targeted `tsc --noEmit` for the recently modified files: no new errors (full tsc still fails due to old errors across the repo, section 3.6).

---

## 3. Not Yet Done / To Be Done Next (history — mostly done in the update above)

### 3.1 Hard-Block Phone Numbers And Links In Chat Not Yet Implemented

Currently, `/api/chat/messages` only warns about keywords like:

- `facebook`
- `zalo`
- `phone`
- `bank`
- `telegram`
- `whatsapp`

Not yet hard-blocked:

- Links like `http://`, `https://`, `www.`
- Domains like `.com`, `.vn`, `.net`, `.org`, `.io`, `.me`
- Vietnam phone numbers:
  - `09...`
  - `03...`
  - `07...`
  - `08...`
  - `05...`
  - `+84...`
  - Strings of 9-12 digits with spaces/dots/dashes.

Next plan:

- If message type is `user` and detects phone/link, API returns `422`.
- Do not insert the message.
- Response codes:
  - `blocked_phone_number`
  - `blocked_external_link`
- Client toast:
  - `Cannot send links or phone numbers`
  - `Please communicate and pay directly on CardVerse to avoid scams.`

### 3.2 Notification Click Does Not Open Correct Chat/Transaction Yet

Currently, if `NotificationBell` clicks a notification with `cardId`, it routes to `/cards/{cardId}`.

Issues:

- `message_received` should open chat to the correct conversation, not just the detail page.
- `offer_received` when seller clicks, it should open chat/offer context or detail page with drawer.
- `offer_accepted` when buyer clicks, it should go directly to `/transaction/{transactionId}`.

Missing data in `notifications`:

- Doesn't have `conversation_id`.
- Doesn't have `transaction_id`.

Next plan:

- Supplementary migrations:
  - `conversation_id uuid references public.conversations(id) on delete set null`
  - `transaction_id uuid references public.transactions(id) on delete set null`
- Upon inserting a chat notification, set `conversation_id`.
- When seller accepts an offer, set `transaction_id`.
- Update `Notification` type in `src/lib/types.ts`.
- Update database types.
- Update `NotificationBell` behavior:
  - `message_received`: open `ChatDrawer` with `conversationId`.
  - `offer_received`: open detail + chat/offer context or chat drawer if `conversationId` exists.
  - `offer_accepted`: route to `/transaction/{transactionId}`.

### 3.3 Seller Accept Offer Should Be Moved To A Separate API Route

Currently, accepting an offer is in the client page:

- `src/app/cards/[id]/page.tsx`
- function `handleAcceptOffer`

Issues:

- Important business logic is scattered across the client.
- Needs stricter server-side validation:
  - Current user is seller.
  - Offer is still `pending`.
  - Card is still `active`.
  - Prevent double-accept/race conditions.

Next plan:

- Create API:
  - `POST /api/offers/[id]/accept`
- API actions:
  - Verify auth.
  - Load offer + card.
  - Verify current user is seller.
  - Verify offer pending, card active.
  - Create transaction.
  - Update offer/card.
  - Insert notification with `transaction_id`, `conversation_id`.
  - Insert system chat message.
- Client calls the API instead of manually inserting/updating multiple tables.

### 3.4 Chat Drawer Doesn't Have a Clear Offer Action Card Yet

Users want sellers to have a clear flow upon receiving an offer:

- Buyer sends an offer.
- Seller receives a notification.
- Seller opens the chat and sees the price offer.
- Seller has an `Accept offer` button.
- After the seller accepts, the buyer sees a CTA to pay.

Currently:

- Chat has an auto-message offer.
- Seller can accept the offer in the detail page owner tools.
- Chat drawer does not have a separate offer action card yet.

Next plan:

- In `ChatDrawer`, if `conversation.offerId` exists:
  - Fetch offer summary.
  - Display offer card in thread header or under safety banner.
- If current user is seller and offer is `pending`:
  - Display `Accept offer` button.
- If current user is buyer and offer is `chosen` with `transaction_id`:
  - Display `Pay now` button.
- If offer is rejected/chosen, display status clearly.

### 3.5 Buyer Does Not Automatically Switch To Payment If In Chat

Answering user's question:

- Currently, when a seller accepts an offer, **the transaction is created** and the buyer will have a notification.
- But the buyer **does not automatically redirect immediately** if they are on another tab or viewing chat.
- Buyer needs to click the notification or go to the transaction link.

Next plan:

- If the buyer has the `ChatDrawer` open, a realtime system message appears with a `Pay now` button.
- If the buyer clicks the `offer_accepted` notification, route directly to `/transaction/{transactionId}`.
- Do not auto-redirect across the app to prevent jarring user experiences while they are performing actions, unless the user is exactly in the chat/conversation and clicks the CTA.

### 3.6 Full TypeScript Check Still Fails Due to Old Errors

Ran targeted TypeScript checks for the recently modified chat/detail files, no errors reported.

But a full `npx tsc --noEmit --pretty false` still fails with many old errors across the repo:

- Supabase generated types infer `never` in many pages/APIs.
- Deno edge function imports lack types in the Next/tsc environment.
- Several old type mismatches in profile/data/components.

These full tsc errors are not exclusively due to the new chat.

## 4. Modified / Added Files

### 4.1 Added Files

- `src/components/chat-drawer.tsx`
- `src/app/api/chat/conversations/route.ts`
- `src/app/api/chat/messages/route.ts`
- `src/app/api/chat/read/route.ts`
- `supabase/migrations/20260610_create_chat_system.sql`
- `message_detail.md`

### 4.2 Modified Files

- `src/app/cards/[id]/page.tsx`
- `src/components/offer-modal.tsx`
- `src/components/notification-bell.tsx`
- `src/components/layout/header.tsx`
- `src/components/card-item.tsx`
- `src/components/checkout-modal.tsx`
- `src/app/api/marketplace/buy/route.ts`
- `src/lib/types.ts`
- `src/lib/supabase/database.types.ts`

### 4.3 Files With Changes From Previous Tasks But Not Purely Chat

- `src/app/cards/[id]/page.tsx`: large eBay-like detail, chat integration, seller accept offer.
- `src/components/card-item.tsx`: click to detail.
- `src/components/checkout-modal.tsx`: checkout conflict toast + wallet effect fix.
- `src/app/api/marketplace/buy/route.ts`: card unavailable response.

## 5. Database Notes

### 5.1 Migrations to Run

Before testing the chat UI, you must run:

- `supabase/migrations/20260610_create_chat_system.sql`

If not run, errors that might occur:

- `relation public.conversations does not exist`
- `relation public.messages does not exist`
- Chat icon/inbox cannot load.
- API chat returns table does not exist error.

### 5.2 Next Migration to Add

Need to add a new migration for notification context:

```sql
alter table public.notifications
  add column if not exists conversation_id uuid references public.conversations(id) on delete set null,
  add column if not exists transaction_id uuid references public.transactions(id) on delete set null;

create index if not exists notifications_conversation_idx on public.notifications(conversation_id);
create index if not exists notifications_transaction_idx on public.notifications(transaction_id);

notify pgrst, 'reload schema';
```

Afterwards update:

- `src/lib/supabase/database.types.ts`
- `src/lib/types.ts`
- insert notifications in chat/offer/accept offer flows.

## 6. Current Behavior

### Buyer Sends Offer

1. Buyer opens card detail.
2. Buyer clicks `Make Offer`.
3. Buyer enters price and message.
4. App inserts/updates `offers`.
5. App inserts `offer_received` notification for the seller.
6. App creates/gets a conversation.
7. App sends an `offer_auto` message into the chat.
8. If successful, chat drawer might open.

### Seller Receives Offer

1. Seller receives `New price offer` notification.
2. Currently, clicking the notification routes to card detail.
3. Seller can view owner offer tools in the detail page.
4. Seller can click `Chat` on the offer row.
5. Seller can click `Accept`.

What is not correct yet:

- Clicking the notification does not open the correct chat/offer context.
- Seller does not have an accept button right inside the ChatDrawer.

### Seller Accepts Offer

1. Seller clicks accept in detail owner tools.
2. App creates transaction.
3. App updates offer/card.
4. App sends a notification for the buyer.
5. App sends a system chat message.
6. Seller routes to `/transaction/{id}`.

What is not correct yet:

- Buyer notification does not route directly to the transaction because the notification doesn't save `transaction_id`.
- Chat does not have a `Pay now` CTA.

## 7. Next Plan To Execute

### Step 1: Block Phone/Links In Chat

Files to modify:

- `src/app/api/chat/messages/route.ts`
- `src/components/chat-drawer.tsx`

Implementation:

- Add regex to detect URL/domain.
- Add regex to detect VN phone numbers.
- For `messageType === 'user'`, if matched, return `422`.
- Do not insert message.
- Client catches the code and shows a clear toast.

### Step 2: Add Notification Context Migration

File to add:

- `supabase/migrations/YYYYMMDD_add_chat_context_to_notifications.sql`

Columns:

- `conversation_id`
- `transaction_id`

Update types:

- `src/lib/types.ts`
- `src/lib/supabase/database.types.ts`

### Step 3: Update Notification Insert

Files to modify:

- `src/app/api/chat/messages/route.ts`
- `src/components/offer-modal.tsx`
- `src/app/cards/[id]/page.tsx` or new accept offer API.

Data to set:

- `conversation_id` for message notification.
- `conversation_id` for offer_received if a conversation could be created.
- `transaction_id` for offer_accepted.

### Step 4: Update Notification Click Routing

File to modify:

- `src/components/notification-bell.tsx`
- Might need to lift/open `ChatDrawer` from Header or add route query like `/cards/{id}?chat={conversationId}`.

Behavior:

- `message_received` + `conversationId`: opens chat drawer.
- `offer_received` + `conversationId`: opens chat drawer.
- `offer_accepted` + `transactionId`: `router.push('/transaction/{transactionId}')`.
- Fallback if data is missing: routes to card detail as it currently does.

### Step 5: Move Accept Offer To API

File to add:

- `src/app/api/offers/[id]/accept/route.ts`

Files to modify:

- `src/app/cards/[id]/page.tsx`
- `src/components/chat-drawer.tsx`

Business logic:

- Server validates seller/offer/card.
- Creates transaction.
- Updates offer/card.
- Inserts notifications.
- Inserts system chat message.
- Returns `{ transactionId, conversationId }`.

### Step 6: Add Offer Context UI In ChatDrawer

File to modify:

- `src/components/chat-drawer.tsx`

UI:

- Small card under safety banner:
  - Offer price.
  - Offer status.
  - Buyer/seller role text.
  - Seller button `Accept offer` if pending.
  - Buyer button `Pay now` if chosen + transaction.

## 8. Test Checklist

### Chat Blocking

- Buyer sends `zalo 0901234567` -> gets blocked, not saved to DB.
- Buyer sends `facebook.com/test` -> gets blocked, not saved to DB.
- Buyer sends `www.google.com` -> gets blocked, not saved to DB.
- Buyer sends `ok i will take it now` -> sent successfully.
- Seller sends phone number/link -> also gets blocked.
- `offer_auto` message still sends because it is app-generated.

### Notification Routing

- Buyer sends an offer -> seller gets a notification.
- Seller clicks the notification -> opens correct chat/conversation.
- Buyer sends a normal chat -> seller clicks notification -> opens correct chat.
- Seller accepts the offer -> buyer gets a notification.
- Buyer clicks the accepted notification -> goes to `/transaction/{id}`.

### Offer Accept

- Seller accepts pending offer -> transaction is created.
- Card changes to `in_transaction`.
- Offer changes to `chosen`.
- Buyer sees payment CTA in chat.
- Double-accept at the same time does not create two transactions.
- Seller who is not owner cannot accept.

### RLS

- Buyer only views their own conversations.
- Seller only views their own conversations.
- A third user cannot query messages/conversations.

### Regression

- Buy Now still opens checkout.
- Make Offer still works.
- Detail page still loads image/title/price.
- NotificationBell still shows old notifications that lack conversation/transaction contexts.

## 9. Verification Done

Ran targeted TypeScript checks multiple times for related files:

- `src/components/chat-drawer.tsx`
- `src/components/offer-modal.tsx`
- `src/app/cards/[id]/page.tsx`
- `src/components/layout/header.tsx`
- `src/components/notification-bell.tsx`
- `src/app/api/chat/*`
- `src/lib/types.ts`
- `src/lib/supabase/database.types.ts`

Targeted checks have no remaining errors in newly added/directly modified files.

Full `npx tsc --noEmit --pretty false` still fails due to old errors across the repo as noted in section 3.6.

## 10. Notes For The Next Agent

You should not just fix UI. The errors users are currently seeing are flow/data issues:

- Notification lacks `conversation_id` and `transaction_id`.
- Chat API does not yet hard-block phones/links.
- Accept offer logic is still on the client detail page.
- Chat drawer lacks an offer action card.

The safest execution order:

1. Add notification context migration.
2. Hard-block phone/link in the chat API.
3. Update chat notification insert with `conversation_id`.
4. Create the accept offer API.
5. Update NotificationBell route/open chat.
6. Add the offer action card in ChatDrawer.
7. Test with two accounts buyer/seller.

Avoid:

- Do not auto-redirect the buyer across the whole app when a seller accepts, as it can easily cause users to lose context. Use notifications + CTAs in chat.
- Do not let the user send a phone number/link and then just warn them, because the user explicitly requested to block them.
- Do not leave seller accept offer completely client-side in the long term, because it's prone to race conditions and weak security.
