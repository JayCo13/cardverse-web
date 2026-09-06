-- An address is a province and a ward. There is no district any more.
--
-- Vietnam merged 63 provinces into 34 on 12/6/2025 and abolished the district
-- level on 1/7/2025 (Nghị quyết 202/2025/QH15): 696 districts stopped existing
-- and 10,053 wards became 3,321. Every address the app collects from now on has
-- two levels, so the two district columns can no longer be required.
--
-- Only `shipping_addresses` enforced them. The same fields on `profiles` and
-- `orders` were already nullable, which is why this migration is this short.
--
-- The columns are kept, not dropped. Rows written before the reorganisation
-- name a district that was real when the parcel was sent, and an order's
-- delivery address is a record of where something actually went — rewriting
-- history to fit the new map would be a lie about a shipment. New rows leave
-- them null, and every reader already joins the parts it has with a filter.

alter table public.shipping_addresses
  alter column district_id drop not null,
  alter column district_name drop not null;

comment on column public.shipping_addresses.district_id is
  'Legacy GHN district id. Null for addresses saved after the 2025 reorganisation removed the district level.';
comment on column public.shipping_addresses.district_name is
  'Legacy district name. Null for addresses saved after the 2025 reorganisation removed the district level.';
