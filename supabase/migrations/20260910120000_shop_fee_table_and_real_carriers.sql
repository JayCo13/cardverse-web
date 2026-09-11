-- Bring the shop fee table back into use, and drop the carrier nobody sells.
--
-- profiles.shipping_fees and profiles.goship_tier_fees keep the shape they have
-- always had — carrier -> tier -> đồng — because it turned out to be the right
-- one. What changed is around them:
--
--   * Every cell is POSTAGE, quoted at declared value 0đ. What a carrier adds
--     for khai giá is no longer anybody's guess and is not stored here: it is
--     identical on every route (GHN adds 14,500đ to a 2,900,000đ parcel whether
--     it crosses the city or the country), so it lives as a measured per-carrier
--     model in src/lib/khai-gia.ts and is added at checkout. That is what makes
--     a three-number table honest again — the part of the bill a seller could
--     not have predicted is no longer theirs to predict.
--
--   * The seller-typed table is read cell by cell, falling through to the
--     quoted one. An empty cell keeps following live prices instead of freezing
--     at whatever the seller typed once.
--
--   * A carrier is only priced for the distances it can serve, and only if a
--     courier is paid at all. Hand delivery is neither: it is same-province
--     only, because two people meeting somewhere they agreed on is a
--     same-province arrangement, and it is free to both sides, because there is
--     no carrier bill — which is the opposite of free shipping, where the
--     seller absorbs the whole one.
--
-- The first version of this file reshaped both columns to carry declared-value
-- bands. That design was dropped before it ran: GHN, BEST and J&T charge a
-- percentage of value with NO ceiling, so any fixed "high value" number is
-- correct at one card price and short at every higher one. Measuring the
-- formula beat approximating it with a second column.

alter table public.profiles
  drop constraint if exists profiles_shipping_fees_shape;

-- An object at least. The shape below that is the app's business, but a scalar
-- or an array here would break every reader silently.
alter table public.profiles
  add constraint profiles_shipping_fees_shape check (
    shipping_fees is null or jsonb_typeof(shipping_fees) = 'object'
  );

-- Viettel Post is removed from every shop's carrier list. Quoting GoShip's
-- /rates on 2026-09-10 returned five carriers on every route and weight tried —
-- vnp, shopee, ghnv3, best, jnt — and vtp was in none of them. Offering it was a
-- promise the booking screen could not keep.
--
-- Any fees stored under 'vtp' are left where they are: they cost nothing to
-- keep, readers only look up carriers the app currently offers, and if the
-- account starts selling it the seller gets their numbers back.
update public.profiles
set shipping_carriers = array_remove(shipping_carriers, 'vtp')
where 'vtp' = any(shipping_carriers);

-- Stale, not wrong. The stored quotes are still valid postage — they were taken
-- at declared value 0, which is exactly what a cell means now — but they only
-- cover the carriers the app offered when they were taken, so VNPost, BEST and
-- J&T are missing from every one of them. Clearing the timestamp is how the
-- setup page knows to ask for a refresh rather than presenting a table with
-- three carriers silently absent.
update public.profiles
set goship_tier_fees_at = null
where goship_tier_fees is not null;

-- Hand delivery has no price, so it has no row.
--
-- Shops could set all three tiers for 'self' under the 2026-07 shipping
-- options. Every one of those cells is now unreachable: two people meeting is
-- charged at nothing by definition rather than by a number somebody typed, and
-- checkout returns zero for it before consulting any table. Leaving the numbers
-- behind would mean a seller could edit a figure that changes nothing.
--
-- The carrier itself stays in shipping_carriers. Offering to meet buyers is
-- still a choice a shop makes; it just is not a price.
update public.profiles
set shipping_fees = shipping_fees - 'self'
where shipping_fees ? 'self';

comment on column public.profiles.shipping_fees is
  'Postage this shop charges the buyer: carrier -> tier (intra|inter|region) -> đồng. Cells may be absent; readers fall back to goship_tier_fees, then to the platform figure. Khai giá is added on top at checkout from src/lib/khai-gia.ts and is not stored here.';

comment on column public.profiles.goship_tier_fees is
  'Real GoShip postage per carrier per tier, quoted at declared value 0đ from goship_pickup. Same shape as shipping_fees. Null until quoted.';

-- Called, not merely created. A shop still offering an unquotable carrier would
-- not fail anywhere; it would fail at the one moment a parcel had to be booked.
do $$
declare
  v_vtp int;
  v_bad int;
begin
  select count(*) into v_vtp from public.profiles where 'vtp' = any(shipping_carriers);
  if v_vtp > 0 then
    raise exception '% shops still offer a carrier GoShip does not quote', v_vtp;
  end if;

  -- Every leaf that survives must be a plain number of đồng. A nested object
  -- here would be a row left over from the banded design that never shipped.
  select count(*) into v_bad
  from public.profiles p, jsonb_each(p.shipping_fees) c, jsonb_each(c.value) t
  where jsonb_typeof(p.shipping_fees) = 'object'
    and jsonb_typeof(c.value) = 'object'
    and jsonb_typeof(t.value) <> 'number';
  if v_bad > 0 then
    raise exception 'shipping_fees holds % cells that are not amounts', v_bad;
  end if;

  select count(*) into v_bad from public.profiles where shipping_fees ? 'self';
  if v_bad > 0 then
    raise exception '% shops still carry a price for hand delivery', v_bad;
  end if;
end
$$;
