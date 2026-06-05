-- =====================================================================
-- Soccer pricing layer + catalog backfill
-- Runs AFTER 20260605_create_soccer_catalog.sql (catalog + match fn).
--
-- WHY a separate pricing layer:
--   The catalog (soccer_cards) is STATIC and lean so its hot trigram GIN
--   stays cache-resident on a Micro instance. Perishable prices must NOT
--   bloat that table. So prices live in two side tables:
--     * soccer_price_cache  — external market price w/ TTL (refresh job)
--     * soccer_own_sales     — our own marketplace sold records
--   Both reference soccer_cards(id); neither is indexed for fuzzy search.
--
-- This migration is ADDITIVE and IDEMPOTENT:
--   * tables use CREATE TABLE IF NOT EXISTS
--   * the backfill only runs when soccer_cards is empty
--   * it never touches crawled_cards / soccer_products / featured views,
--     so the live soccer page keeps working untouched.
-- =====================================================================

-- =====================================================================
-- 1) PRICE CACHE (TTL) — one row per catalog card, refreshed externally
-- =====================================================================
create table if not exists soccer_price_cache (
    card_id      bigint primary key references soccer_cards(id) on delete cascade,
    market_price numeric(12,2),
    low_price    numeric(12,2),
    mid_price    numeric(12,2),
    high_price   numeric(12,2),
    currency     text        not null default 'USD',
    sample_size  int         not null default 0,
    source       text        not null default 'ebay',
    fetched_at   timestamptz not null default now(),
    -- TTL: a refresh job re-fetches rows where expires_at < now()
    expires_at   timestamptz not null default now() + interval '24 hours'
);

-- Lets the refresh job cheaply find stale rows.
create index if not exists idx_soccer_price_cache_expires
    on soccer_price_cache (expires_at);

