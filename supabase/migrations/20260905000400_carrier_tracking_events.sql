-- Delivery status from a multi-carrier tracking service.
--
-- Sellers book their own shipments, and every carrier webhook is scoped to the
-- account that booked the parcel, so no carrier can tell us a seller's parcel
-- arrived. An aggregator is the only source that reads across accounts. It also
-- replaces the per-carrier work entirely: one webhook covers every carrier it
-- supports, where GHN's own covers only parcels we booked ourselves.
--
-- `carrier_status` is deliberately separate from `ghn_status`. The latter means
-- "what GHN's own webhook said about a parcel on our GHN account" and is dead in
-- practice; this one means "what the tracking service says about this parcel,
-- whoever booked it". Keeping them apart means the older column can be retired
-- without touching this path.

alter table public.orders
  add column if not exists carrier_status text,
  add column if not exists carrier_sub_status text,
  add column if not exists carrier_status_at timestamptz;

create index if not exists orders_tracking_lookup_idx
  on public.orders (tracking_number, shipping_provider)
  where tracking_number is not null;

-- Apply one pushed tracking event.
--
-- Matched on the tracking number AND the carrier the seller declared, so a
-- number that happens to collide across two carriers cannot move the wrong
-- order. Idempotent: a repeated status is a no-op, and terminal orders are left
-- alone.
create or replace function public.apply_carrier_tracking_event(
  p_tracking_number text,
  p_shipping_provider text,
  p_status text,
  p_sub_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
begin
  perform public.assert_financial_mutations_enabled();
  if coalesce(length(trim(p_tracking_number)), 0) < 1
     or coalesce(length(trim(p_status)), 0) < 1
     or length(p_tracking_number) > 100 or length(p_status) > 64 then
    raise exception 'invalid_carrier_tracking_event';
  end if;

  select * into v_order
  from public.orders
  where tracking_number = trim(p_tracking_number)
    and (p_shipping_provider is null or shipping_provider = p_shipping_provider)
  order by created_at desc
  limit 1
  for update;
  if not found then
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'order_not_found');
  end if;
  if v_order.status in ('completed', 'cancelled', 'refunded', 'disputed') then
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'terminal_order');
  end if;
  if v_order.carrier_status = p_status then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  -- 'Delivered' is a one-way door. A later 'InTransit' on a delivered parcel is
  -- the service catching up on old events, not the parcel coming back.
  if v_order.carrier_status = 'Delivered' and p_status <> 'Delivered' then
    return jsonb_build_object('ok', true, 'ignored', true, 'reason', 'out_of_order');
  end if;

  update public.orders
  set carrier_status = p_status,
      carrier_sub_status = nullif(trim(coalesce(p_sub_status, '')), ''),
      carrier_status_at = now(),
      status = case when p_status = 'Delivered' and status = 'shipping'
        then 'delivered' else status end,
      -- Delivery starts the 72h confirmation window, which is also the window
      -- the buyer has to submit an unboxing video.
      auto_complete_at = case when p_status = 'Delivered' and status = 'shipping'
        then now() + interval '72 hours' else auto_complete_at end,
      updated_at = now()
  where id = v_order.id;

  if p_status = 'Delivered' and v_order.status = 'shipping' then
    insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
    values
      (v_order.buyer_id, 'shipping_update', 'Đơn hàng đã được giao',
       'Đơn đã giao thành công. Xác nhận đã nhận hàng để hoàn tất, hoặc báo cáo nếu có vấn đề.',
       v_order.card_id, v_order.id, false),
      (v_order.seller_id, 'shipping_update', 'Đơn hàng đã được giao',
       'Đơn đã giao tới người mua.', v_order.card_id, v_order.id, false);
  end if;

  return jsonb_build_object('ok', true, 'status', p_status, 'order_id', v_order.id);
end;
$$;

revoke execute on function public.apply_carrier_tracking_event(text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_carrier_tracking_event(text, text, text, text) to service_role;

-- Teach the verdict to read the new signal.
--
-- The nuance that matters: 'NotFound' means the tracking service has no data on
-- this parcel, which is not evidence that it failed to arrive. It has to fall
-- through to 'unverified' with everything else we cannot see, or a buyer would
-- be refunded on the strength of the aggregator simply not knowing.
create or replace function public.dispute_evidence_verdict(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with o as (
    select
      ord.*,
      -- Prefer the aggregator: it sees parcels whoever booked them. ghn_status
      -- only ever covered parcels on the platform's own GHN account.
      coalesce(ord.carrier_status, ord.ghn_status) as signal,
      case
        when ord.status in ('delivered', 'completed')
          or ord.buyer_confirmed_at is not null
          or ord.carrier_status = 'Delivered'
          or ord.ghn_status = 'delivered'
          then 'delivered'
        when coalesce(ord.carrier_status, ord.ghn_status) is null
          or ord.carrier_status = 'NotFound'
          then 'unverified'
        else 'not_delivered'
      end as delivery_state
    from public.orders ord
    where ord.id = p_order_id
  )
  select jsonb_build_object(
    'has_buyer_video', o.buyer_unboxing_video_url is not null,
    'has_seller_video', o.seller_packing_video_url is not null,
    'buyer_video_url', o.buyer_unboxing_video_url,
    'seller_video_url', o.seller_packing_video_url,
    'buyer_video_at', o.buyer_unboxing_video_at,
    'seller_video_at', o.seller_packing_video_at,
    'delivery_state', o.delivery_state,
    'carrier_status', o.signal,
    'carrier_sub_status', o.carrier_sub_status,
    'shipping_provider', o.shipping_provider,
    'tracking_number', o.tracking_number,
    'verdict', case
      when o.delivery_state = 'not_delivered' then 'not_delivered'
      when o.delivery_state = 'unverified' then 'delivery_unverified'
      when o.buyer_unboxing_video_url is not null and o.seller_packing_video_url is not null
        then 'contested'
      when o.buyer_unboxing_video_url is not null then 'seller_missing_evidence'
      when o.seller_packing_video_url is not null then 'buyer_missing_evidence'
      else 'no_evidence'
    end,
    'recommended_action', case
      when o.delivery_state = 'not_delivered' then 'refund_buyer'
      when o.delivery_state = 'unverified' then null
      when o.buyer_unboxing_video_url is not null and o.seller_packing_video_url is not null
        then null
      when o.buyer_unboxing_video_url is not null then 'refund_buyer'
      else 'release_seller'
    end
  )
  from o;
$$;

revoke execute on function public.dispute_evidence_verdict(uuid) from public, anon, authenticated;
grant execute on function public.dispute_evidence_verdict(uuid) to service_role;

notify pgrst, 'reload schema';
