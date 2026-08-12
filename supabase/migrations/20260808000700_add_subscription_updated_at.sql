-- user_subscriptions existed in some Supabase projects before it was captured
-- in migrations. CREATE TABLE IF NOT EXISTS does not add columns to that legacy
-- shape, while the atomic fulfillment and credit RPCs require updated_at.
alter table public.user_subscriptions
  add column if not exists updated_at timestamptz not null default now();
