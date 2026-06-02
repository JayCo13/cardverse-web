-- Create public.payment_orders — it was referenced by orders.payment_order_id
-- (010_marketplace_schema.sql) and used by all /api/payos/* routes, but was
-- never actually defined in a migration. Its absence in prod caused
-- /api/payos/create-payment to fail with "Failed to create order".
--
-- Columns/values are taken from the code that reads & writes this table:
--   create-payment: inserts user_id, order_code, package_type, amount, status;
--                   updates payos_payment_link_id, payos_checkout_url
--   webhook:        updates status -> paid/cancelled/fraud_suspected, paid_at;
--                   looks up by order_code (.single() -> needs unique)
-- id is uuid so the existing orders.payment_order_id FK resolves.

create table if not exists public.payment_orders (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  order_code            bigint not null unique,
  package_type          text not null check (package_type in ('day_pass','credit_pack','vip_pro')),
  amount                bigint not null,
  status                text not null default 'pending'
                          check (status in ('pending','paid','cancelled','fraud_suspected')),
  payos_payment_link_id text,
  payos_checkout_url    text,
  paid_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists payment_orders_user_id_idx    on public.payment_orders(user_id);
create index if not exists payment_orders_order_code_idx on public.payment_orders(order_code);

alter table public.payment_orders enable row level security;

-- The logged-in user manages their own orders (create-payment runs as the user).
-- The PayOS webhook uses the service-role key, which bypasses RLS.
create policy "own payment orders - select"
  on public.payment_orders for select to authenticated
  using (auth.uid() = user_id);

create policy "own payment orders - insert"
  on public.payment_orders for insert to authenticated
  with check (auth.uid() = user_id);

create policy "own payment orders - update"
  on public.payment_orders for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
