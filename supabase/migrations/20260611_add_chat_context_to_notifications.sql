-- Add chat/transaction context to notifications so the client can route a
-- notification click straight to the right conversation or transaction room
-- instead of always falling back to the card detail page.
--
-- NOTE: written defensively. In some environments the `transactions` table has
-- not been created yet (see the 20260607_restore_* migrations for the same
-- situation with cards/orders), so the foreign keys are only added when their
-- target table actually exists. The columns themselves are always added.

alter table public.notifications
  add column if not exists conversation_id uuid,
  add column if not exists transaction_id uuid;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'conversations'
  ) and not exists (
    select 1 from information_schema.table_constraints
    where constraint_schema = 'public' and constraint_name = 'notifications_conversation_id_fkey'
  ) then
    alter table public.notifications
      add constraint notifications_conversation_id_fkey
      foreign key (conversation_id) references public.conversations(id) on delete set null;
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'transactions'
  ) and not exists (
    select 1 from information_schema.table_constraints
    where constraint_schema = 'public' and constraint_name = 'notifications_transaction_id_fkey'
  ) then
    alter table public.notifications
      add constraint notifications_transaction_id_fkey
      foreign key (transaction_id) references public.transactions(id) on delete set null;
  end if;
end$$;

create index if not exists notifications_conversation_idx on public.notifications(conversation_id);
create index if not exists notifications_transaction_idx on public.notifications(transaction_id);

notify pgrst, 'reload schema';
