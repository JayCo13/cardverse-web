-- GoShip's own code for the shipment booked against this order.
--
-- Kept apart from tracking_number, which stays the carrier's code — the string
-- a buyer pastes into spx.vn or donhang.ghn.vn. GoShip's webhook carries both:
-- `gcode` is theirs and exists from the moment a shipment is created, `code` is
-- the carrier's and only appears once the carrier accepts it.
--
-- This is the column events are matched on, and that is the point. Matching on
-- tracking_number is what put three orders on one number in this database and
-- left two of them frozen: a seller can type anything, and two sellers can type
-- the same thing. A gcode is issued by GoShip, one per shipment, and cannot
-- collide.
alter table public.orders
  add column if not exists goship_code text;

comment on column public.orders.goship_code is
  'GoShip shipment code (gcode). The key their webhooks are matched on. tracking_number stays the carrier''s own code, for the buyer to look up.';

-- One shipment per order and one order per shipment. The constraint tracking
-- numbers never had.
create unique index if not exists orders_goship_code_key
  on public.orders (goship_code)
  where goship_code is not null;
