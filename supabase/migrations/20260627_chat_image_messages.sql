-- Allow image messages in chat.
-- Images are uploaded to Cloudinary; the secure URL is stored in metadata.imageUrl.
-- The body becomes optional for image messages (an optional caption), so the
-- length check is relaxed to permit an empty body when an image is attached.

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_message_type_check
  CHECK (message_type = ANY (ARRAY['user'::text, 'system'::text, 'offer_auto'::text, 'safety_warning'::text, 'image'::text]));

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_body_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_body_check
  CHECK (
    char_length(body) <= 2000
    AND (
      char_length(trim(body)) >= 1
      OR (message_type = 'image'::text AND metadata ? 'imageUrl')
    )
  );
