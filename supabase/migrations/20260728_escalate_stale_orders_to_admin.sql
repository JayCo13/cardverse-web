-- POLICY CHANGE: stop auto-paying the seller when the buyer goes silent.
-- A late/lost parcel could pay the seller for goods the buyer never received.
-- Instead, a stale order (past its auto_complete_at, buyer never confirmed) is
-- ESCALATED to admin review (status='disputed'); the money stays held in escrow
-- until an admin checks the carrier status and releases to seller or refunds.
--
-- We redefine complete_delivered_orders() (keeping the name so the existing
-- pg_cron schedule now escalates instead of paying) to do the escalation.

-- The escalation sweep now scans 'shipping' too (manual fulfilment), so widen
-- the supporting index beyond the old delivered-only one.
CREATE INDEX IF NOT EXISTS idx_orders_stale_escalation
  ON public.orders (auto_complete_at)
  WHERE status IN ('shipping', 'delivered') AND auto_complete_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.complete_delivered_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o record;
  done integer := 0;
BEGIN
  FOR o IN
    SELECT id, buyer_id, seller_id, card_id
    FROM public.orders
    WHERE status IN ('shipping', 'delivered')
      AND auto_complete_at IS NOT NULL
      AND auto_complete_at < now()
      AND buyer_confirmed_at IS NULL
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Idempotent status guard.
    UPDATE public.orders
    SET status = 'disputed',
        dispute_reason = COALESCE(
          dispute_reason,
          'Tự động: người mua chưa xác nhận nhận hàng quá hạn — chờ quản trị viên kiểm tra trạng thái giao hàng.'
        ),
        updated_at = now()
    WHERE id = o.id AND status IN ('shipping', 'delivered');
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, card_id, order_id, read)
    VALUES
      (o.buyer_id, 'order_disputed', 'Đơn hàng đang được kiểm tra',
       'Bạn chưa xác nhận nhận hàng nên đơn đã được chuyển cho quản trị viên kiểm tra trạng thái giao hàng. Tiền của bạn vẫn được giữ an toàn.',
       o.card_id, o.id, false),
      (o.seller_id, 'order_disputed', 'Đơn hàng đang được kiểm tra',
       'Người mua chưa xác nhận nhận hàng. Quản trị viên sẽ kiểm tra trạng thái giao hàng trước khi xử lý thanh toán.',
       o.card_id, o.id, false);

    done := done + 1;
  END LOOP;

  RETURN done;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_delivered_orders() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
