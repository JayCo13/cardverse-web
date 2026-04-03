-- Shipping Schema Migration
-- Adds address columns to profiles and GHN shipping columns to orders

-- ============================================
-- ADD SELLER ADDRESS TO PROFILES
-- ============================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS address_province_id INTEGER,
  ADD COLUMN IF NOT EXISTS address_province_name TEXT,
  ADD COLUMN IF NOT EXISTS address_district_id INTEGER,
  ADD COLUMN IF NOT EXISTS address_district_name TEXT,
  ADD COLUMN IF NOT EXISTS address_ward_code TEXT,
  ADD COLUMN IF NOT EXISTS address_ward_name TEXT,
  ADD COLUMN IF NOT EXISTS address_detail TEXT,
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- ============================================
-- ADD GHN & SHIPPING COLUMNS TO ORDERS
-- ============================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_fee INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ghn_order_code TEXT,
  ADD COLUMN IF NOT EXISTS ghn_shipping_fee INTEGER,
  ADD COLUMN IF NOT EXISTS ghn_expected_delivery TEXT,
  ADD COLUMN IF NOT EXISTS ghn_status TEXT,
  ADD COLUMN IF NOT EXISTS to_province_id INTEGER,
  ADD COLUMN IF NOT EXISTS to_province_name TEXT,
  ADD COLUMN IF NOT EXISTS to_district_id INTEGER,
  ADD COLUMN IF NOT EXISTS to_district_name TEXT,
  ADD COLUMN IF NOT EXISTS to_ward_code TEXT,
  ADD COLUMN IF NOT EXISTS to_ward_name TEXT,
  ADD COLUMN IF NOT EXISTS to_address_detail TEXT,
  ADD COLUMN IF NOT EXISTS to_name TEXT,
  ADD COLUMN IF NOT EXISTS to_phone TEXT;
