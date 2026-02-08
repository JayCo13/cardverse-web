-- Migration: Update featured_soccer_cards to only show numbered/auto cards
-- Run this in Supabase SQL Editor

-- Drop the existing view
DROP MATERIALIZED VIEW IF EXISTS featured_soccer_cards;

-- Recreate with numbered/auto filter
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
  AND (
    -- Autograph cards
    name ILIKE '%auto%'
    OR name ILIKE '%autograph%'
    -- Numbered cards
    OR name ILIKE '%/99%'
    OR name ILIKE '%/75%'
    OR name ILIKE '%/50%'
    OR name ILIKE '%/25%'
    OR name ILIKE '%/10%'
    OR name ILIKE '%/5%'
    OR name ILIKE '%/1%'
    OR name ILIKE '%numbered%'
  )
ORDER BY created_at DESC
LIMIT 20;

-- Recreate the unique index
CREATE UNIQUE INDEX idx_featured_soccer ON featured_soccer_cards(id);

-- Refresh the view to apply changes
REFRESH MATERIALIZED VIEW featured_soccer_cards;
