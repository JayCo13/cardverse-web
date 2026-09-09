-- Which GoShip account booked this shipment.
--
-- Sandbox and live are separate installations that issue codes of the same
-- shape (GS + eight characters) and push to the same public webhook address.
-- Nothing in a code says where it came from, so a rehearsal in sandbox could
-- otherwise land on a real order and walk it to delivered — which releases the
-- seller's money.
--
-- Null on every order booked before this column existed. Those are all live,
-- but they are left null rather than backfilled: an event carrying no
-- environment is accepted against them, so old orders keep working, while any
-- order booked from here on records its origin and only answers to it.
alter table public.orders
  add column if not exists goship_env text
  check (goship_env is null or goship_env in ('sandbox', 'live'));

comment on column public.orders.goship_env is
  'Which GoShip account created the shipment. Events from the other one are ignored.';
