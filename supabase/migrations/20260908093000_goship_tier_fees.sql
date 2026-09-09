-- Real carrier prices for the three tiers a listing advertises.
--
-- Same shape as shipping_fees beside it — carrier code to tier to đồng — so
-- everything that already reads a tiered fee keeps working. The difference is
-- where the numbers come from: shipping_fees is nine figures a seller typed and
-- guessed, this is what GoShip quotes for their actual pickup address.
--
-- Cached rather than quoted per view. A listing page cannot make three upstream
-- calls to draw a price range, and carrier prices move rarely enough that a
-- stored answer is the right one until the seller's address changes.
alter table public.profiles
  add column if not exists goship_tier_fees jsonb;

-- When it was computed, so a refresh can tell stale from missing and a seller
-- who moved does not keep advertising the old city's prices.
alter table public.profiles
  add column if not exists goship_tier_fees_at timestamptz;

comment on column public.profiles.goship_tier_fees is
  'Real GoShip prices per carrier per tier, same shape as shipping_fees. Computed from goship_pickup; null until quoted.';

alter table public.profiles
  drop constraint if exists profiles_goship_tier_fees_shape;

-- An object at least; the shape below that is the app's business, but a scalar
-- or an array here would break every reader silently.
alter table public.profiles
  add constraint profiles_goship_tier_fees_shape check (
    goship_tier_fees is null or jsonb_typeof(goship_tier_fees) = 'object'
  );
