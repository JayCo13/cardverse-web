do $$
begin
  create table if not exists public.cards (
    id uuid primary key default uuid_generate_v4(),
    name text not null,
    image_url text,
    image_urls text[],
    category text not null,
    condition text,
    listing_type text not null check (listing_type = any (array['sale'::text, 'auction'::text, 'razz'::text])),
    price bigint,
    current_bid bigint,
    starting_bid bigint,
    auction_ends timestamptz,
    ticket_price bigint,
    razz_entries integer,
    total_tickets integer,
    seller_id uuid not null,
    description text,
    last_sold_price bigint,
    status text default 'active'::text check (status = any (array['active'::text, 'sold'::text, 'expired'::text, 'in_transaction'::text])),
    publisher text,
    season text,
    quantity integer not null default 1,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );

  alter table public.cards
    add column if not exists set_name text,
    add column if not exists accept_offers boolean not null default false,
    add column if not exists min_offer_percent integer not null default 0,
    add column if not exists is_bundle boolean not null default false,
    add column if not exists bundle_items jsonb;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'cards_seller_id_fkey'
  ) then
    alter table public.cards
      add constraint cards_seller_id_fkey
      foreign key (seller_id) references public.profiles(id);
  end if;

  create index if not exists idx_cards_seller_id on public.cards(seller_id);
  create index if not exists idx_cards_status on public.cards(status);
  create index if not exists idx_cards_listing_type on public.cards(listing_type);
end $$;
