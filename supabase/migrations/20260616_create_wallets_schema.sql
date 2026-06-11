-- Wallets schema: align the live tables with the app and lock them down.
--
-- The wallets / wallet_transactions tables were created ad hoc (new users get a
-- wallet row via the handle_new_user_wallet trigger) and were never captured in
-- a migration. The live wallets table stores the balance in a column named
-- `balance`, but ALL application code uses `available_balance` — and the table
-- has NO RLS, so any authenticated user could rewrite their own balance through
-- PostgREST.
--
-- This migration is idempotent and self-healing against the live shape:
--   1. Renames wallets.balance -> available_balance (preserves existing money),
--      and backfills the columns the code expects (total_deposited/withdrawn).
--   2. Ensures wallet_transactions has every column the code writes.
--   3. Enables RLS: owners may SELECT their own rows; there are deliberately NO
--      write policies — all money mutations go through the service-role client
--      or SECURITY DEFINER functions.

-- 1. wallets: reconcile columns ------------------------------------------------
do $$
begin
  -- Fresh install (no existing table).
  create table if not exists public.wallets (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null unique,
    available_balance bigint not null default 0,
    total_deposited bigint not null default 0,
    total_withdrawn bigint not null default 0,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );

  -- Legacy table stores the balance as `balance` — rename it to the name the
  -- app uses, preserving every existing balance. Only when `available_balance`
  -- is genuinely absent so we never collide with a fresh install.
  if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'wallets' and column_name = 'balance'
      )
     and not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'wallets' and column_name = 'available_balance'
      )
  then
    alter table public.wallets rename column balance to available_balance;
  end if;
end $$;

-- Backfill any still-missing columns (no-ops where they already exist). Defaults
-- mean existing rows are filled safely.
alter table public.wallets add column if not exists available_balance bigint not null default 0;
alter table public.wallets add column if not exists total_deposited   bigint not null default 0;
alter table public.wallets add column if not exists total_withdrawn   bigint not null default 0;
alter table public.wallets add column if not exists created_at timestamptz default now();
alter table public.wallets add column if not exists updated_at timestamptz default now();

-- 2. wallet_transactions: ensure every column the code writes exists -----------
do $$
begin
  create table if not exists public.wallet_transactions (
    id uuid primary key default gen_random_uuid(),
    wallet_id uuid not null,
    user_id uuid not null,
    type text not null,
    amount bigint not null,
    balance_after bigint not null,
    description text,
    reference_id text,  -- mixed: card uuid / order uuid / PayOS orderCode string
    created_at timestamptz default now()
  );
end $$;

-- Added as nullable so the migration can't fail on pre-existing rows; the app
-- always supplies these values on insert.
alter table public.wallet_transactions add column if not exists wallet_id uuid;
alter table public.wallet_transactions add column if not exists user_id uuid;
alter table public.wallet_transactions add column if not exists type text;
alter table public.wallet_transactions add column if not exists amount bigint;
alter table public.wallet_transactions add column if not exists balance_after bigint;
alter table public.wallet_transactions add column if not exists description text;
alter table public.wallet_transactions add column if not exists reference_id text;
alter table public.wallet_transactions add column if not exists created_at timestamptz default now();

create index if not exists idx_wallet_transactions_user_created
  on public.wallet_transactions(user_id, created_at desc);

-- 3. Foreign keys (NOT VALID so legacy rows are never re-checked) --------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wallets_user_id_fkey')
     and to_regclass('public.profiles') is not null then
    alter table public.wallets
      add constraint wallets_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'wallet_transactions_wallet_id_fkey') then
    alter table public.wallet_transactions
      add constraint wallet_transactions_wallet_id_fkey
      foreign key (wallet_id) references public.wallets(id) on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'wallet_transactions_user_id_fkey')
     and to_regclass('public.profiles') is not null then
    alter table public.wallet_transactions
      add constraint wallet_transactions_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade not valid;
  end if;
exception
  when others then null;  -- FK is best-effort; never block the lockdown below
end $$;

-- Defense in depth: a balance can never go negative. NOT VALID so adding the
-- constraint cannot fail on pre-existing rows; new writes are still checked.
do $$
begin
  alter table public.wallets
    add constraint wallets_balance_nonnegative check (available_balance >= 0) not valid;
exception
  when duplicate_object then null;
end $$;

-- 4. RLS lockdown --------------------------------------------------------------
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;

drop policy if exists "Users can view own wallet" on public.wallets;
create policy "Users can view own wallet"
  on public.wallets for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can view own wallet transactions" on public.wallet_transactions;
create policy "Users can view own wallet transactions"
  on public.wallet_transactions for select
  to authenticated
  using (auth.uid() = user_id);

-- Deliberately NO write policies: all wallet mutations must go through the
-- service-role client or SECURITY DEFINER functions (complete_delivered_orders,
-- refund_withdrawal, ...). RLS denies authenticated/anon writes by default.

notify pgrst, 'reload schema';
