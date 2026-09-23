-- Catalog SEO reads by category/product ID (pilot sitemap) and group/product ID
-- (set pages). Existing category/price and category/set indexes do not serve
-- these ordered lookups; anon queries otherwise hit statement_timeout.
create index if not exists idx_tcgcsv_category_product_id
  on public.tcgcsv_products (category_id, product_id);

create index if not exists idx_tcgcsv_group_product_id
  on public.tcgcsv_products (group_id, product_id);

analyze public.tcgcsv_products;