-- =====================================================================
-- 2) OWN SALES — our marketplace's realized sales, kept apart from the
--    external price cache so we can blend/compare the two later.
-- =====================================================================
create table if not exists soccer_own_sales (
    id         bigint generated always as identity primary key,
    card_id    bigint      not null references soccer_cards(id) on delete cascade,
    order_id   uuid,                                   -- link to orders if available
    price      numeric(12,2) not null,
    currency   text        not null default 'VND',
    sold_at    timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create index if not exists idx_soccer_own_sales_card
    on soccer_own_sales (card_id, sold_at desc);

-- =====================================================================
-- 3) BACKFILL the catalog from existing crawled_cards.
--    Source data is noisy eBay titles: player_name is the cleanest signal
--    (we only take rows that have it); brand / parallel / print run /
--    facets are parsed best-effort from the full title (cc.name).
--    Guarded so it only populates an EMPTY catalog (safe to re-run).
-- =====================================================================
do $$
begin
    if exists (select 1 from soccer_cards limit 1) then
        raise notice 'soccer_cards already populated — skipping backfill';
        return;
    end if;

    -- Parsed, de-noised staging set (dropped at commit).
    create temp table _sb on commit drop as
    select * from (
        select
            trim(cc.player_name) as player,

            -- year: prefer the year column, fall back to a YYYY in the title
            nullif(left(regexp_replace(
                coalesce(nullif(cc.year,''),
                         substring(cc.name from '(?:19|20)[0-9][0-9]')),
                '[^0-9]', '', 'g'), 4), '')::int as year_int,

            -- brand (manufacturer); sub-brands map to their owner
            case
                when cc.name ~* 'panini'            then 'Panini'
                when cc.name ~* 'donruss'           then 'Panini'
                when cc.name ~* '\mscore\M'         then 'Panini'
                when cc.name ~* 'merlin'            then 'Topps'
                when cc.name ~* 'bowman'            then 'Topps'
                when cc.name ~* 'topps'             then 'Topps'
                when cc.name ~* 'futera'            then 'Futera'
                when cc.name ~* 'upper[[:space:]]+deck' then 'Upper Deck'
                when cc.name ~* '\mleaf\M'          then 'Leaf'
                else 'Unknown'
            end as brand,

            coalesce(nullif(trim(cc.set_name), ''), 'Unknown') as set_name,

            -- parallel / finish (ordered most-specific first)
            case
                when cc.name ~* 'gold[[:space:]]+refractor' then 'Gold Refractor'
                when cc.name ~* 'superfractor'              then 'Superfractor'
                when cc.name ~* '\mrefractor\M'             then 'Refractor'
                when cc.name ~* 'cracked[[:space:]]+ice'    then 'Cracked Ice'
                when cc.name ~* '\mprizm\M'                 then 'Prizm'
                when cc.name ~* '\mmojo\M'                  then 'Mojo'
                when cc.name ~* '\msapphire\M'              then 'Sapphire'
                when cc.name ~* '\msilver\M'                then 'Silver'
                when cc.name ~* '\mgold\M'                  then 'Gold'
                when cc.name ~* '\mpurple\M'                then 'Purple'
                when cc.name ~* '\maqua\M'                  then 'Aqua'
                when cc.name ~* '\mpink\M'                  then 'Pink'
                when cc.name ~* '\morange\M'                then 'Orange'
                when cc.name ~* '\mgreen\M'                 then 'Green'
                when cc.name ~* '\mred\M'                   then 'Red'
                when cc.name ~* '\mblue\M'                  then 'Blue'
                when cc.name ~* '\mblack\M'                 then 'Black'
                else 'Base'
            end as parallel,

            -- serial print run from "/NN" but NOT from a "YYYY/NN" season
            case
                when cc.name ~ '(19|20)[0-9][0-9]/[0-9]' then null
                else nullif((regexp_match(cc.name, '/[[:space:]]*([0-9]{1,4})'))[1], '')::int
            end as print_run,

            -- card number: existing column, else "#NN" from the title (capped)
            left(coalesce(nullif(trim(cc.card_number), ''),
                          (regexp_match(cc.name, '#[[:space:]]*([A-Za-z0-9]+)'))[1]), 16) as card_number,

            (cc.name ~* '(\mrc\M|\mrookie\M)')                                as is_rookie,
            (cc.name ~* '(\mauto\M|autograph|signature|\msigned\M)')         as is_auto,
            (cc.name ~* '(patch|\mjersey\M|\mrelic\M|memorabilia|worn)')      as is_mem
        from crawled_cards cc
        where (cc.category ilike '%soccer%' or cc.category ilike '%football%')
          and cc.player_name is not null
          and length(trim(cc.player_name)) between 2 and 60
    ) q
    where q.year_int is not null;

    -- 3a) sets first (so the cards insert can resolve set_id by join)
    insert into soccer_sets (brand, set_name, year)
    select distinct brand, set_name, year_int
    from _sb
    on conflict (brand, set_name, year) do nothing;

    -- 3b) one catalog row per (set, player, parallel, card_number).
    --     DISTINCT ON collapses dupes that share a NULL card_number
    --     (which a unique constraint would treat as distinct).
    insert into soccer_cards (
        set_id, brand, year, set_name, player, card_number, parallel,
        print_run, is_rookie, is_autograph, is_memorabilia, tier
    )
    select distinct on (s.id, lower(b.player), lower(b.parallel), coalesce(b.card_number, ''))
        s.id, b.brand, b.year_int, b.set_name, b.player, b.card_number, b.parallel,
        b.print_run, b.is_rookie, b.is_auto, b.is_mem,
        -- tier 1 = liquid (numbered or autograph) -> goes into the hot GIN
        case when b.print_run is not null or b.is_auto then 1 else 2 end
    from _sb b
    join soccer_sets s
      on s.brand = b.brand and s.set_name = b.set_name and s.year = b.year_int
    order by s.id, lower(b.player), lower(b.parallel), coalesce(b.card_number, ''),
             b.print_run nulls last
    on conflict (set_id, player, parallel, card_number) do nothing;

    raise notice 'soccer backfill done: % sets, % cards',
        (select count(*) from soccer_sets),
        (select count(*) from soccer_cards);
end $$;

-- Refresh planner stats so the structured btree pre-filter is chosen.
analyze soccer_sets;
analyze soccer_cards;
