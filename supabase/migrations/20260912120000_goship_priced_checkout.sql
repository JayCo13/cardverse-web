-- Shipping is priced by GoShip at checkout, and khai giá is the seller's.
--
-- Until now the buyer paid a number the seller had guessed into a fee table,
-- plus the declared-value surcharge of whichever carrier that table made
-- cheapest. The platform books the parcel, though, and at booking that carrier
-- may not serve the route and the real postage may differ from the guess — so
-- the seller was netted for a gap they never controlled, and the buyer read a
-- "value protection fee" that protected nobody but the seller (escrow already
-- covers the buyer; GHN pays out at most 5,000,000đ and only against an
-- invoice).
--
-- From 2026-09-12:
--   * the buyer pays GoShip's real postage for the carrier THEY pick, quoted at
--     checkout with declared value 0 and rounded up to the thousand;
--   * the seller decides at booking whether to declare a value, and only that
--     surcharge (plus a parcel they upgraded, or the excess on a listing they
--     priced themselves) comes off their payout;
--   * the shop fee table is no longer read.

-- ---------------------------------------------------------------------------
-- orders: what was quoted, what the seller chose, what the seller is charged
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists shipping_carrier text,
  add column if not exists parcel_preset text,
  add column if not exists shipping_quote jsonb,
  add column if not exists khai_gia_fee bigint not null default 0
    check (khai_gia_fee >= 0),
  add column if not exists declared_value bigint not null default 0
    check (declared_value >= 0),
  add column if not exists seller_shipping_charge bigint
    check (seller_shipping_charge is null or seller_shipping_charge >= 0),
  add column if not exists carrier_changed_from text;

comment on column public.orders.shipping_carrier is
  'App carrier code the buyer picked at checkout (ghn/shopee/jnt/best); replaced by the carrier actually booked if the seller had to change it.';
comment on column public.orders.parcel_preset is
  'Parcel preset the checkout quote was priced with (see src/lib/parcel.ts).';
comment on column public.orders.shipping_quote is
  'GoShip quote the buyer paid: {rate_id, fee_raw, quoted_at, from:{city,district}, to:{city,district}, listing_override}.';
comment on column public.orders.khai_gia_fee is
  'Carrier surcharge for the value the seller declared at booking. 0 when they declared nothing.';
comment on column public.orders.declared_value is
  'Value the seller declared to the carrier at booking, in đồng.';
comment on column public.orders.seller_shipping_charge is
  'Total shipping cost netted off the seller: khai giá + parcel upgrade + excess over a listing-priced fee. Null until booked; null on orders priced before 2026-09-12, which settle on the old goship_fee - shipping_fee rule.';
comment on column public.orders.carrier_changed_from is
  'Carrier the buyer picked, when the seller had to book a different one because it no longer served the route.';

-- The order-creating RPCs insert a fixed column list and copy `metadata`
-- verbatim, so the route handlers put the three checkout-time facts in
-- metadata and this trigger lifts them into their columns. Cheaper and safer
-- than reopening two functions that move money.
create or replace function public.orders_lift_shipping_metadata()
returns trigger
language plpgsql
as $$
begin
  if new.shipping_carrier is null and nullif(new.metadata ->> 'shipping_carrier', '') is not null then
    new.shipping_carrier := new.metadata ->> 'shipping_carrier';
  end if;
  if new.parcel_preset is null and nullif(new.metadata ->> 'parcel_preset', '') is not null then
    new.parcel_preset := new.metadata ->> 'parcel_preset';
  end if;
  if new.shipping_quote is null and jsonb_typeof(new.metadata -> 'shipping_quote') = 'object' then
    new.shipping_quote := new.metadata -> 'shipping_quote';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_lift_shipping_metadata on public.orders;
create trigger orders_lift_shipping_metadata
  before insert on public.orders
  for each row execute function public.orders_lift_shipping_metadata();

-- One definition, both settlement paths. New orders carry the charge the
-- booking route computed; orders from before this migration keep the rule they
-- were priced under.
create or replace function public.seller_payout_for(p_order public.orders)
returns bigint
language sql
immutable
as $function$
  select greatest(
    0,
    p_order.amount - least(
      coalesce(p_order.amount, 0),
      case
        when p_order.seller_shipping_charge is not null then p_order.seller_shipping_charge
        else greatest(0, coalesce(p_order.goship_fee, 0) - coalesce(p_order.shipping_fee, 0))
      end
    )
  );
$function$;

do $$
declare
  v_order public.orders%rowtype;
begin
  v_order.amount := 900000;
  v_order.shipping_fee := 27000;
  v_order.goship_fee := 26200;

  v_order.seller_shipping_charge := 0;      -- booked, nothing declared
  if public.seller_payout_for(v_order) <> 900000 then
    raise exception 'no khai giá should pay the full amount, got %', public.seller_payout_for(v_order);
  end if;

  v_order.seller_shipping_charge := 30000;  -- declared: the surcharge is the seller's
  if public.seller_payout_for(v_order) <> 870000 then
    raise exception 'khai giá should come off the payout, got %', public.seller_payout_for(v_order);
  end if;

  v_order.seller_shipping_charge := null;   -- legacy order: old rule
  v_order.goship_fee := 35125;
  v_order.shipping_fee := 25000;
  if public.seller_payout_for(v_order) <> 889875 then
    raise exception 'legacy order should net goship excess, got %', public.seller_payout_for(v_order);
  end if;

  v_order.amount := 10000;                  -- never below zero
  v_order.seller_shipping_charge := 40000;
  if public.seller_payout_for(v_order) <> 0 then
    raise exception 'payout must not go below zero, got %', public.seller_payout_for(v_order);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- profiles: which carriers collect here, and the shop's default parcel
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists carrier_coverage jsonb,
  add column if not exists parcel_preset text not null default 'raw';

comment on column public.profiles.carrier_coverage is
  'Carriers GoShip quoted from this shop''s pickup address: {carriers: text[], checked_at, probes: [...]}. Refreshed when the pickup is saved or after 7 days.';
comment on column public.profiles.parcel_preset is
  'Default parcel preset for this shop''s listings (src/lib/parcel.ts).';
comment on column public.profiles.shipping_fees is
  'UNUSED since 2026-09-12: shipping is priced by GoShip at checkout. Kept for the orders that were priced from it; drop in a later migration.';

-- VNPost is retired for good (offerable:false stays for old orders). BEST is
-- offerable again, so nothing to strip for it.
update public.profiles
set shipping_carriers = array_remove(shipping_carriers, 'vnp')
where 'vnp' = any(shipping_carriers);

-- ---------------------------------------------------------------------------
-- cards: a listing may pack differently from the shop default
-- ---------------------------------------------------------------------------
alter table public.cards
  add column if not exists parcel_preset text;

comment on column public.cards.parcel_preset is
  'Parcel preset for this listing; null means the shop default (profiles.parcel_preset).';

-- ---------------------------------------------------------------------------
-- GoShip quote cache: grid and checkout share quotes for 10 minutes
-- ---------------------------------------------------------------------------
create table if not exists public.goship_rate_cache (
  key text primary key,
  rates jsonb not null,
  expires_at timestamptz not null
);

comment on table public.goship_rate_cache is
  'Short-lived GoShip /rates answers keyed by env|from|to|parcel|declared. Service-role only; booking never reads it because rate ids must be fresh.';

create index if not exists goship_rate_cache_expires_at_idx
  on public.goship_rate_cache (expires_at);

alter table public.goship_rate_cache enable row level security;
-- No policies on purpose: only the service role reads or writes it.
