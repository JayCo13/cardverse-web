-- Seller listing standardization (docs/seller-listing-standardization.md).
--
-- Goal: every single-card listing can be tied to EXACTLY one catalog card so
-- completed sales can be aggregated into a real Vietnamese market price that
-- the scan feature shows next to the eBay price.
--
-- 1) Identity columns on cards (soft links — catalogs are externally crawled,
--    so no hard FKs).
-- 2) vn_card_sales: one row per COMPLETED order of a standardized listing.
-- 3) vn_market_price view: 90-day median per card + grading + finish.

-- ── 1. cards identity columns ───────────────────────────────────────────────

alter table public.cards
  add column if not exists catalog_product_id integer,            -- tcgcsv_products.product_id (Pokémon EN/JP, One Piece)
  add column if not exists catalog_soccer_id  integer,            -- soccer_cards.id (Soccer catalog)
  add column if not exists card_number        text,               -- "199/197", "OP15-118", "TG12/TG30"
  add column if not exists language           text,               -- 'en' | 'jp' | null
  add column if not exists grading_company    text default 'raw', -- 'raw'|'psa'|'bgs'|'cgc'|'sgc'
  add column if not exists grade              numeric,            -- 1..10 (0.5 steps), null if raw
  add column if not exists finish             text;               -- 'normal'|'holo'|'reverse'|'1st'|'parallel'

create index if not exists idx_cards_catalog on public.cards (catalog_product_id);
create index if not exists idx_cards_catalog_soccer on public.cards (catalog_soccer_id);

-- ── 2. vn_card_sales — source of truth for VN market price ─────────────────
-- Only completed (delivered + buyer-confirmed) orders are recorded, so asking
-- prices on open listings can never skew the market price.

create table if not exists public.vn_card_sales (
  id                 uuid primary key default gen_random_uuid(),
  catalog_product_id integer,                    -- tcgcsv key (Pokémon/One Piece)
  catalog_soccer_id  integer,                    -- soccer_cards key (Soccer)
  card_id            uuid,                       -- source listing (cards.id), reference only
  category_id        integer,                    -- 3 EN / 85 JP / 68 OP / 99 soccer
  card_number        text,
  language           text,
  grading_company    text not null default 'raw',
  grade              numeric,
  finish             text,
  price              numeric not null,           -- actual sale price (VND)
  sold_at            timestamptz not null default now(),
  constraint vn_card_sales_has_catalog_key
    check (catalog_product_id is not null or catalog_soccer_id is not null)
);

create index if not exists idx_vn_sales_lookup
  on public.vn_card_sales (catalog_product_id, grading_company, grade, finish, sold_at desc);
create index if not exists idx_vn_sales_soccer_lookup
  on public.vn_card_sales (catalog_soccer_id, grading_company, grade, finish, sold_at desc);

-- Writes happen server-side only (orders confirm flow); clients may read.
alter table public.vn_card_sales enable row level security;
grant select on table public.vn_card_sales to anon, authenticated;

drop policy if exists "Anyone can read vn card sales" on public.vn_card_sales;
create policy "Anyone can read vn card sales"
  on public.vn_card_sales for select
  using (true);

-- ── 3. vn_market_price — 90-day aggregate per card/grading/finish ───────────
-- Median resists outliers better than average.

create or replace view public.vn_market_price as
select
  catalog_product_id,
  catalog_soccer_id,
  grading_company,
  grade,
  finish,
  count(*)                                            as sale_count,
  percentile_cont(0.5) within group (order by price)  as median_price,
  min(price)                                          as min_price,
  max(price)                                          as max_price,
  max(sold_at)                                        as last_sold_at
from public.vn_card_sales
where sold_at > now() - interval '90 days'
group by catalog_product_id, catalog_soccer_id, grading_company, grade, finish;

grant select on public.vn_market_price to anon, authenticated;

notify pgrst, 'reload schema';
