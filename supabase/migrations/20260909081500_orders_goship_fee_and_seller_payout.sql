-- What the shipment actually cost, and what the seller is therefore paid.
--
-- The buyer pays one flat shipping fee. The seller chooses the carrier when
-- booking, from live prices, and may choose one that costs more than that fee.
-- Until now the platform silently absorbed the difference while the booking
-- screen told the seller "bạn bù 10.125đ" — a sentence describing a deduction
-- that never happened. Either the words or the money had to change; the money
-- does, because a seller who picks the dearer carrier is the one who decided
-- to spend more.
--
-- Only the excess. A seller who picks a cheaper carrier does not pocket the
-- difference: the fee was collected to move the parcel, not as their income,
-- and paying it out would turn every shipping decision into a small trade
-- against the buyer's money.

alter table public.orders
  add column if not exists goship_fee bigint
  check (goship_fee is null or goship_fee >= 0);

comment on column public.orders.goship_fee is
  'Total GoShip charged for this shipment, in đồng. Null until a waybill is booked. Read server-side from a fresh quote, never from the browser.';

-- One definition, so both settlement paths and anything that displays a payout
-- cannot drift from each other.
create or replace function public.seller_payout_for(p_order public.orders)
returns bigint
language sql
immutable
as $function$
  select greatest(
    0,
    p_order.amount - least(
      -- Never more than the sale itself: a shipping bill cannot put a seller
      -- into debt over one order, whatever went wrong upstream.
      coalesce(p_order.amount, 0),
      greatest(0, coalesce(p_order.goship_fee, 0) - coalesce(p_order.shipping_fee, 0))
    )
  );
$function$;

comment on function public.seller_payout_for(public.orders) is
  'Sale amount less any shipping the seller spent above what the buyer paid. Surplus is not credited.';
