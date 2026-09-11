-- One sender address per seller, and the profile columns derived from it.
--
-- A seller used to fill in their own address twice: profiles.address_* in the
-- 2025 structure Vietnam has, and goship_pickup in the pre-2025 structure the
-- carrier network still routes on. The second form existed because translating
-- between the two by name books a pickup in the wrong city — Ho Chi Minh City
-- now contains wards GoShip files under Bà Rịa - Vũng Tàu — and that is true.
-- It just did not follow that both had to be COLLECTED.
--
-- Every read of profiles.address_* was traced before this ran. There are two:
-- a gate asking whether a seller has anywhere to collect from, and
-- address_province_name feeding resolveShippingTier. Nothing displays it,
-- nothing ships to it. Both are answered by the carrier's own list, and better:
-- GoShip returns 63 provinces and all 63 resolve against the region lists in
-- shipping-fee.ts, because those lists were written in these names to begin
-- with. A tier exists to predict a carrier bill, and the carrier computes that
-- bill in exactly this geography.
--
-- So /api/shipping/pickup-address now writes both columns as it saves, copying
-- the province name out of the same list the seller picked their city from. No
-- translation happens. This migration does the same for shops that already have
-- a goship_pickup, so they do not have to re-save to stay quotable.
--
-- The 63 names below are GoShip's own, fetched from its /cities endpoint on
-- 2026-09-10. They are embedded rather than looked up because a migration
-- cannot call an API, and they change about as often as the provinces do.
--
-- Note the id column: GoShip's city ids are six digits and an official 2025
-- province code is one or two, so resolveShippingTier's secondary comparison of
-- ids cannot confuse the two code spaces — the failure that once made a
-- delivery inside Tây Ninh quote at the inter-province rate.

with goship_cities(id, name) as (
  values
    ('100000', 'Hà Nội'),
    ('700000', 'Hồ Chí Minh'),
    ('550000', 'Đà Nẵng'),
    ('880000', 'An Giang'),
    ('790000', 'Bà Rịa - Vũng Tàu'),
    ('220000', 'Bắc Ninh'),
    ('230000', 'Bắc Giang'),
    ('820000', 'Bình Dương'),
    ('590000', 'Bình Định'),
    ('830000', 'Bình Phước'),
    ('800000', 'Bình Thuận'),
    ('960000', 'Bạc Liêu'),
    ('930000', 'Bến Tre'),
    ('260000', 'Bắc Kạn'),
    ('900000', 'Cần Thơ'),
    ('650000', 'Khánh Hòa'),
    ('530000', 'Thừa Thiên Huế'),
    ('330000', 'Lào Cai'),
    ('200000', 'Quảng Ninh'),
    ('810000', 'Đồng Nai'),
    ('420000', 'Nam Định'),
    ('970000', 'Cà Mau'),
    ('270000', 'Cao Bằng'),
    ('600000', 'Gia Lai'),
    ('310000', 'Hà Giang'),
    ('400000', 'Hà Nam'),
    ('480000', 'Hà Tĩnh'),
    ('170000', 'Hải Dương'),
    ('180000', 'Hải Phòng'),
    ('350000', 'Hòa Bình'),
    ('160000', 'Hưng Yên'),
    ('920000', 'Kiên Giang'),
    ('580000', 'Kon Tum'),
    ('390000', 'Lai Châu'),
    ('670000', 'Lâm Đồng'),
    ('240000', 'Lạng Sơn'),
    ('850000', 'Long An'),
    ('460000', 'Nghệ An'),
    ('430000', 'Ninh Bình'),
    ('660000', 'Ninh Thuận'),
    ('290000', 'Phú Thọ'),
    ('620000', 'Phú Yên'),
    ('510000', 'Quảng Bình'),
    ('560000', 'Quảng Nam'),
    ('570000', 'Quảng Ngãi'),
    ('520000', 'Quảng Trị'),
    ('950000', 'Sóc Trăng'),
    ('360000', 'Sơn La'),
    ('840000', 'Tây Ninh'),
    ('410000', 'Thái Bình'),
    ('250000', 'Thái Nguyên'),
    ('440000', 'Thanh Hóa'),
    ('860000', 'Tiền Giang'),
    ('940000', 'Trà Vinh'),
    ('300000', 'Tuyên Quang'),
    ('890000', 'Vĩnh Long'),
    ('280000', 'Vĩnh Phúc'),
    ('320000', 'Yên Bái'),
    ('630000', 'Đắk Lắk'),
    ('870000', 'Đồng Tháp'),
    ('640000', 'Đắk Nông'),
    ('910000', 'Hậu Giang'),
    ('380000', 'Điện Biên')
)
update public.profiles p
set address_province_id = (p.goship_pickup ->> 'city')::integer,
    address_province_name = c.name,
    address_ward_code = p.goship_pickup ->> 'ward',
    address_detail = coalesce(nullif(p.goship_pickup ->> 'street', ''), p.address_detail)
from goship_cities c
where p.goship_pickup is not null
  and jsonb_typeof(p.goship_pickup) = 'object'
  and c.id = p.goship_pickup ->> 'city';

-- Called, not merely created. A shop carrying a pickup address whose province
-- did not come across would pass every shape check here and then fail a
-- stranger's checkout with seller_shipping_origin_missing.
do $$
declare
  v_orphans int;
begin
  select count(*) into v_orphans
  from public.profiles
  where goship_pickup is not null
    and jsonb_typeof(goship_pickup) = 'object'
    and coalesce(goship_pickup ->> 'city', '') <> ''
    and (address_province_id is null or coalesce(trim(address_province_name), '') = '');
  if v_orphans > 0 then
    raise exception '% shops have a pickup address with no province behind it', v_orphans;
  end if;
end
$$;

-- Shops with a 2025 address and NO goship_pickup are left exactly as they are.
-- Their gate still passes on the columns they already have; they simply cannot
-- book until they save a sender address, which was already true before this.
