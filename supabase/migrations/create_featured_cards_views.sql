-- Create materialized views for homepage featured cards
-- This eliminates loading delays by pre-caching top 20 cards for each category

-- Pokemon featured cards (top 20 by market price)
CREATE MATERIALIZED VIEW featured_pokemon_cards AS
SELECT 
  product_id,
  name,
  image_url,
  set_name,
  market_price,
  low_price
FROM tcgcsv_products
WHERE category_id = 3
  AND market_price IS NOT NULL
  AND market_price > 50
ORDER BY market_price DESC
LIMIT 20;

-- Soccer featured cards (top 20 most recent)
CREATE MATERIALIZED VIEW featured_soccer_cards AS
SELECT 
  id,
  name,
  image_url,
  price,
  category,
  year,
  grader,
  grade,
  ebay_id
FROM crawled_cards
WHERE category ILIKE '%soccer%'
  AND year IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;

-- One Piece featured cards (top 20 by market price)
CREATE MATERIALIZED VIEW featured_onepiece_cards AS
SELECT 
  product_id,
  name,
  image_url,
  set_name,
  market_price,
  low_price
FROM tcgcsv_products
WHERE category_id = 68
  AND market_price IS NOT NULL
  AND market_price > 5
ORDER BY market_price DESC
LIMIT 20;

-- Create indexes for faster access (optional but recommended)
CREATE UNIQUE INDEX idx_featured_pokemon ON featured_pokemon_cards(product_id);
CREATE UNIQUE INDEX idx_featured_soccer ON featured_soccer_cards(id);
CREATE UNIQUE INDEX idx_featured_onepiece ON featured_onepiece_cards(product_id);

-- To refresh the views (run manually or via cron):
-- REFRESH MATERIALIZED VIEW CONCURRENTLY featured_pokemon_cards;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY featured_soccer_cards;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY featured_onepiece_cards;
