-- =====================================================================
-- Soccer card catalog — schema + fuzzy-match indexes
-- Tuned to stay fast on a Supabase Pro "Micro" instance (1 GB RAM) for
-- as long as possible.
--
-- DESIGN PRINCIPLE (read this first):
--   Do NOT trigram-scan the whole table. Vision/Groq usually extracts
--   brand + year + card_number reliably. Use those to pre-filter via a
--   cheap btree down to a few hundred rows, THEN compute similarity() on
--   that small set. The big trigram GIN is only a *fallback* for when the
--   structured fields are missing — and it is PARTIAL (hot/liquid tier
--   only) so its RAM footprint stays tiny.
--
-- pg_trgm vs tsvector — why pg_trgm here:
--   * tsvector/FTS is token (word) based: great for "messi prizm rookie"
--     word-soup, but it does NOT tolerate typos *inside* a word.
--   * Card scans introduce character-level noise (OCR errors, accents:
--     José/Jose, Mbappé/Mbappe) and naming variants. pg_trgm matches on
--     character trigrams, so it is typo- and accent-tolerant. That is the
--     workhorse we want for player/set matching.
--   (You can layer tsvector later for keyword search UX; for scan→match,
--    trigram is the right primary.)
-- =====================================================================

-- ---------- extensions ----------
-- On Supabase these usually live in the `extensions` schema; on self-hosted
-- Postgres they may land in `public`. The wrapper below sets a search_path
-- that covers both so it resolves regardless of where they were installed.
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- Immutable unaccent wrapper so it can be used in a GENERATED column.
-- (The 1-arg unaccent() is only STABLE; the 2-arg dictionary form is
--  IMMUTABLE, which generated columns require.)
-- Unqualified `unaccent` + an explicit search_path keeps this working
-- whether the extension sits in `extensions` (Supabase) or `public`.
create or replace function f_unaccent(text)
returns text
language sql
immutable
parallel safe
strict
set search_path = extensions, public, pg_catalog
as $$
  select unaccent('unaccent', $1)
$$;

-- =====================================================================
-- Reference table: sets / products (small, rarely changes)
-- =====================================================================
create table if not exists soccer_sets (
    id           bigint generated always as identity primary key,
    brand        text    not null,              -- 'Panini' | 'Topps' | 'Futera' ...
    set_name     text    not null,              -- 'Prizm World Cup Qatar'
    year         int     not null,              -- release year (use start year of season)
    season       text,                          -- optional '2021-22'
    category     text    not null default 'soccer',
    external_ids jsonb   not null default '{}',  -- {tcdb: "...", ...}
    created_at   timestamptz not null default now(),
    unique (brand, set_name, year)
);

-- =====================================================================
-- Catalog: one row per distinct card (player × set × parallel × number)
-- brand/year/set_name are DENORMALIZED onto the row on purpose:
--   (a) lets the generated search_name reference them, and
--   (b) makes the structured pre-filter a single-table btree lookup
--       (no join) — much cheaper on a small instance.
-- =====================================================================
create table if not exists soccer_cards (
    id            bigint generated always as identity primary key,
    set_id        bigint references soccer_sets(id) on delete cascade,

    -- denormalized structured fields (the fast pre-filter keys)
    brand         text    not null,
    year          int     not null,
    set_name      text    not null,
    player        text    not null,
    card_number   text,                          -- text: handles 'RC', 'BAZ-12', '7'
    parallel      text    not null default 'Base',-- 'Base','Silver','Gold /10' ...
    print_run     int,                            -- 10 for /10, null = unnumbered

    -- cheap boolean facets (use as partial-index predicates if needed)
    is_rookie     boolean not null default false,
    is_autograph  boolean not null default false,
    is_memorabilia boolean not null default false,

    -- liquidity tier: 1 = hot/liquid (indexed for fuzzy), 2 = long tail.
    -- Keep tier=1 small (the cards that actually trade) so the hot GIN
    -- stays RAM-friendly.
    tier          smallint not null default 2,

    attributes    jsonb   not null default '{}',
    external_ids  jsonb   not null default '{}',

    -- Normalized, unaccented, lowercased blob used for trigram matching.
    -- Kept intentionally SHORT (player + parallel + set) — shorter strings
    -- => smaller trigram index and sharper similarity scores.
    search_name   text generated always as (
        lower(f_unaccent(
            coalesce(player,'')   || ' ' ||
            coalesce(parallel,'') || ' ' ||
            coalesce(set_name,'')
        ))
    ) stored,

    -- player-only normalized form, for player-first fuzzy lookups
    player_norm   text generated always as (
        lower(f_unaccent(coalesce(player,'')))
    ) stored,

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    -- prevent dupes of the exact same card
    unique (set_id, player, parallel, card_number)
);

-- =====================================================================
-- INDEXES
-- Keep the count LEAN. Every index costs RAM + write amplification.
-- =====================================================================

