/**
 * What a buyer pays to have a card sent, and the province maths behind the
 * tiers that no longer set it.
 *
 * Sellers used to declare three fees each — nội tỉnh, ngoại tỉnh, liên miền —
 * and the buyer was charged whichever tier applied. Quoted against GoShip, that
 * structure turned out to describe nothing: a 200g card costs 15,385đ to send
 * across Ho Chi Minh City and 15,700đ to send from there to Hanoi. At this
 * weight the carriers price flat, so distance was sorting guesses rather than
 * costs — and one seller's 11,000đ nội tỉnh was below the floor, losing money
 * on every order it priced.
 *
 * So the fee is flat and set here, not by sellers. The tier helpers survive
 * because goship-tiers still groups its own quotes by route to show a seller
 * what their address costs to ship from.
 */

export type VnRegion = 'bac' | 'trung' | 'nam';
export type ShippingTier = 'intra' | 'inter' | 'region';

export interface ShippingTierFees {
  intra: number;
  inter: number;
  region: number;
}

const NORTH = [
  'Hà Nội', 'Hà Giang', 'Cao Bằng', 'Bắc Kạn', 'Tuyên Quang', 'Lào Cai', 'Điện Biên', 'Lai Châu',
  'Sơn La', 'Yên Bái', 'Hòa Bình', 'Thái Nguyên', 'Lạng Sơn', 'Quảng Ninh', 'Bắc Giang', 'Phú Thọ',
  'Vĩnh Phúc', 'Bắc Ninh', 'Hải Dương', 'Hải Phòng', 'Hưng Yên', 'Thái Bình', 'Hà Nam', 'Nam Định', 'Ninh Bình',
];
const CENTRAL = [
  // 'Huế' and 'Thừa Thiên Huế' are the same place either side of the 2025
  // reorganisation. Both are listed because the province list now says
  // "Thành phố Huế" while addresses saved before it say the old name, and a
  // province that matches neither falls to the most expensive fee tier.
  'Thanh Hóa', 'Nghệ An', 'Hà Tĩnh', 'Quảng Bình', 'Quảng Trị', 'Thừa Thiên Huế', 'Huế', 'Đà Nẵng', 'Quảng Nam',
  'Quảng Ngãi', 'Bình Định', 'Phú Yên', 'Khánh Hòa', 'Ninh Thuận', 'Bình Thuận', 'Kon Tum', 'Gia Lai',
  'Đắk Lắk', 'Đắk Nông', 'Lâm Đồng',
];
const SOUTH = [
  'Bình Phước', 'Bình Dương', 'Đồng Nai', 'Tây Ninh', 'Bà Rịa - Vũng Tàu', 'Hồ Chí Minh', 'Long An',
  'Tiền Giang', 'Bến Tre', 'Trà Vinh', 'Vĩnh Long', 'Đồng Tháp', 'An Giang', 'Kiên Giang', 'Cần Thơ',
  'Hậu Giang', 'Sóc Trăng', 'Bạc Liêu', 'Cà Mau',
];

