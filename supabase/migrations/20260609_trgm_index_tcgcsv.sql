-- Speed up the card-scan matching, which does ILIKE on `number` (collector-token
-- search like "TG12/%", "120/%") and on `name`. Without a trigram index these
-- ILIKE/LIKE queries seq-scan the large English Pokémon catalog and hit the
-- statement timeout, so the correct card never enters the candidate pool.
--
-- pg_trgm GIN indexes make ILIKE (any case, prefix or substring) index-accelerated.
-- Run this once in the Supabase SQL editor.

create extension if not exists pg_trgm;

-- number ILIKE (collector-token / format-agnostic matching)
create index if not exists idx_tcgcsv_number_trgm
    on tcgcsv_products using gin (number gin_trgm_ops);

-- name ILIKE (the "*name*" candidate searches)
create index if not exists idx_tcgcsv_name_trgm
    on tcgcsv_products using gin (name gin_trgm_ops);

analyze tcgcsv_products;
