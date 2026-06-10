-- Restore the marketplace `transactions` table.
--
-- It is defined in 001_initial_schema.sql but that schema was never fully
-- applied to every environment (the same reason 20260607_restore_cards_table /
-- 20260607_restore_orders_table exist). Without it the offer-accept flow and the
-- /transaction/[id] room fail with "relation public.transactions does not exist".
--
-- Idempotent: safe to run repeatedly. No RLS is enabled, matching the original
-- schema (access is via the default anon/authenticated grants + app logic).

do $$
begin
  create table if not exists public.transactions (
    id uuid primary key default gen_random_uuid(),
    card_id uuid not null,
    seller_id uuid not null,
    buyer_id uuid not null,
    offer_id uuid,
    price bigint not null,
    status text default 'active'::text check (
      status = any (array['active'::text, 'completed'::text, 'cancelled'::text, 'auto_cancelled'::text])
    ),
    cancelled_by text check (
      cancelled_by = any (array['seller'::text, 'buyer'::text, 'system'::text])
    ),
    cancellation_reason text,
    expires_at timestamptz not null,
    completed_at timestamptz,
    cancelled_at timestamptz,
    created_at timestamptz default now()
  );

  if not exists (
    select 1 from pg_constraint where conname = 'transactions_card_id_fkey'
  ) and to_regclass('public.cards') is not null then
    alter table public.transactions
      add constraint transactions_card_id_fkey
      foreign key (card_id) references public.cards(id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'transactions_seller_id_fkey'
  ) and to_regclass('public.profiles') is not null then
    alter table public.transactions
      add constraint transactions_seller_id_fkey
      foreign key (seller_id) references public.profiles(id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'transactions_buyer_id_fkey'
  ) and to_regclass('public.profiles') is not null then
    alter table public.transactions
      add constraint transactions_buyer_id_fkey
      foreign key (buyer_id) references public.profiles(id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'transactions_offer_id_fkey'
  ) and to_regclass('public.offers') is not null then
    alter table public.transactions
      add constraint transactions_offer_id_fkey
      foreign key (offer_id) references public.offers(id);
  end if;

  create index if not exists idx_transactions_buyer_id on public.transactions(buyer_id);
  create index if not exists idx_transactions_seller_id on public.transactions(seller_id);
  create index if not exists idx_transactions_card_id on public.transactions(card_id);
  create index if not exists idx_transactions_offer_id on public.transactions(offer_id);
  create index if not exists idx_transactions_status on public.transactions(status);
end $$;

notify pgrst, 'reload schema';
