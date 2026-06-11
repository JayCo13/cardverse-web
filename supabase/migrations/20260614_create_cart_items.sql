create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, card_id)
);

create index if not exists idx_cart_items_user_id on public.cart_items(user_id);
create index if not exists idx_cart_items_card_id on public.cart_items(card_id);

alter table public.cart_items enable row level security;

grant select, insert, update, delete on table public.cart_items to authenticated;

drop policy if exists "Users can manage own cart" on public.cart_items;
create policy "Users can manage own cart"
  on public.cart_items
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
