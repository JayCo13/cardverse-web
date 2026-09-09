-- Make `profiles.completed_transactions` mean something again.
--
-- Nothing has ever written this column. No migration sets it, no application
-- code sets it, and every one of the accounts on this database reads 0 — while
-- `orders` holds completed rows and the ledger holds the `order_completed`
-- events for both sides of each of them.
--
-- That was survivable while the column was only decoration. It stopped being
-- survivable when `reputation.ts` started tiering the ⚠️/✓/⭐ badge off it: with
-- the column frozen at zero, `completedOrders < MIN_ORDERS_TO_SHOW_SCORE` is
-- true for everybody forever, so every account renders as "Người mới" and the
-- thresholds at 5, 30 and 100 orders are unreachable by construction. The badge
-- is about to become the only reputation figure the marketplace shows, so it has
-- to be able to move.
--
-- The number is already in the ledger — 20260909000100 backfilled `order_completed`
-- from every completed order, and 20260909000300's trigger on `orders.status`
-- keeps writing them. This just stops the column from being a copy nobody makes.
--
-- Counting both roles is deliberate: an account that bought five times and one
-- that sold five times have both completed five transactions, and the tier
-- ladder is about whether there is enough history to show a number at all.

create or replace function public.recompute_reputation(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  update public.profiles p
  set reputation_score = coalesce(agg.score, 0),
      reputation_incidents_90d = coalesce(agg.incidents, 0),
      reputation_incidents_total = coalesce(agg.incidents_total, 0),
      completed_transactions = coalesce(agg.completed, 0),
      updated_at = now()
  from (
    select
      sum(e.delta) as score,
      count(*) filter (
        where e.delta < 0 and e.created_at > now() - interval '90 days'
      ) as incidents,
      count(*) filter (where e.delta < 0) as incidents_total,
      -- No window on this one. "How much history does this account have" does
      -- not decay, which is also why the nightly recompute_stale_reputation_windows
      -- pass does not need to know about it: only a new ledger row can change it,
      -- and every path that writes one comes back through this function.
      count(*) filter (where e.event_type = 'order_completed') as completed
    from public.reputation_events e
    where e.user_id = p_user_id and e.voided_at is null
  ) agg
  where p.id = p_user_id;
end;
$fn$;

-- ─── One-time catch-up ───────────────────────────────────────────────────────
--
-- Only rows that have a ledger. An account with no events keeps its 0, which is
-- already the right answer for someone who has completed nothing.
update public.profiles p
set completed_transactions = agg.completed,
    updated_at = now()
from (
  select e.user_id,
         count(*) filter (where e.event_type = 'order_completed')::integer as completed
  from public.reputation_events e
  where e.voided_at is null
  group by e.user_id
) agg
where p.id = agg.user_id
  and p.completed_transactions is distinct from agg.completed;

notify pgrst, 'reload schema';
