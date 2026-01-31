-- Migration: Add price history table for TCGCSV
-- This table stores daily price snapshots for chart data

-- Create price history table
CREATE TABLE IF NOT EXISTS public.tcgcsv_price_history (
    id BIGSERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL,
    market_price NUMERIC(12,2),
    low_price NUMERIC(12,2),
    mid_price NUMERIC(12,2),
    high_price NUMERIC(12,2),
    recorded_at DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure only one price record per product per day
    CONSTRAINT unique_product_daily_price UNIQUE (product_id, recorded_at)
);

-- Index for efficient queries by product and date range
CREATE INDEX IF NOT EXISTS idx_price_history_product_date 
    ON public.tcgcsv_price_history(product_id, recorded_at DESC);

-- Index for querying recent prices across all products
CREATE INDEX IF NOT EXISTS idx_price_history_recorded_at 
    ON public.tcgcsv_price_history(recorded_at DESC);

-- Add foreign key (optional, comment out if products may be deleted)
-- ALTER TABLE public.tcgcsv_price_history 
--     ADD CONSTRAINT fk_price_history_product 
--     FOREIGN KEY (product_id) REFERENCES public.tcgcsv_products(product_id) ON DELETE CASCADE;

-- Enable RLS
ALTER TABLE public.tcgcsv_price_history ENABLE ROW LEVEL SECURITY;

-- Allow public read access for charts
CREATE POLICY "Allow public read of price history"
    ON public.tcgcsv_price_history
    FOR SELECT
    TO public
    USING (true);

-- Allow service role to insert/update
CREATE POLICY "Allow service role to manage price history"
    ON public.tcgcsv_price_history
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
