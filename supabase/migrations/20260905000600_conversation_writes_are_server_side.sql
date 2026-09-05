-- Stop either participant from writing the other one's half of a conversation.
--
-- `conversations` carries two columns per participant — a read receipt each,
-- and since 20260905000500 a deletion mark each. The UPDATE policy is:
--
--   using       (auth.uid() = buyer_id or auth.uid() = seller_id)
--   with check  (auth.uid() = buyer_id or auth.uid() = seller_id)
--
-- which asks whether you are in the conversation and never asks which side you
-- are on. RLS cannot ask: USING sees the row before the write and WITH CHECK
-- sees it after, and no policy expression sees both, so "you may change only
-- your own column" is not a sentence this mechanism can express. The
-- column-level grant that accompanies it lists both sides' columns, because it
-- has to list them for either participant to write their own.
--
-- The consequence was small but real: a buyer could set
-- `seller_last_read_at` to now() from the browser console and the seller's
-- unread badge would go quiet over a message they had never opened. The same
-- grant also let either side overwrite `last_message_preview`,
-- `last_message_at` and `status` — the last of which is what makes a
-- conversation blocked.
--
-- Every writer is already a route that has established who is asking and which
-- column belongs to them; the four that were still writing as the caller now
-- write with the service role instead:
--
--   src/app/api/chat/read/route.ts            read receipt, after a 403
--   src/app/api/chat/messages/route.ts        last_message_* + sender's receipt
--   src/app/api/chat/conversations/route.ts   offer_id, on a row RLS returned
--   src/app/api/offers/route.ts               offer_id, on the caller's own row
--
-- (accept, reject, order-paid and the delete handler were already service-role.)
--
-- So the grant has no remaining legitimate user, and revoking it turns a rule
-- the application was keeping into a rule the database keeps.
--
-- SELECT and INSERT are untouched. Reading is participant-scoped by policy and
-- correct; the INSERT policy is the one on this table that genuinely constrains
-- its columns, checking the card belongs to the seller and the offer to the
-- buyer, and the browser never inserts here anyway.
revoke update on table public.conversations from authenticated;

-- The policy applied to exactly one role, and that role can no longer update.
-- Leaving it in place would state a permission that no longer exists.
drop policy if exists "Participants can update conversation read state" on public.conversations;

notify pgrst, 'reload schema';
