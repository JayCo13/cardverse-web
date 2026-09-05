-- Let the unboxing video actually be recorded.
--
-- 20260905000100 added `submit_unboxing_video` as a fourth marketplace order
-- action: `perform_marketplace_order_action` accepts it, and like every other
-- action it writes an idempotency row into `marketplace_order_action_requests`
-- before doing any work.
--
-- What it did not do is widen that table's own check constraint, which has
-- listed exactly three actions since 20260808000100. So the buyer uploaded the
-- video to Cloudinary, the route called the RPC, and the very first statement
-- inside it failed:
--
--   new row for relation "marketplace_order_action_requests"
--   violates check constraint "marketplace_order_action_requests_action_check"
--
-- The transaction rolls back whole, so nothing was half-written — the evidence
-- rule simply had no way to accept a buyer's side of it. The constraint is the
-- only thing that was wrong; the function, the route and the page are correct.
--
-- Named explicitly rather than left to the `_action_check` Postgres would
-- generate, so the name in the error message above is the name that exists.
alter table public.marketplace_order_action_requests
  drop constraint if exists marketplace_order_action_requests_action_check;
alter table public.marketplace_order_action_requests
  add constraint marketplace_order_action_requests_action_check
  check (action in ('ship', 'confirm_received', 'open_dispute', 'submit_unboxing_video'));
