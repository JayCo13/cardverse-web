-- Remember the provider's hosted URL for each session.
--
-- "Reopen verification" was creating a brand new provider session every time.
-- That burns a verification credit per click, and because the provider
-- deduplicates by vendor_data it can hand back the session we already have —
-- which then collides with kyc_sessions' unique (provider, provider_session_id)
-- and fails the request outright.
--
-- Storing the URL lets an unfinished session simply be resumed.

alter table public.kyc_sessions
  add column if not exists session_url text;

notify pgrst, 'reload schema';
