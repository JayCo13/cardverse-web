-- Device-level scan tracking for anonymous users
-- Uses browser fingerprint as device_id to persist across incognito sessions

CREATE TABLE IF NOT EXISTS device_scan_usage (
    device_id TEXT PRIMARY KEY,
    scan_count INTEGER NOT NULL DEFAULT 0,
    last_reset_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_device_scan_usage_date ON device_scan_usage (last_reset_date);

-- Enable RLS
ALTER TABLE device_scan_usage ENABLE ROW LEVEL SECURITY;

-- Allow anonymous access (anon key) for read/write
-- This is safe because device_id is a hash — no sensitive data
CREATE POLICY "Allow anonymous device scan tracking"
    ON device_scan_usage
    FOR ALL
    USING (true)
    WITH CHECK (true);
