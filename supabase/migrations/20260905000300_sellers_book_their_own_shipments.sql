-- Revert the platform-booked GHN shipment; sellers book their own.
--
-- 20260905000200 had the ship action store a `ghn_order_code` the platform got
-- back from booking the parcel under its own GHN shop. The product decision is
-- the other way round: sellers create the shipment on GHN's own system, like
-- they already do for Viettel Post and SPX, and the platform only reads status.
--
-- With that, nothing sends `ghn_order_code` any more, so the write is removed
-- rather than left dormant — a column that is read in several places and written
-- by nobody is exactly the trap this whole area was already stuck in.
--
-- What follows from the decision, and is worth writing down because it is not
-- obvious: GHN registers a webhook per Client ID, so delivery events for a
-- parcel booked in a seller's own GHN account go to that account and never
-- reach us, whatever code is stored here. GHN's own order-detail API is
-- likewise scoped by the caller's token. Reading delivery status for
-- seller-booked parcels therefore needs a source independent of the booking
-- account — a multi-carrier tracking service — and the same one answers for
-- Viettel Post and SPX, which have no integration either.
--
-- Until such a source exists, `dispute_evidence_verdict` reports 'unverified'
-- for every order and recommends nothing, which is the honest state.
--
-- Restored from 20260905000100 verbatim.
create or replace function public.perform_marketplace_order_action(
  p_order_id uuid,
  p_action text,
  p_actor_id uuid,
  p_idempotency_key uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.marketplace_order_action_requests%rowtype;
  v_order public.orders%rowtype;
  v_funding public.marketplace_order_funding%rowtype;
  v_hash text;
  v_result jsonb;
  v_payout jsonb;
  v_provider text;
  v_tracking text;
  v_reason text;
  v_video text;
  v_auto_complete_at timestamptz;
begin
  perform public.assert_financial_mutations_enabled();
  if p_order_id is null or p_actor_id is null or p_idempotency_key is null
     or p_action not in ('ship', 'confirm_received', 'open_dispute', 'submit_unboxing_video') then
    raise exception 'invalid_marketplace_order_action';
  end if;

  v_hash := jsonb_build_object(
    'version', 1, 'order_id', p_order_id, 'action', p_action,
    'actor_id', p_actor_id, 'payload', coalesce(p_payload, '{}'::jsonb)
  )::text;
  insert into public.marketplace_order_action_requests (
    order_id, actor_id, action, idempotency_key, request_hash, request_payload
  ) values (
    p_order_id, p_actor_id, p_action, p_idempotency_key, v_hash,
    coalesce(p_payload, '{}'::jsonb)
  ) on conflict (order_id, idempotency_key) do nothing;

  select * into v_request
  from public.marketplace_order_action_requests
  where order_id = p_order_id and idempotency_key = p_idempotency_key
  for update;
  if v_request.request_hash <> v_hash then raise exception 'idempotency_conflict'; end if;
  if v_request.result is not null then
    return v_request.result || jsonb_build_object('replayed', true);
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;

  if p_action = 'ship' then
    v_provider := nullif(trim(p_payload ->> 'shipping_provider'), '');
    v_tracking := nullif(trim(p_payload ->> 'tracking_number'), '');
    -- Optional, and accepted at dispatch only. A packing video uploaded after
    -- the buyer complains says nothing about what went into the envelope, so
    -- there is deliberately no action that attaches one later.
    v_video := nullif(trim(p_payload ->> 'packing_video_url'), '');
    begin
      v_auto_complete_at := (p_payload ->> 'auto_complete_at')::timestamptz;
    exception when others then
      raise exception 'invalid_shipping_payload';
    end;
    if v_order.seller_id <> p_actor_id or v_order.status <> 'paid'
       or v_provider is null or (v_provider <> 'self' and v_tracking is null)
       or v_auto_complete_at <= now()
       or v_auto_complete_at > now() + interval '30 days'
       or (v_video is not null and v_video !~ '^https://') then
      raise exception 'order_not_shippable';
    end if;
    update public.orders
    set status = 'shipping', tracking_number = v_tracking,
        shipping_provider = v_provider, auto_complete_at = v_auto_complete_at,
        seller_packing_video_url = v_video,
        seller_packing_video_at = case when v_video is null then null else now() end,
        updated_at = now()
    where id = v_order.id;
    insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
    values (
      v_order.buyer_id, 'order_shipped', 'Order shipped!',
      case when v_tracking is null then 'The seller is delivering your order directly.'
        else 'Tracking number: ' || v_tracking end,
      v_order.card_id, v_order.id, false
    );
    v_result := jsonb_build_object(
      'ok', true, 'status', 'shipping', 'tracking_number', v_tracking,
      'shipping_provider', v_provider, 'buyer_id', v_order.buyer_id
    );
  elsif p_action = 'confirm_received' then
    if v_order.buyer_id <> p_actor_id
       or v_order.status not in ('shipping', 'delivered') then
      raise exception 'order_not_confirmable';
    end if;
    v_payout := public.complete_verified_marketplace_order(v_order.id, p_actor_id);
    insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
    values (
      v_order.seller_id, 'order_completed', 'Order completed!',
      'The buyer confirmed receipt. The funds were credited to your wallet.',
      v_order.card_id, v_order.id, false
    );
    v_result := jsonb_build_object(
      'ok', true, 'status', 'completed', 'seller_id', v_order.seller_id,
      'seller_payout', v_payout -> 'seller_payout'
    );
  elsif p_action = 'submit_unboxing_video' then
    v_video := nullif(trim(p_payload ->> 'video_url'), '');
    if v_order.buyer_id <> p_actor_id
       or v_order.status not in ('shipping', 'delivered', 'disputed')
       or v_video is null
       or v_video !~ '^https://' then
      raise exception 'unboxing_video_not_acceptable';
    end if;
    -- Write-once. Evidence that can be swapped after seeing the other side's
    -- is not evidence.
    if v_order.buyer_unboxing_video_url is not null then
      raise exception 'unboxing_video_already_submitted';
    end if;
    -- The confirmation window is the evidence window: auto_complete_at is set
    -- to delivery + 72h by the GHN webhook, and to the carrier's estimate plus
    -- a buffer on the manual path. A video recorded days after the parcel
    -- arrived proves nothing about what arrived in it.
    if v_order.auto_complete_at is not null and v_order.auto_complete_at < now() then
      raise exception 'unboxing_video_window_closed';
    end if;
    update public.orders
    set buyer_unboxing_video_url = v_video,
        buyer_unboxing_video_at = now(),
        updated_at = now()
    where id = v_order.id;
    insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
    values (
      v_order.seller_id, 'unboxing_video_submitted', 'Người mua đã nộp video mở hộp',
      'Người mua đã tải video mở hộp cho đơn hàng này.',
      v_order.card_id, v_order.id, false
    );
    v_result := jsonb_build_object('ok', true, 'status', v_order.status, 'video_url', v_video);
  else
    v_reason := nullif(trim(p_payload ->> 'reason'), '');
    if v_order.buyer_id <> p_actor_id
       or v_order.status not in ('shipping', 'delivered')
       or v_reason is null then
      raise exception 'order_not_disputable';
    end if;
    select * into v_funding
    from public.marketplace_order_funding where order_id = v_order.id for update;
    if not found or v_funding.verified_amount <> v_order.total_paid
       or v_funding.classification not in ('native_verified_escrow', 'backfilled_verified_escrow') then
      raise exception 'dispute_funding_not_verified';
    end if;
    update public.marketplace_order_funding
    set classification = 'disputed_frozen',
        evidence = evidence || jsonb_build_object(
          'pre_dispute_classification', v_funding.classification,
          'disputed_at', now(), 'disputed_by', p_actor_id
        ),
        updated_at = now()
    where id = v_funding.id;
    update public.orders
    set status = 'disputed', dispute_reason = v_reason, updated_at = now()
    where id = v_order.id;
    insert into public.notifications (user_id, type, title, message, card_id, order_id, read)
    values (
      v_order.seller_id, 'order_disputed', 'Order disputed!',
      'The buyer opened a dispute. Reason: ' || v_reason,
      v_order.card_id, v_order.id, false
    );
    v_result := jsonb_build_object('ok', true, 'status', 'disputed');
  end if;

  update public.marketplace_order_action_requests
  set result = v_result, completed_at = now()
  where id = v_request.id;
  return v_result;
end;
$$;

revoke execute on function public.perform_marketplace_order_action(uuid, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.perform_marketplace_order_action(uuid, text, uuid, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
