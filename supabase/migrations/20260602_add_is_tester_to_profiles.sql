-- Beta tester flag for gated marketplace features (buy / sell / bid / razz).
-- Admin grants access by setting is_tester = true on the user's profile row, e.g.:
--   UPDATE public.profiles SET is_tester = true WHERE email = 'tester@example.com';
-- Normal users default to false and are redirected away from the gated routes.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_tester boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_tester IS
  'Admin-granted beta tester flag. Tester accounts can access gated marketplace features (buy/sell/bid/razz); normal users are blocked.';
