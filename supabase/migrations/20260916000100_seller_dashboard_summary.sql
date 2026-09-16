-- Small, exact aggregates for /sell. The dashboard must not download every
-- order and listing merely to count them in the browser.
create index if not exists idx_orders_seller_recent
  on public.orders (seller_id, created_at desc, id desc);

create index if not exists idx_cards_seller_status_recent
  on public.cards (seller_id, status, created_at desc, id desc);

create index if not exists idx_cards_seller_recent
  on public.cards (seller_id, created_at desc, id desc);

create or replace function public.get_seller_dashboard_summary()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'orders', jsonb_build_object(
      'total', count(*),
      'waitingShip', count(*) filter (where o.status = 'paid'),
      'shipping', count(*) filter (where o.status in ('shipping', 'delivered')),
      'completed', count(*) filter (where o.status = 'completed'),
      'totalEarnings', coalesce(sum(o.amount - o.platform_fee) filter (where o.status = 'completed'), 0)
    ),
    'listings', (
      select jsonb_build_object(
        'active', count(*) filter (where c.status in ('active', 'in_transaction')),
        'sold', count(*) filter (where c.status = 'sold'),
        'draft', count(*) filter (where coalesce(c.status, '') not in ('active', 'in_transaction', 'sold')),
        'total', count(*)
      )
      from public.cards c
      where c.seller_id = auth.uid()
    )
  )
  from public.orders o
  where o.seller_id = auth.uid();
$$;

revoke all on function public.get_seller_dashboard_summary() from public, anon;
grant execute on function public.get_seller_dashboard_summary() to authenticated;
