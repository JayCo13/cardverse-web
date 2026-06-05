-- Speed up the catalog browse/pagination on tcgcsv_products.
--
-- The Pokémon/One Piece list pages query:
--   where category_id = ? and market_price > 0  order by market_price desc
--   (+ exact count + range pagination), and optionally filter by set_name.
-- Without a composite index this scans the whole category every page +
-- count. These btree indexes make the pre-filter, sort, count and range
-- all index-driven. They are small (catalog ~60k rows) and cheap on Micro.

create index if not exists idx_tcgcsv_products_cat_market
    on tcgcsv_products (category_id, market_price desc);

create index if not exists idx_tcgcsv_products_cat_set
    on tcgcsv_products (category_id, set_name);

analyze tcgcsv_products;
