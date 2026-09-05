-- Two things a person can undo in chat: one message, or the whole conversation.
--
-- Neither existed. A message typed by mistake stayed typed, and an inbox filled
-- with settled business — delivered orders, rejected offers — had nothing that
-- would clear it.

-- ---------------------------------------------------------------------------
-- 1. Unsend one message
-- ---------------------------------------------------------------------------
--
-- `messages.deleted_at` has been on the table since 20260610 with nothing
-- writing to it, and the UPDATE policy rewritten in 20260904000200 already says
-- exactly what an unsend needs to be allowed to do:
--
--   using (auth.uid() = sender_id and message_type in ('user', 'image'))
--
-- So a route holding the caller's own client is already authorized for its own
-- messages and blocked from the app's — no new policy, no new grant.
--
-- What is missing is room to blank the body. Recalling has to erase the text in
-- the row rather than hide it behind a flag, because realtime ships the whole
-- new row to the other participant: leave the body in place and the recalled
-- sentence still crosses the wire, with only our client's good manners keeping
-- it off the screen. That is not a recall.
--
-- `messages_body_check` (20260627) requires a non-empty body unless the row is
-- an image carrying metadata.imageUrl — and an unsent image loses its metadata
-- too. Widen it by one arm: a row that has been recalled may be empty.
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages
  add constraint messages_body_check
  check (
    char_length(body) <= 2000
    and (
      char_length(trim(body)) >= 1
      or (message_type = 'image'::text and metadata ? 'imageUrl')
      or deleted_at is not null
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Delete a conversation, on one side only
-- ---------------------------------------------------------------------------
--
-- Messenger's meaning: it leaves your inbox and stays in theirs, and if they
-- write again the thread returns carrying only what arrives after the cut. A
-- timestamp per participant expresses all of that — rows are never deleted, so
-- the other side's copy and the evidence trail behind a disputed order are
-- untouched by one person tidying up.
alter table public.conversations
  add column if not exists buyer_deleted_at timestamptz,
  add column if not exists seller_deleted_at timestamptz;

-- Deliberately NOT added to the column list in `grant update (...) on
-- public.conversations to authenticated` (20260610).
--
-- The UPDATE policy on this table checks only that the caller is one of the two
-- participants; it does not tie a participant to their own columns. Every
-- column named in that grant is therefore writable by either side, which is
-- survivable for read receipts and is not survivable here — a buyer could clear
-- the seller's inbox from the browser console. These two are written by the
-- route instead, with the service role, after it has confirmed who is asking.
--
-- (`buyer_last_read_at` / `seller_last_read_at` have the same weakness today.
-- Left alone here: closing it means splitting the policy per role, which is a
-- change to how read receipts are written and does not belong in this one.)

-- Both filters ask the same question — "conversations of mine, newest first" —
-- and the existing per-role indexes already answer it; the deleted_at test is
-- applied to the handful of rows that come back, so no index is added for it.

notify pgrst, 'reload schema';
