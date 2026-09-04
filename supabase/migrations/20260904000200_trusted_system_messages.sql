-- Trusted chat messages: only the server may claim the app is speaking.
--
-- The chat renderer treats `message_type = 'system'` (and 'offer_auto') as the
-- app's own voice: it ignores the stored body and draws its own trusted wording
-- from `metadata.kind` — "the seller accepted your offer", "the buyer paid
-- 150,000d, prepare the shipment". Content screening is skipped for the same
-- reason.
--
-- But the INSERT policy below only ever checked *who* was writing, never *what*
-- they claimed to be. Any participant could call PostgREST directly with the
-- anon key and insert a 'system' message carrying `kind: 'order_paid'` and any
-- price they liked, then push the seller to ship a card nobody paid for.
-- Narrowing the API route's whitelist does not help: the REST endpoint is
-- public and needs no cooperation from our routes.
--
-- So the boundary moves into the database. Authenticated users may write only
-- the two kinds a person actually composes. Every genuine system/offer_auto
-- message is produced server-side by the service-role client, which bypasses
-- RLS by design.

DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;

CREATE POLICY "Participants can send messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    -- App-generated verdicts are server-only. Everything a human types or
    -- uploads still goes through here.
    AND message_type IN ('user', 'image')
    AND EXISTS (
      SELECT 1
      FROM public.conversations
      WHERE conversations.id = messages.conversation_id
        AND conversations.status = 'active'
        AND (auth.uid() = conversations.buyer_id OR auth.uid() = conversations.seller_id)
    )
  );

-- Closing the same door on UPDATE.
--
-- Restricting INSERT alone was not enough: "Senders can soft-edit their
-- messages" checks only `auth.uid() = sender_id`, so a participant could insert
-- a perfectly legal 'user' message and then PATCH it into
-- message_type='system' with metadata.kind='order_paid'. The forged payment
-- receipt arrives by a slightly longer route and reads identically.
--
-- USING keeps a person out of messages that are already the app's voice;
-- WITH CHECK stops one of their own messages from becoming it.

DROP POLICY IF EXISTS "Senders can soft-edit their messages" ON public.messages;

CREATE POLICY "Senders can soft-edit their messages"
  ON public.messages FOR UPDATE
  TO authenticated
  USING (auth.uid() = sender_id AND message_type IN ('user', 'image'))
  WITH CHECK (auth.uid() = sender_id AND message_type IN ('user', 'image'));

-- One paid-receipt per order, enforced by the database rather than by a
-- read-then-write in application code.
--
-- `announceOrderPaidInChat` runs from four payment paths, and both of the ones
-- that matter can execute concurrently or replay: the PayOS post-processing
-- claim is only at-least-once, and two wallet checkouts sharing an
-- Idempotency-Key can both observe the same committed order. A SELECT before
-- the INSERT loses that race — and once two rows exist, the duplicate check
-- itself starts failing, so every later retry piles on another receipt.
CREATE UNIQUE INDEX IF NOT EXISTS messages_order_paid_receipt_unique
  ON public.messages ((metadata ->> 'orderId'))
  WHERE message_type = 'system' AND metadata ->> 'kind' = 'order_paid';
