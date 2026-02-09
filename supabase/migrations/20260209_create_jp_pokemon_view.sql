-- Create materialized view for Japanese Pokemon cards
-- This eliminates loading delays by pre-caching cards for PSA crawling

-- Japanese Pokemon featured cards (top 500 by market price for PSA crawling)
CREATE MATERIALIZED VIEW IF NOT EXISTS featured_pokemon_cards_jp AS
SELECT 
  product_id,
  name,
  image_url,
  set_name,
  number,
  market_price,
  low_price
FROM tcgcsv_products
WHERE category_id = 85  -- Japanese Pokemon category
  AND market_price IS NOT NULL
  AND market_price > 20
ORDER BY market_price DESC
LIMIT 500;

-- Create index for faster access
CREATE UNIQUE INDEX IF NOT EXISTS idx_featured_pokemon_jp ON featured_pokemon_cards_jp(product_id);

-- To refresh the view (run manually or via cron):
-- REFRESH MATERIALIZED VIEW CONCURRENTLY featured_pokemon_cards_jp;
