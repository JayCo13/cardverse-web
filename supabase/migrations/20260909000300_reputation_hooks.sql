-- Wire the remaining ledger events to the order lifecycle, and give the buyer a
-- way to hand a card back before their hour runs out.
--
-- These are triggers on `orders` rather than edits to the four financial
-- functions that drive those transitions. Those functions
-- (complete_verified_marketplace_order, expire_verified_marketplace_order,
-- resolve_marketplace_dispute, perform_marketplace_order_action) are long, they
-- move money, and each has been rewritten several times by earlier migrations —
-- copying them forward to add two lines apiece is the kind of change that
-- silently drops a fix somebody made in between. A trigger on the status column
-- catches every path into a status, including ones added later.
--
-- It also closes a gap: `update_seller_reputation` is called from the buyer's
-- "confirm received" route but not from the 72-hour auto-release sweep, so a
-- seller whose buyer simply went quiet never got credited. The trigger keys on
-- the status, so both paths count.

-- ─── +1 to both sides when an order completes ────────────────────────────────
create or replace function public.reputation_on_order_completed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.record_reputation_event(
    new.buyer_id, 'buyer', 'order_completed', new.id, null, new.card_id, null);
  perform public.record_reputation_event(
    new.seller_id, 'seller', 'order_completed', new.id, null, new.card_id, null);
  return null;
end;
$fn$;

revoke all on function public.reputation_on_order_completed() from public, anon, authenticated;

drop trigger if exists reputation_on_order_completed on public.orders;
create trigger reputation_on_order_completed
  after update of status on public.orders
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.reputation_on_order_completed();

-- ─── −5 to the seller when a paid order dies on their side ───────────────────
--
-- The status the order came from is what identifies fault. A `pending_payment`
-- order that cancels is a buyer who never paid or a reservation that lapsed —
-- neither is the seller's doing, and the offer sweep already handles the first.
-- Once an order is `paid` or `shipping`, the money is in escrow and the only
-- routes to `cancelled` are the ship-deadline sweep (the seller never handed the
-- parcel over) and an operator cancelling on their behalf. An admin finding for
-- the buyer after a dispute lands on `refunded`, not `cancelled`, and is scored
-- separately below with a verdict attached.
create or replace function public.reputation_on_seller_fault_cancel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.record_reputation_event(
    new.seller_id, 'seller', 'seller_cancelled', new.id, null, new.card_id,
    'paid order cancelled from ' || old.status);
  return null;
end;
$fn$;

revoke all on function public.reputation_on_seller_fault_cancel() from public, anon, authenticated;

drop trigger if exists reputation_on_seller_fault_cancel on public.orders;
create trigger reputation_on_seller_fault_cancel
  after update of status on public.orders
  for each row
  when (new.status = 'cancelled' and old.status in ('paid', 'shipping'))
  execute function public.reputation_on_seller_fault_cancel();

-- ─── Dispute verdicts ────────────────────────────────────────────────────────
--
-- The −10 and −20 events have no automatic trigger and must not have one: they
-- say somebody sent the wrong card, or a fake one, or swapped it on return.
-- Only a person who has looked at the evidence can assert that, so this is
-- called by the admin dispute screen alongside resolve_marketplace_dispute, with
-- whichever finding the operator picked.
--
-- 'no_fault' writes a zero-delta row on purpose. A dispute that was nobody's
-- doing is still worth having on file — without it, the ledger cannot tell
-- "never had a dispute" from "had one and was cleared".
create or replace function public.record_dispute_verdict(
  p_order_id uuid,
  p_verdict text,
  p_actor_id text,
  p_actor_role text,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order public.orders%rowtype;
  v_role text;
  v_user uuid;
begin
  -- Same gate as set_account_restriction: service role only, on behalf of a
  -- named admin or moderator. A −20 is the heaviest thing this system can do to
  -- an account, so it must never be reachable without one.
  if auth.role() is distinct from 'service_role'
     or p_actor_id is null or p_actor_role not in ('admin','moderator') then
    raise exception 'forbidden';
  end if;
  if p_verdict not in ('seller_wrong_item','seller_counterfeit','buyer_fraud','no_fault') then
    raise exception 'dispute_verdict_invalid';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'order_not_found'; end if;

  if p_verdict = 'buyer_fraud' then
    v_role := 'buyer'; v_user := v_order.buyer_id;
  elsif p_verdict = 'no_fault' then
    -- Recorded against the buyer's ledger as the party who raised it, at zero.
    v_role := 'buyer'; v_user := v_order.buyer_id;
  else
    v_role := 'seller'; v_user := v_order.seller_id;
  end if;

  return public.record_reputation_event(
    v_user, v_role, p_verdict, p_order_id, null, v_order.card_id, p_note,
    p_actor_id, p_actor_role);
end;
$fn$;

revoke all on function public.record_dispute_verdict(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_dispute_verdict(uuid, text, text, text, text) to service_role;

-- ─── Letting the buyer hand the card back ────────────────────────────────────
--
-- The scoring table has a row for "buyer walks away after their offer was
-- accepted", but there was no way to do it: every route to a cancelled
-- `pending_payment` order is a reservation lapsing or PayOS failing. A buyer who
-- changed their mind could only wait out the hour, which costs the seller the
-- full hour and the other bidders their place in the queue for no reason.
--
-- The penalty is the same −5 as running the clock out, per the agreed table.
-- What differs is the timing: pressing this hands the card back immediately and
-- brings the held offers straight back to the seller, instead of at the end of
-- the hour.
create or replace function public.cancel_chosen_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_actor uuid := auth.uid();
  v_offer public.offers%rowtype;
  v_card public.cards%rowtype;
begin
  if v_actor is null then raise exception 'unauthorized'; end if;

  select * into v_offer from public.offers where id = p_offer_id for update;
  if not found then raise exception 'offer_not_found'; end if;
  if v_offer.buyer_id <> v_actor then raise exception 'offer_forbidden'; end if;
  if v_offer.status <> 'chosen' then raise exception 'offer_not_chosen'; end if;

  -- Money already on its way is not something to unwind from here. The buyer is
  -- sent back to the payment they started; the sweep's own in-flight guard uses
  -- the same test.
  if exists (
    select 1 from public.orders ord
    where ord.offer_id = v_offer.id and ord.status not in ('cancelled', 'refunded')
  ) then
    raise exception 'offer_payment_in_progress';
  end if;

  select * into v_card from public.cards where id = v_offer.card_id for update;

  update public.offers set status = 'expired' where id = v_offer.id;

  -- A partial bundle offer holds no reservation, so there is nothing to release.
  if v_card.status = 'in_transaction' then
    update public.cards
    set status = 'active', reserved_until = null, updated_at = now()
    where id = v_card.id;
  end if;

  perform public.record_reputation_event(
    v_actor, 'buyer', 'buyer_cancelled', null, v_offer.id, v_card.id,
    'buyer released the card before the window closed');

  insert into public.notifications (user_id, type, title, message, card_id, offer_id, read)
  values (
    v_card.seller_id, 'offer_released', 'Buyer released the card',
    'The buyer withdrew after their offer was accepted, so ' || v_card.name
      || ' is back on the market.',
    v_card.id, v_offer.id, false
  );

  -- Straight away rather than up to two minutes later: the point of pressing the
  -- button is that the next buyer hears about it now.
  perform public.resolve_on_hold_offers();

  return jsonb_build_object('ok', true, 'offer_id', v_offer.id, 'card_id', v_card.id);
end;
$fn$;

revoke all on function public.cancel_chosen_offer(uuid) from public, anon;
grant execute on function public.cancel_chosen_offer(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
