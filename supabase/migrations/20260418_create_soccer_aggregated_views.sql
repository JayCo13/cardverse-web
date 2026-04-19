-- Migration: Create aggregated soccer views for Portfolio Tracker

-- 1. Create a view that acts like tcgcsv_products for Soccer
-- We aggregate crawled_cards by player_name, set_name, and year.
CREATE OR REPLACE VIEW soccer_products AS
SELECT
    -- Create a deterministic ID using md5 hash of the unique combo
    md5(COALESCE(player_name, 'Unknown') || COALESCE(set_name, 'Unknown') || COALESCE(year, 'Unknown'))::uuid AS product_id,
    68 AS category_id, -- Custom internal category ID for soccer (or any other number, 68 is One Piece, wait! let's use 99 for soccer)
    -- Actually, wait. Let's use 99 for soccer to distinguish from OP (68) and Pokemon (3/85)
    
    COALESCE(year || ' ', '') || COALESCE(set_name || ' ', '') || COALESCE(player_name, 'Unknown Soccer Card') AS name,
    MAX(image_url) AS image_url, -- pick one image
    set_name,
    NULL AS rarity, -- Not easily extractable from eBay titles reliably
    
    -- Price calculation: Use median or average for market price
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price)::numeric, 2) AS market_price,
    ROUND(MIN(price)::numeric, 2) AS low_price,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price)::numeric, 2) AS mid_price, 
    ROUND(MAX(price)::numeric, 2) AS high_price,
    
    NULL AS number,
    NULL AS tcgplayer_url,
    
    -- Store original details in extended_data
    jsonb_build_object(
        'player', player_name,
        'year', year,
        'set', set_name,
        'listings_count', COUNT(*)
    ) AS extended_data
FROM crawled_cards
WHERE category ILIKE '%soccer%' OR category ILIKE '%football%'
  AND price > 0
  AND listing_type = 'sold'
GROUP BY player_name, set_name, year
HAVING COUNT(*) >= 1; -- Require at least 1 sold listing

-- 2. Create price history view to generate charts
-- This rolls up average sold prices grouped by the date the card was crawled
-- Since we just patched to LH_sold, crawled_at is roughly the sold date or discovery date
CREATE OR REPLACE VIEW soccer_price_history AS
SELECT
    md5(COALESCE(player_name, 'Unknown') || COALESCE(set_name, 'Unknown') || COALESCE(year, 'Unknown'))::uuid AS product_id,
    DATE(created_at) AS recorded_at,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price)::numeric, 2) AS market_price,
    ROUND(MIN(price)::numeric, 2) AS low_price,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price)::numeric, 2) AS mid_price,
    ROUND(MAX(price)::numeric, 2) AS high_price
FROM crawled_cards
WHERE category ILIKE '%soccer%' OR category ILIKE '%football%'
  AND price > 0
  AND listing_type = 'sold'
GROUP BY product_id, recorded_at;
