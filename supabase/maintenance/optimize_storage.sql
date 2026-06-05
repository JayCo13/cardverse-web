-- =====================================================================
-- Supabase storage optimization — run in the SQL Editor.
--
-- HOW TO USE: run each PART separately (top to bottom), read the output,
-- decide, then continue. VACUUM / VACUUM FULL cannot run inside a
-- transaction, so do NOT wrap the whole file in one run.
--
-- FIRST: open Dashboard -> Settings -> Usage and note WHICH limit is over:
--   * "Database size"  -> PARTS 0..4 below are exactly for this.
--   * "Egress"         -> the fix is in the app (over-fetching), not here;
--                         see notes at the bottom.
--   * "Compute"        -> upgrade compute or reduce query load.
--
-- Root cause found: tcgcsv_price_history ~3.5M rows (60k products ×
-- ~100 daily snapshots), plus update-bloat from daily upserts.
-- =====================================================================


-- =====================================================================
-- PART 0 — DIAGNOSE (read-only). Run this first; keep the output.
-- =====================================================================

-- 0a) Biggest tables (heap + indexes + toast), with row + dead-tuple counts.
select
    c.relname                                              as table,
    pg_size_pretty(pg_total_relation_size(c.oid))          as total,
    pg_size_pretty(pg_relation_size(c.oid))                as heap,
    pg_size_pretty(pg_indexes_size(c.oid))                 as indexes,
    s.n_live_tup                                           as live_rows,
    s.n_dead_tup                                           as dead_rows,
    s.last_autovacuum
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
where n.nspname = 'public' and c.relkind in ('r','m')   -- tables + matviews
order by pg_total_relation_size(c.oid) desc
limit 20;

-- 0b) Index sizes on the price-history table (spot unused/heavy indexes).
select indexrelname as index, pg_size_pretty(pg_relation_size(indexrelid)) as size, idx_scan as scans
from pg_stat_user_indexes
where relname = 'tcgcsv_price_history'
order by pg_relation_size(indexrelid) desc;


-- =====================================================================
-- PART 1 — COMPACT + DOWNSAMPLE price history (editor-safe, ONE pass).
--
-- WHY NOT VACUUM: the Supabase SQL Editor runs everything inside a
-- transaction, and `VACUUM`/`VACUUM FULL` cannot run there
-- ("cannot run inside a transaction block"). So we DON'T use VACUUM.
--
-- Instead: stage the rows to keep, TRUNCATE the table, reinsert. TRUNCATE
-- is transactional AND reclaims the disk file immediately (it swaps in a
-- fresh, bloat-free heap on commit). Table structure, indexes, RLS
-- policies and the id sequence are all preserved. No view/FK depends on
-- this table, so nothing downstream breaks.
--
-- KEEP RULE: full DAILY detail for the last 45 days + ONE row/product per
-- ISO-week for anything older. Charts (7/30/90/365d) still render; old
-- weeks just lose intra-week wiggle. Tune the interval to taste.
--
-- Run the WHOLE PART 1 block in one go (it is meant to be one transaction).
-- =====================================================================

-- 1a) Stage the rows to keep (disjoint by date, so UNION ALL is safe).
create temp table _ph_keep as
    select * from tcgcsv_price_history
    where recorded_at >= current_date - interval '45 days'
  union all
    select * from (
        select distinct on (product_id, date_trunc('week', recorded_at)) *
        from tcgcsv_price_history
        where recorded_at < current_date - interval '45 days'
        order by product_id, date_trunc('week', recorded_at), recorded_at desc
    ) older_weekly;

-- 1b) Show keep-vs-total before we touch anything.
do $$
begin
    raise notice 'price history: keeping % of % rows',
        (select count(*) from _ph_keep),
        (select count(*) from tcgcsv_price_history);
end $$;

-- 1c) Compact: TRUNCATE reclaims disk now; reinsert the keepers.
truncate tcgcsv_price_history;
insert into tcgcsv_price_history select * from _ph_keep;
drop table _ph_keep;

-- 1d) Refresh planner stats (ANALYZE is allowed inside a transaction).
analyze tcgcsv_price_history;

-- After this finishes, re-run PART 0a — the table (and Database size)
-- should be dramatically smaller, with NO VACUUM needed.

-- NOTE ON DISK HEADROOM: during the run the old heap, the temp copy and
-- the new heap briefly coexist (~1.5× the post-shrink size). If the
-- project is already hard at the disk cap, bump the disk by a small amount
-- in Dashboard -> Settings -> Compute & Disk first, run this, then it
-- drops back down. (Plain VACUUM FULL would need similar headroom but only
-- runs via a direct psql connection, not the SQL Editor.)


-- =====================================================================
-- PART 4 — PREVENT REGROWTH
-- =====================================================================

-- 4a) Drop the standalone recorded_at index if 0b shows it has ~0 scans.
--     The app always filters by product_id, so idx_price_history_product_date
--     already covers it. Saves disk + write cost on every sync.
-- drop index if exists idx_price_history_recorded_at;

-- 4b) Auto-retention so the table can't grow unbounded again.
--     Requires pg_cron (Dashboard -> Database -> Extensions -> enable pg_cron).
-- create extension if not exists pg_cron;
-- select cron.schedule(
--     'prune_tcgcsv_price_history',
--     '0 3 * * *',               -- daily 03:00 UTC
--     $$
--       delete from tcgcsv_price_history
--       where recorded_at < current_date - interval '120 days';
--     $$
-- );

-- 4c) Stop writing a row when the price did not change (biggest future win).
--     The sync-tcgcsv edge function currently upserts one row per product
--     PER DAY unconditionally. Change it to only insert when market_price
--     differs from the product's latest history row. (App/edge change.)


-- =====================================================================
-- EGRESS (if THAT is the limit, not DB size)
-- ---------------------------------------------------------------------
--  * market-spotlight pulls up to 365 history rows per featured product;
--    serve via the get-price-history edge function with days=90 instead of
--    select(...).limit(365) to cut payload.
--  * Avoid `select=*` on tcgcsv_products (extended_data jsonb is heavy) —
--    select only the columns the page needs.
--  * Cache featured/price responses (the featured matviews already help).
-- =====================================================================
