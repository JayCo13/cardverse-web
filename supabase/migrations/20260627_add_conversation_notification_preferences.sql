-- Per-user mute preferences for individual marketplace conversations.

CREATE TABLE IF NOT EXISTS public.conversation_notification_preferences (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  muted boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_notification_preferences_muted_user_idx
  ON public.conversation_notification_preferences (user_id)
  WHERE muted = true;

ALTER TABLE public.conversation_notification_preferences ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_notification_preferences TO authenticated;

DROP POLICY IF EXISTS "Participants can view their conversation notification preferences"
  ON public.conversation_notification_preferences;
DROP POLICY IF EXISTS "Participants can create their conversation notification preferences"
  ON public.conversation_notification_preferences;
DROP POLICY IF EXISTS "Participants can update their conversation notification preferences"
  ON public.conversation_notification_preferences;
DROP POLICY IF EXISTS "Participants can delete their conversation notification preferences"
  ON public.conversation_notification_preferences;

CREATE POLICY "Participants can view their conversation notification preferences"
  ON public.conversation_notification_preferences FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.conversations
      WHERE conversations.id = conversation_notification_preferences.conversation_id
        AND (conversations.buyer_id = auth.uid() OR conversations.seller_id = auth.uid())
    )
  );

CREATE POLICY "Participants can create their conversation notification preferences"
  ON public.conversation_notification_preferences FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.conversations
      WHERE conversations.id = conversation_notification_preferences.conversation_id
        AND (conversations.buyer_id = auth.uid() OR conversations.seller_id = auth.uid())
    )
  );

CREATE POLICY "Participants can update their conversation notification preferences"
  ON public.conversation_notification_preferences FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.conversations
      WHERE conversations.id = conversation_notification_preferences.conversation_id
        AND (conversations.buyer_id = auth.uid() OR conversations.seller_id = auth.uid())
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.conversations
      WHERE conversations.id = conversation_notification_preferences.conversation_id
        AND (conversations.buyer_id = auth.uid() OR conversations.seller_id = auth.uid())
    )
  );

CREATE POLICY "Participants can delete their conversation notification preferences"
  ON public.conversation_notification_preferences FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conversation_notification_preferences'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_notification_preferences;
  END IF;
END $$;
