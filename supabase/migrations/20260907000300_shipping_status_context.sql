-- Give `shipping_update` notifications the one fact they were missing: which
-- carrier state the parcel actually reached.
--
-- The producers already know it and the client already had a slot for it, but
-- the snapshot only recorded 'Delivered'. Every other movement therefore
-- reached the bell as "the shipping status changed" with no way to say what it
-- changed to — two lines of panel spent on strictly less information than the
-- row already held. Additive: only the trigger changes, no historical rewrite,
-- and rows whose status is unmapped keep the old generic wording.

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
    elsif new.type = 'shipping_update' then
      -- Snapshot WHICH way the parcel moved, not merely that it moved. Two
      -- producers write two vocabularies: `carrier_status` comes from 17TRACK
      -- (apply_carrier_tracking_event), `ghn_status` from the legacy GHN RPC.
      -- Normalise both to one set of keys the client can title a notification
      -- with; an unmapped status stays null and the client falls back to the
      -- generic "shipping update" wording.
      context := context || jsonb_build_object('shipping_status',
        case coalesce(entity ->> 'carrier_status', entity ->> 'ghn_status')
          when 'InfoReceived' then 'info_received'
          when 'InTransit' then 'in_transit'
          when 'OutForDelivery' then 'out_for_delivery'
          when 'AvailableForPickup' then 'available_for_pickup'
          when 'DeliveryFailure' then 'failed'
          when 'Exception' then 'exception'
          when 'Delivered' then 'delivered'
          when 'picking' then 'picking'
          when 'picked' then 'picked'
          when 'delivering' then 'out_for_delivery'
          when 'delivery_fail' then 'failed'
          when 'delivered' then 'delivered'
          else null end);
      if coalesce(entity ->> 'carrier_status', entity ->> 'ghn_status') in ('Delivered', 'delivered') then
        context := context || jsonb_build_object('event', 'delivered');
      end if;
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

notify pgrst, 'reload schema';
