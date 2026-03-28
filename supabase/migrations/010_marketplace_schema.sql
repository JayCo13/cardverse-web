-- Marketplace Schema Migration
-- Tables: seller_verifications, orders, seller_reviews
-- Columns added to profiles: seller_verified, seller_rating, seller_review_count

-- ============================================
-- SELLER VERIFICATIONS TABLE (KYC)
-- ============================================
CREATE TABLE IF NOT EXISTS public.seller_verifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  full_name text NOT NULL,
  id_card_front_url text NOT NULL,
  id_card_back_url text NOT NULL,
  selfie_url text NOT NULL,
  bank_name text NOT NULL,
  bank_account_number text NOT NULL,
  bank_account_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  rejection_reason text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT seller_verifications_pkey PRIMARY KEY (id),
  CONSTRAINT seller_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT seller_verifications_user_id_unique UNIQUE (user_id)
);

ALTER TABLE public.seller_verifications ENABLE ROW LEVEL SECURITY;

-- ============================================
-- ORDERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  offer_id uuid,
  amount bigint NOT NULL,
  platform_fee bigint NOT NULL DEFAULT 0,
  total_paid bigint NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('wallet', 'direct_payos')),
  payment_order_id uuid,
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
    'pending_payment', 'paid', 'shipping', 'delivered', 'completed',
    'disputed', 'refunded', 'cancelled'
  )),
  tracking_number text,
  shipping_provider text,
  shipping_address text,
  buyer_confirmed_at timestamp with time zone,
  auto_complete_at timestamp with time zone,
  dispute_reason text,
  dispute_evidence_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT orders_pkey PRIMARY KEY (id),
  CONSTRAINT orders_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id),
  CONSTRAINT orders_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.profiles(id),
  CONSTRAINT orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id),
  CONSTRAINT orders_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.offers(id),
  CONSTRAINT orders_payment_order_id_fkey FOREIGN KEY (payment_order_id) REFERENCES public.payment_orders(id)
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- ============================================
-- SELLER REVIEWS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.seller_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT seller_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT seller_reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE,
  CONSTRAINT seller_reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.profiles(id),
  CONSTRAINT seller_reviews_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.profiles(id),
  CONSTRAINT seller_reviews_order_unique UNIQUE (order_id)
);

ALTER TABLE public.seller_reviews ENABLE ROW LEVEL SECURITY;

-- ============================================
-- ADD SELLER COLUMNS TO PROFILES
-- ============================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS seller_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS seller_rating numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seller_review_count integer DEFAULT 0;
