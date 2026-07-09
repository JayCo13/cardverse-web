-- Per-order metadata (jsonb): stores the buyer's bundle selection (which cards
-- of a multi-card listing were purchased) and the chosen shipping carrier.
--   { "bundle_selection": [{ "title": "...", "price": 15000 }], "shipping_carrier": "ghn" }
-- The PayOS webhook reads bundle_selection to finalize partial-bundle inventory.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.orders.metadata IS
  'Order metadata: bundle_selection (purchased cards) + shipping_carrier chosen by the buyer.';
