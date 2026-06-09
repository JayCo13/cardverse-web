-- ROOT CAUSE of inaccurate Pokémon scan results:
-- tcgcsv_products has NO usable index on `number`, so EVERY number lookup the
-- scanner does (even an exact `number = '123/106'`, and any ILIKE collector
-- search) seq-scans and hits the statement timeout. The correct card therefore
-- never enters the candidate pool — only the price-ordered name search returns,
-- which is why results are wrong / the right card is missing from the top 15.
--
-- Run this ONCE in the Supabase SQL editor (or `supabase db push`).

create extension if not exists pg_trgm;

-- Fast exact (=) and case-sensitive prefix (LIKE 'TG12/%') lookups by number,
-- scoped to a category. text_pattern_ops also serves equality.
create index if not exists idx_tcgcsv_cat_number
    on tcgcsv_products (category_id, number text_pattern_ops);

-- Fast case-insensitive ILIKE (any case / substring) on number — the
-- format-agnostic collector-token search ("tg12/*", "120/*", "sm103*").
create index if not exists idx_tcgcsv_number_trgm
    on tcgcsv_products using gin (number gin_trgm_ops);

-- Fast ILIKE on name (the "*name*" candidate searches).
create index if not exists idx_tcgcsv_name_trgm
    on tcgcsv_products using gin (name gin_trgm_ops);

analyze tcgcsv_products;
