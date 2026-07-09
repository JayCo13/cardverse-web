-- 24h ship deadline + seller reputation (% success model).
--   reputation = successful orders / (successful + faults) * 100
--   New seller (0 successful, 0 fault) → displayed as "Người bán mới".
--   A paid order not shipped within 24h auto-cancels (refund) and adds 1 fault.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS ship_deadline timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS seller_fault_count integer NOT NULL DEFAULT 0;

-- Speeds up the expiry sweep.
CREATE INDEX IF NOT EXISTS orders_ship_deadline_idx
  ON public.orders (status, ship_deadline)
  WHERE status = 'paid';

-- Bump success/fault counters and recompute the rating atomically. Positive
-- p_success on a completed order; positive p_fault on a 24h auto-cancel.
CREATE OR REPLACE FUNCTION public.update_seller_reputation(
  p_seller_id uuid,
  p_success integer,
  p_fault integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review integer;
  v_fault integer;
  v_total integer;
BEGIN
  UPDATE public.profiles
     SET seller_review_count = GREATEST(0, COALESCE(seller_review_count, 0) + COALESCE(p_success, 0)),
         seller_fault_count  = GREATEST(0, COALESCE(seller_fault_count, 0) + COALESCE(p_fault, 0)),
         updated_at = now()
   WHERE id = p_seller_id
  RETURNING seller_review_count, seller_fault_count INTO v_review, v_fault;

  v_total := COALESCE(v_review, 0) + COALESCE(v_fault, 0);

  UPDATE public.profiles
     SET seller_rating = CASE WHEN v_total > 0
                              THEN ROUND((v_review::numeric / v_total) * 100, 1)
                              ELSE 0 END
   WHERE id = p_seller_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_seller_reputation(uuid, integer, integer) TO authenticated, service_role;

COMMENT ON COLUMN public.orders.ship_deadline IS 'Deadline for the seller to upload tracking; past this a paid order auto-cancels + refunds.';
COMMENT ON COLUMN public.profiles.seller_fault_count IS 'Count of seller faults (e.g. 24h ship timeouts); lowers the % reputation.';
