-- Direct buyer/seller messaging for marketplace listings.

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  card_id uuid,
  offer_id uuid,
  last_message_id uuid,
  last_message_preview text,
  last_message_at timestamp with time zone,
  buyer_last_read_at timestamp with time zone,
  seller_last_read_at timestamp with time zone,
  status text NOT NULL DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'archived'::text, 'blocked'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  CONSTRAINT conversations_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT conversations_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT conversations_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE SET NULL,
  CONSTRAINT conversations_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.offers(id) ON DELETE SET NULL,
  CONSTRAINT conversations_no_self_chat CHECK (buyer_id <> seller_id),
  CONSTRAINT conversations_context_unique UNIQUE (buyer_id, seller_id, card_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 2000),
  message_type text NOT NULL DEFAULT 'user'::text CHECK (message_type = ANY (ARRAY['user'::text, 'system'::text, 'offer_auto'::text, 'safety_warning'::text])),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  flagged_terms text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  edited_at timestamp with time zone,
  deleted_at timestamp with time zone,
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE,
  CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_last_message_id_fkey
  FOREIGN KEY (last_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS conversations_buyer_idx ON public.conversations (buyer_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS conversations_seller_idx ON public.conversations (seller_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS conversations_card_idx ON public.conversations (card_id);
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON public.messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_sender_idx ON public.messages (sender_id);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

REVOKE UPDATE ON TABLE public.conversations FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.conversations TO authenticated;
GRANT UPDATE (
  offer_id,
  last_message_id,
  last_message_preview,
  last_message_at,
  buyer_last_read_at,
  seller_last_read_at,
  status,
  updated_at
) ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.messages TO authenticated;

DROP POLICY IF EXISTS "Participants can view conversations" ON public.conversations;
DROP POLICY IF EXISTS "Buyers can create listing conversations" ON public.conversations;
DROP POLICY IF EXISTS "Participants can update conversation read state" ON public.conversations;
DROP POLICY IF EXISTS "Participants can view messages" ON public.messages;
DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;
DROP POLICY IF EXISTS "Senders can soft-edit their messages" ON public.messages;

CREATE POLICY "Participants can view conversations"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

CREATE POLICY "Buyers can create listing conversations"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.uid() = buyer_id OR auth.uid() = seller_id)
    AND buyer_id <> seller_id
    AND EXISTS (
      SELECT 1
      FROM public.cards
      WHERE cards.id = conversations.card_id
        AND cards.seller_id = conversations.seller_id
    )
    AND (
      offer_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.offers
        WHERE offers.id = conversations.offer_id
          AND offers.card_id = conversations.card_id
          AND offers.buyer_id = conversations.buyer_id
      )
    )
  );

CREATE POLICY "Participants can update conversation read state"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (auth.uid() = buyer_id OR auth.uid() = seller_id)
  WITH CHECK (auth.uid() = buyer_id OR auth.uid() = seller_id);

CREATE POLICY "Participants can view messages"
  ON public.messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations
      WHERE conversations.id = messages.conversation_id
        AND (auth.uid() = conversations.buyer_id OR auth.uid() = conversations.seller_id)
    )
  );

CREATE POLICY "Participants can send messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1
      FROM public.conversations
      WHERE conversations.id = messages.conversation_id
        AND conversations.status = 'active'
        AND (auth.uid() = conversations.buyer_id OR auth.uid() = conversations.seller_id)
    )
  );

CREATE POLICY "Senders can soft-edit their messages"
  ON public.messages FOR UPDATE
  TO authenticated
  USING (auth.uid() = sender_id)
  WITH CHECK (auth.uid() = sender_id);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
