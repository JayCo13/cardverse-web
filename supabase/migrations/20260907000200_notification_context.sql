-- Additive: older clients continue reading title/message. No historical rewrite.
alter table public.notifications add column if not exists metadata jsonb not null default '{}'::jsonb;

create or replace function public.snapshot_notification_context()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  entity jsonb;
  context jsonb := '{}'::jsonb;
  counterpart uuid;
  card uuid := new.card_id;
  name text;
  credited numeric;
begin
  if new.order_id is not null then
    select to_jsonb(o) into entity from public.orders o where o.id = new.order_id;
  elsif new.offer_id is not null then
    select to_jsonb(o) into entity from public.offers o where o.id = new.offer_id;
  elsif new.conversation_id is not null then
    select to_jsonb(c) into entity from public.conversations c where c.id = new.conversation_id;
  end if;
  if entity ->> 'buyer_id' = new.user_id::text then
    counterpart := (entity ->> 'seller_id')::uuid;
    context := context || jsonb_build_object('recipient_role', 'buyer');
  elsif entity ->> 'seller_id' = new.user_id::text then
    counterpart := (entity ->> 'buyer_id')::uuid;
    context := context || jsonb_build_object('recipient_role', 'seller');
  end if;
  if counterpart is not null then
    select display_name into name from public.profiles where id = counterpart;
    context := context || jsonb_build_object('counterparty_name', name);
    card := coalesce(card, (entity ->> 'card_id')::uuid);
    if new.type = 'order_shipped' then
      context := context || jsonb_build_object('tracking_number', entity ->> 'tracking_number',
        'shipping_provider', entity ->> 'shipping_provider');
    elsif new.type = 'shipping_update' and entity ->> 'carrier_status' = 'Delivered' then
      context := context || jsonb_build_object('event', 'delivered');
    elsif new.type in ('offer_received', 'offer_accepted') then
      context := context || jsonb_build_object('amount', entity -> 'price');
    end if;
    if new.type = 'order_completed' then
      context := context || jsonb_build_object('event', case
        when entity -> 'metadata' ->> 'auto_released_at' is not null then 'completed_auto'
        else 'completed_confirmed' end);
    elsif new.type = 'dispute_resolved' then
      context := context || jsonb_build_object('event', case entity ->> 'status'
        when 'refunded' then 'resolved_refund' when 'completed' then 'resolved_release' end);
    elsif new.type = 'order_disputed' then
      context := context || jsonb_build_object('reason', entity ->> 'dispute_reason');
    elsif new.type = 'order_cancelled' then
      context := context || jsonb_build_object('reason', entity ->> 'cancellation_reason');
    end if;
    if new.order_id is not null and new.type in ('order_refunded', 'order_completed', 'dispute_resolved') then
      select sum(w.amount) into credited from public.wallet_transactions w
      where w.user_id = new.user_id and w.reference_id = new.order_id::text
        and w.reference_type = 'marketplace_order' and w.affects_balance and w.amount > 0
        and w.type = case when entity ->> 'status' = 'refunded' or new.type = 'order_refunded'
          then 'refund' else 'marketplace_sale' end;
      if credited > 0 then
        context := context || jsonb_build_object('amount', credited, 'event', case
          when entity ->> 'status' = 'refunded' or new.type = 'order_refunded'
          then 'wallet_refund' else 'wallet_payout' end);
      end if;
    end if;
  end if;
  if card is not null then
    select c.name into name from public.cards c where c.id = card;
    context := context || jsonb_build_object('card_name', name);
  end if;
  if new.withdrawal_id is not null then
    select to_jsonb(w) into entity from public.wallet_withdrawals w
      where w.id = new.withdrawal_id and w.user_id = new.user_id;
    if entity is not null and new.type = 'withdrawal_rejected' then
      context := context || jsonb_build_object('reason', entity ->> 'rejection_reason');
    end if;
  end if;
  -- Explicit event facts from the producer take precedence. Never infer a
  -- refund or payout amount from the order total.
  new.metadata := jsonb_strip_nulls(context || coalesce(new.metadata, '{}'::jsonb)
    || jsonb_build_object('version', 1));
  return new;
end;
$$;
revoke all on function public.snapshot_notification_context() from public, anon, authenticated;
drop trigger if exists snapshot_notification_context on public.notifications;
create trigger snapshot_notification_context before insert on public.notifications
for each row execute function public.snapshot_notification_context();

-- Preserve the existing transfer receipt's exact net amount and link. Patch
-- only the known notification insert, without replacing settlement logic.
do $migration$
declare
  fn record;
  definition text;
  matched integer := 0;
  old_insert text := $old$insert into public.notifications (user_id, type, title, message, read)
    values (
      v_withdrawal.user_id,
      'withdrawal_completed',$old$;
  new_insert text := $new$insert into public.notifications (withdrawal_id, metadata, user_id, type, title, message, read)
    values (
      v_withdrawal.id,
      jsonb_build_object('version', 1, 'amount', v_attempt.amount_net),
      v_withdrawal.user_id,
      'withdrawal_completed',$new$;
begin
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.prosrc like '%v_attempt.amount_net%'
  loop
    definition := pg_get_functiondef(fn.oid);
    if position(old_insert in definition) > 0 then
      execute replace(definition, old_insert, new_insert);
      matched := matched + 1;
    elsif position(new_insert in definition) > 0 then
      matched := matched + 1;
    end if;
  end loop;
  if matched = 0 then
    raise exception 'Withdrawal notification producer has drifted; inspect before deployment';
  end if;
end;
$migration$;
