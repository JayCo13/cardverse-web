-- The shipping price a seller sets on one listing, eBay style.
--
-- Sellers priced shipping before, in three tiers per carrier, and it was
-- removed because the numbers described nothing real and — worse — the platform
-- silently ate the difference whenever a seller priced below cost. That second
-- half is now fixed: whatever a shipment costs above what the buyer paid is
-- netted off the seller's payout (seller_payout_for). So the person choosing
-- the number is the person carrying the consequence, which is what makes
-- letting them choose it reasonable again.
--
-- One number per listing rather than a table per shop. It is what the buyer
-- pays, decided by the seller who knows the parcel, and it does not pretend to
-- vary by distance — measured against GoShip, a 200g card costs 15,385–18,850đ
-- to send from anywhere in Vietnam to anywhere else.
--
-- Zero is free shipping and is a real answer, not a missing one: the seller has
-- folded the cost into the item price and will carry the whole carrier bill at
-- settlement. Null means the listing predates this column, or the seller did
-- not say; readers fall back to the platform default.
alter table public.cards
  add column if not exists shipping_fee integer
  check (shipping_fee is null or (shipping_fee >= 0 and shipping_fee <= 99999));

comment on column public.cards.shipping_fee is
  'What the buyer pays to have this listing shipped, in đồng. 0 is free shipping. Null falls back to the platform default.';
