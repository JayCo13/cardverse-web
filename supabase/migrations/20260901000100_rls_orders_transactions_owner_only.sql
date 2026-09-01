-- Close two tables that were readable by anyone holding the anon key — which is
-- published in the browser bundle, so effectively by anyone at all.
--
-- Row-level security was never switched on for either. `orders` carried 36
-- columns including shipping_address, to_address_detail and to_phone: the
-- delivery address and phone number of every buyer. `transactions` carried the
-- buyer, the seller and the price of every trade.
--
-- Verified against the code before applying: `orders` is read only from server
-- routes, which use the service role and bypass RLS entirely. `transactions` is
-- read from three client pages, and all three already scope themselves to the
-- reader — /profile filters on buyer_id and seller_id, and /transaction/[id]
-- only redirects a party to their own trade. The policy below therefore matches
-- what the app already asks for; a non-party now gets no row where it
-- previously got the whole table.

alter table public.orders enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "Parties can view their orders" on public.orders;
create policy "Parties can view their orders"
  on public.orders for select
  to authenticated
  -- `(select auth.uid())` rather than a bare call: as a bare call Postgres
  -- re-evaluates it once per row scanned.
  using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()));

drop policy if exists "Parties can view their transactions" on public.transactions;
create policy "Parties can view their transactions"
  on public.transactions for select
  to authenticated
  using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()));

-- Writes stay with the service role. Every insert and update to these tables
-- goes through a route handler or an RPC, so no write policy is added: adding
-- one would grant a client something it does not currently do.
