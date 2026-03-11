-- Migration: 005_scan_history.sql
-- Description: Create user_scan_history table to track individual scans over time

CREATE TABLE IF NOT EXISTS public.user_scan_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    scan_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add index on user_id and created_at for fast analytics queries
CREATE INDEX IF NOT EXISTS idx_user_scan_history_user_time ON public.user_scan_history (user_id, created_at);

-- Set Enable RLS
ALTER TABLE public.user_scan_history ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert their own scan history
CREATE POLICY "Users can insert their own scan logs."
    ON public.user_scan_history FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Allow authenticated users to view their own scan history
CREATE POLICY "Users can view their own scan logs."
    ON public.user_scan_history FOR SELECT
    USING (auth.uid() = user_id);