-- 1) THE workhorse pre-filter. Vision gives brand+year+number → this
--    btree narrows to a handful of rows; similarity() is then computed
--    on that tiny set with NO big index needed. Works across ALL rows
--    (hot and cold), so the long tail is matchable via the structured path.
create index if not exists idx_soccer_cards_struct
    on soccer_cards (brand, year, card_number);

-- 2) Join / set browsing.
create index if not exists idx_soccer_cards_set
    on soccer_cards (set_id);

-- 3) Player-first exact-ish filter (e.g., "all Messi cards").
create index if not exists idx_soccer_cards_player_norm
    on soccer_cards (player_norm);

-- 4) FUZZY FALLBACK — only when structured fields are absent.
--    PARTIAL on tier=1 keeps the GIN small enough to live in cache on
--    Micro. The long tail relies on the structured path (#1) instead.
create index if not exists idx_soccer_cards_trgm_hot
    on soccer_cards using gin (search_name gin_trgm_ops)
    where tier = 1;

-- =====================================================================
-- updated_at trigger
-- =====================================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_soccer_cards_updated on soccer_cards;
create trigger trg_soccer_cards_updated
    before update on soccer_cards
    for each row execute function set_updated_at();

-- =====================================================================
-- MATCH FUNCTION
-- Two paths, chosen by what the scan actually gave you:
--   A) brand + year present  -> structured btree pre-filter, rank by
--      similarity on the small candidate set (cheap, covers ALL tiers).
--   B) otherwise             -> trigram fuzzy via the partial hot GIN.
--
-- Returns top matches with a 0..1 score. Caller decides a confidence
-- cutoff (e.g., auto-accept >= 0.55, else show a picker).
-- =====================================================================
create or replace function match_soccer_card(
    p_query       text,              -- normalized scan text: "messi prizm world cup silver"
    p_brand       text default null,
    p_year        int  default null,
    p_card_number text default null,
    p_parallel    text default null,
    p_limit       int  default 10
)
returns table (
    id          bigint,
    player      text,
    set_name    text,
    parallel    text,
    card_number text,
    year        int,
    tier        smallint,
    score       real
)
language plpgsql
stable
parallel safe
-- Resolve pg_trgm (similarity/% operator) and f_unaccent regardless of
-- whether the extensions live in `extensions` (Supabase) or `public`.
set search_path = extensions, public, pg_catalog
as $$
declare
    qn text := lower(f_unaccent(coalesce(p_query, '')));
begin
    if p_brand is not null and p_year is not null then
        -- Path A: structured pre-filter (btree) + on-the-fly similarity.
        -- No trigram index needed; runs on the narrowed candidate set.
        return query
            select c.id, c.player, c.set_name, c.parallel, c.card_number,
                   c.year, c.tier,
                   similarity(c.search_name, qn) as score
            from soccer_cards c
            where c.brand = p_brand
              and c.year  = p_year
              and (p_card_number is null or c.card_number = p_card_number)
              and (p_parallel   is null or c.parallel ilike p_parallel)
            order by score desc
            limit p_limit;
    else
        -- Path B: fuzzy fallback. `%` hits the partial GIN (tier=1 hot).
        -- word_similarity (`<%`) often beats plain similarity for
        -- multi-word card queries; swap if you prefer.
        return query
            select c.id, c.player, c.set_name, c.parallel, c.card_number,
                   c.year, c.tier,
                   similarity(c.search_name, qn) as score
            from soccer_cards c
            where c.tier = 1
              and c.search_name % qn
            order by score desc
            limit p_limit;
    end if;
end;
$$;

-- Trigram match threshold for the `%` operator (default 0.3). Lower =
-- more lenient fuzzy recall. Tune per your scan quality:
--   set pg_trgm.similarity_threshold = 0.25;   -- session-level
-- For a stable default, set it in the Supabase dashboard DB settings.

-- =====================================================================
-- MICRO-INSTANCE NOTES (keep it fast as you grow)
-- ---------------------------------------------------------------------
--  * tier=1 is your lever. Keep it to cards that actually trade (recent
--    major sets, key players, graded). The hot GIN size tracks tier=1
--    row count, not total catalog size — so a 2M-row catalog can still
--    fuzzy-match out of a 150K-row hot index that fits in cache.
--  * The structured path (idx_soccer_cards_struct) is what scales: it
--    works on the full catalog with a tiny btree, no RAM blowup.
--  * Prices do NOT belong in this table. Keep catalog static and lean;
--    put perishable prices in a separate price_cache (TTL) + your own
--    sales table, so this hot table never bloats and stays cache-resident.
--  * Run ANALYZE soccer_cards after bulk loads so the planner picks the
--    btree pre-filter correctly.
--  * If scan→match latency climbs, the first knob is compute (RAM), not
--    disk: bump Micro -> Small (+$5) before anything else.
-- =====================================================================
