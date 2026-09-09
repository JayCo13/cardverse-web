-- The link GoShip gives for following a parcel, when there is one.
--
-- Constructing it from a carrier and a code does not work before the carrier
-- accepts the shipment: at status 900 GoShip reports carrier_code null and
-- tracking_url null, and a link built from what we did have sent buyers to
-- spx.vn carrying GoShip's own code, which SPX answers with a 404. Its own
-- public tracker does not know the shipment at that point either.
--
-- So the link is stored rather than derived, and its absence is meaningful: no
-- url means there is genuinely nothing to track yet, and no button is offered.
alter table public.orders
  add column if not exists carrier_tracking_url text;

comment on column public.orders.carrier_tracking_url is
  'Tracking link as given by GoShip. Null until the carrier accepts the shipment — do not construct one in its place.';