/** Lowercase, strip diacritics + the "tỉnh/thành phố/tp" qualifier + punctuation. */
const normalizeProvince = (name: string | null | undefined): string =>
  (name || '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(tinh|thanh pho|tp)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

const REGION_BY_PROVINCE = new Map<string, VnRegion>();
NORTH.forEach((p) => REGION_BY_PROVINCE.set(normalizeProvince(p), 'bac'));
CENTRAL.forEach((p) => REGION_BY_PROVINCE.set(normalizeProvince(p), 'trung'));
SOUTH.forEach((p) => REGION_BY_PROVINCE.set(normalizeProvince(p), 'nam'));

export const getRegion = (provinceName: string | null | undefined): VnRegion | null =>
  REGION_BY_PROVINCE.get(normalizeProvince(provinceName)) ?? null;

/**
 * Which fee tier applies for a delivery.
 *
 * The same-province check reads NAMES first, and treats matching ids only as a
 * second way to say yes. It used to be the other way round, which was right
 * while every id came from GHN and wrong the moment they did not: a seller
 * whose address predates the 2025 reorganisation carries GHN's id (Tây Ninh =
 * 240) while a buyer who picked an address afterwards carries the official code
 * (Tây Ninh = 80). Two ids from two code spaces are never equal, so a delivery
 * inside one province was being quoted — and charged — at the inter-province
 * rate. Names survive the change: `normalizeProvince` strips the "Tỉnh" and
 * "Thành phố" prefixes that the new list adds.
 *
 * Region comparison has always used names, and still does.
 */
export const resolveShippingTier = (
  seller: { provinceId?: number | null; provinceName?: string | null },
  buyer: { provinceId?: number | null; provinceName?: string | null },
): ShippingTier => {
  const sellerKey = normalizeProvince(seller.provinceName);
  const buyerKey = normalizeProvince(buyer.provinceName);
  const sameProvince = (sellerKey !== '' && sellerKey === buyerKey)
    || (!!seller.provinceId && !!buyer.provinceId && seller.provinceId === buyer.provinceId);
  if (sameProvince) return 'intra';

  const sellerRegion = getRegion(seller.provinceName);
  const buyerRegion = getRegion(buyer.provinceName);
  if (sellerRegion && buyerRegion && sellerRegion === buyerRegion) return 'inter';
  return 'region';
};

/**
 * What every order charges for shipping, in đồng.
 *
 * Above the real floor with room to spare: the cheapest carrier on any route
 * measured was 15,385đ, the dearest 36,070đ. This covers the cheap end on every
 * route rather than the dear end on any, because the seller picks the carrier
 * when booking and picks from prices they can see.
 *
 * It does not cover khai giá; see khai-gia.ts, which is added on top.
 */
export const PLATFORM_SHIPPING_FEE = 25_000;

/**
 * What the platform figure does NOT include: khai giá.
 *
 * The insurance a carrier charges for declared value is added separately, from
 * the measured per-carrier model in khai-gia.ts, because it depends on what is
 * in the parcel rather than on where it goes. Every fee in this file is
 * postage.
 */

/** What a listing may charge. Zero is free shipping, and is a real answer. */
export const LISTING_SHIPPING_FEE_MIN = 0;
export const LISTING_SHIPPING_FEE_MAX = 99_999;

export const isValidListingShippingFee = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isSafeInteger(value)
  && value >= LISTING_SHIPPING_FEE_MIN
  && value <= LISTING_SHIPPING_FEE_MAX;

/**
 * What a buyer pays for one listing.
 *
 * Null is a listing written before sellers priced their own shipping, or one
 * whose seller said nothing. It falls back to the platform figure rather than
 * to free: nobody chose free, and charging nothing because a field was empty
 * would hand the whole carrier bill to a seller who never agreed to it.
 */
export const listingShippingFee = (
  fee: number | null | undefined,
  /** What an unpriced listing costs — the shop's own cell, where one is known. */
  fallback: number = PLATFORM_SHIPPING_FEE,
): number => (isValidListingShippingFee(fee) ? fee : fallback);

/**
 * One seller sends one parcel, so several cards bought from them are charged
 * once — at the dearest of their listings' fees, since that is the one whose
 * seller expected the most postage. Free shipping on every card in the group
 * stays free.
 */
export const parcelShippingFee = (
  fees: (number | null | undefined)[],
  fallback: number = PLATFORM_SHIPPING_FEE,
): number =>
  fees.length === 0 ? fallback : Math.max(...fees.map((fee) => listingShippingFee(fee, fallback)));


/**
 * A shop's price list: what it charges to send a parcel, per carrier per tier.
 *
 * Postage only. The khai giá a carrier adds for declared value is computed at
 * checkout from khai-gia.ts and added to whichever of these applies, because it
 * is the one part of a shipping bill that a seller cannot price in advance —
 * GHN, BEST and J&T charge a percentage of the card's value with no ceiling, so
 * any fixed number a seller typed would be short on the next dearer card.
 *
 * Stored twice per seller and read in this order: profiles.shipping_fees is
 * what the seller set, profiles.goship_tier_fees is what GoShip quoted for
 * their pickup address at declared value 0. The first overrides the second cell
 * by cell, so a seller who edited one number keeps live prices for the other
 * two.
 */
export type CarrierFeeTable = Partial<Record<ShippingTier, number>>;

export type ShopFeeTable = Record<string, CarrierFeeTable>;

const cell = (
  table: ShopFeeTable | null | undefined,
  carrier: string,
  tier: ShippingTier,
): number | null => {
  const value = table?.[carrier]?.[tier];
  return isValidListingShippingFee(value) ? value : null;
};

/**
 * The postage for one parcel, before any listing decides to override it.
 *
 * Seller's own number first, the live quote second, the platform figure last.
 */
export const shopShippingFee = (input: {
  set?: ShopFeeTable | null;
  quoted?: ShopFeeTable | null;
  carrier: string;
  tier: ShippingTier;
}): number =>
  cell(input.set, input.carrier, input.tier)
  ?? cell(input.quoted, input.carrier, input.tier)
  ?? PLATFORM_SHIPPING_FEE;

/** Is this a table this app can read at all? Shape only; cells validate above. */
export const isShopFeeTable = (value: unknown): value is ShopFeeTable =>
  !!value && typeof value === 'object' && !Array.isArray(value);
