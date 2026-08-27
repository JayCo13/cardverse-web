-- Index the columns the app actually filters and sorts on.
--
-- These are preventive, not a fix for anything users feel today: the tables
-- involved hold hundreds of rows, where Postgres will seq-scan faster than it
-- would read an index. They are here because every one of these queries runs on
-- a hot path — the notification bell fires on every page, the chat drawer on
-- every conversation open — and the point to add an index is before the table
-- is big enough to hurt, not after.
--
-- Postgres indexes primary keys and unique constraints automatically but NOT
-- foreign keys, which is why several of these look like they should already
-- exist.
--
-- Each is ordered to match how the query reads: the equality column first, then
-- the sort column, so one index serves both the filter and the ORDER BY.

-- The notification bell: user's newest first, on every page load.
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- Chat drawer: a conversation's messages, oldest to newest.
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

-- Conversation lists, read from both sides of a trade. Two separate indexes
-- rather than one composite: a query filters on one side or the other, never
-- both, so a composite on (buyer_id, seller_id) would only ever serve buyer_id.
create index if not exists conversations_buyer_idx
  on public.conversations (buyer_id, last_message_at desc);
create index if not exists conversations_seller_idx
  on public.conversations (seller_id, last_message_at desc);

-- Offers, read by buyer on the marketplace and by card on the listing page.
create index if not exists offers_buyer_created_idx
  on public.offers (buyer_id, created_at desc);
create index if not exists offers_card_created_idx
  on public.offers (card_id, created_at desc);

-- The seller's own collection page.
create index if not exists user_collections_user_idx
  on public.user_collections (user_id, created_at desc);

-- KYC: latest session for a user, read by the browser poll every few seconds
-- while a verification is open.
create index if not exists kyc_sessions_user_created_idx
  on public.kyc_sessions (user_id, created_at desc);

-- Bank lookup cache hit, keyed exactly as bank-verification.ts reads it.
create index if not exists bank_account_lookups_account_idx
  on public.bank_account_lookups (bin, account_number, created_at desc);

-- Bank lookup rate limit, counted per user per hour.
create index if not exists bank_account_lookups_user_created_idx
  on public.bank_account_lookups (user_id, created_at desc);

-- Cart, read on every header render.
create index if not exists cart_items_user_created_idx
  on public.cart_items (user_id, created_at desc);
