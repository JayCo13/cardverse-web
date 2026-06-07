do $$
begin
  create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    card_id uuid not null,
    seller_id uuid not null,
    buyer_id uuid not null,
    offer_id uuid,
    amount bigint not null,
    platform_fee bigint not null default 0,
    total_paid bigint not null,
    payment_method text not null check (payment_method = any (array['wallet'::text, 'direct_payos'::text])),
    payment_order_id uuid,
    status text not null default 'pending_payment'::text check (
      status = any (
        array[
          'pending_payment'::text,
          'paid'::text,
          'shipping'::text,
          'delivered'::text,
          'completed'::text,
          'disputed'::text,
          'refunded'::text,
          'cancelled'::text
        ]
      )
    ),
    tracking_number text,
    shipping_provider text,
    shipping_address text,
    shipping_fee integer default 0,
    ghn_order_code text,
    ghn_shipping_fee integer,
    ghn_expected_delivery text,
    ghn_status text,
    to_province_id integer,
    to_province_name text,
    to_district_id integer,
    to_district_name text,
    to_ward_code text,
    to_ward_name text,
    to_address_detail text,
    to_name text,
    to_phone text,
    buyer_confirmed_at timestamptz,
    auto_complete_at timestamptz,
    dispute_reason text,
    dispute_evidence_url text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_card_id_fkey'
  ) and to_regclass('public.cards') is not null then
    alter table public.orders
      add constraint orders_card_id_fkey
      foreign key (card_id) references public.cards(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_seller_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_seller_id_fkey
      foreign key (seller_id) references public.profiles(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_buyer_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_buyer_id_fkey
      foreign key (buyer_id) references public.profiles(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_offer_id_fkey'
  ) and to_regclass('public.offers') is not null then
    alter table public.orders
      add constraint orders_offer_id_fkey
      foreign key (offer_id) references public.offers(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_payment_order_id_fkey'
  ) and to_regclass('public.payment_orders') is not null then
    alter table public.orders
      add constraint orders_payment_order_id_fkey
      foreign key (payment_order_id) references public.payment_orders(id);
  end if;

  create index if not exists idx_orders_buyer_id on public.orders(buyer_id);
  create index if not exists idx_orders_seller_id on public.orders(seller_id);
  create index if not exists idx_orders_card_id on public.orders(card_id);
  create index if not exists idx_orders_status on public.orders(status);
end $$;
