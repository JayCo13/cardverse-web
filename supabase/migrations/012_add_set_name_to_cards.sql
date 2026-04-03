-- Add set_name column to cards table for standardized set tracking
ALTER TABLE cards ADD COLUMN IF NOT EXISTS set_name text;

-- Add comment for documentation
COMMENT ON COLUMN cards.set_name IS 'Standardized set name from card-catalog.ts (e.g. "Prismatic Evolutions", "OP-01 Romance Dawn")';
