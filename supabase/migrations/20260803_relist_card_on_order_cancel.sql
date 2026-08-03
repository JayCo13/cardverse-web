-- Single source of truth: whenever an order is cancelled — for ANY reason
-- (buyer/seller cancel, PayOS expiry, 24h no-ship auto-cancel, admin refund of a
-- disputed order) — the card must return to the marketplace. A DB trigger
-- guarantees this invariant regardless of which code path did the cancel.
--
-- Bundle nuance: a bundle listing only has its purchased sub-cards removed once
-- the order is actually PAID. So we only add the sub-cards back when the order
-- was past 'pending_payment'; a pending bundle still has all its items intact.

-- Idempotent single-card relist safety net. Bundle sub-card re-adds are handled
-- explicitly in application code (which runs once per order), so the trigger
-- must NOT touch bundle_items — otherwise a bundle could be added back twice.
CREATE OR REPLACE FUNCTION public.relist_card_on_order_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.cards
  SET status = 'active',
      reserved_until = NULL,
      updated_at = now()
  WHERE id = new.card_id
    AND status IN ('sold', 'in_transaction');
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_relist_card_on_order_cancel ON public.orders;
CREATE TRIGGER trg_relist_card_on_order_cancel
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (new.status = 'cancelled' AND old.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.relist_card_on_order_cancel();

NOTIFY pgrst, 'reload schema';
