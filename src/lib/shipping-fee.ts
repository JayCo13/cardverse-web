/**
 * Resolve a shop's shipping fee from the seller↔buyer province relationship.
 * Three tiers the seller declares on their profile:
 *   intra  → same province                        (nội tỉnh)
 *   inter  → different province, same region       (ngoại tỉnh, cùng miền)
 *   region → different region (North/Central/South) (liên miền)
 * Regions are matched by (diacritic-insensitive) province name so this keeps
 * working even if we swap GHN's province API for another provider.
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
  'Thanh Hóa', 'Nghệ An', 'Hà Tĩnh', 'Quảng Bình', 'Quảng Trị', 'Thừa Thiên Huế', 'Đà Nẵng', 'Quảng Nam',
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
 * Which fee tier applies for a delivery. Prefers province IDs for the
 * same-province check (reliable when both come from the same API); falls back
 * to name matching. Region comparison always uses names.
 */
export const resolveShippingTier = (
  seller: { provinceId?: number | null; provinceName?: string | null },
  buyer: { provinceId?: number | null; provinceName?: string | null },
): ShippingTier => {
  const sameProvince = seller.provinceId && buyer.provinceId
    ? seller.provinceId === buyer.provinceId
    : normalizeProvince(seller.provinceName) !== '' &&
      normalizeProvince(seller.provinceName) === normalizeProvince(buyer.provinceName);
  if (sameProvince) return 'intra';

  const sellerRegion = getRegion(seller.provinceName);
  const buyerRegion = getRegion(buyer.provinceName);
  if (sellerRegion && buyerRegion && sellerRegion === buyerRegion) return 'inter';
  return 'region';
};

export const feeForTier = (tier: ShippingTier, fees: ShippingTierFees): number => fees[tier] ?? 0;

/** Per-carrier tiered fees as stored on the shop: { "<carrier>": { intra, inter, region } }. */
export type ShopShippingFees = Record<string, Partial<ShippingTierFees>>;

/**
 * The bounds a seller-declared shipping fee must fall within.
 *
 * Strictly above zero: free shipping is not offered, and a stored 0 used to be
 * indistinguishable from a seller who never filled the form — which is how a
 * buyer reached a pay button the checkout route would then refuse. Strictly
 * below 100.000đ because a card envelope never costs that much to send in
 * Vietnam, so a larger number is a typo (a missed decimal, usually) rather than
 * a price, and the buyer is the one who would pay for it.
 *
 * Every layer reads these: the shop form, the listing guard, and the server
 * quote. Do not re-type the numbers.
 */
export const SHIPPING_FEE_MIN = 1;
export const SHIPPING_FEE_MAX = 99_999;

export const isValidShippingFee = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isSafeInteger(value)
  && value >= SHIPPING_FEE_MIN
  && value <= SHIPPING_FEE_MAX;

/** Cheapest valid fee across the shop's carriers for a tier; null if none is set. */
export const cheapestTierFee = (
  fees: ShopShippingFees | null | undefined,
  carriers: string[],
  tier: ShippingTier,
): number | null => {
  if (!fees) return null;
  const values = carriers.map((c) => fees[c]?.[tier]).filter(isValidShippingFee);
  return values.length ? Math.min(...values) : null;
};

/**
 * The carriers that can actually be quoted. 'self' is hand delivery: it has no
 * fee table and `quoteConfiguredShipping` refuses it outright, so a shop that
 * offers only 'self' is a shop nobody can check out from.
 */
export const shippableCarriers = (carriers: string[] | null | undefined): string[] =>
  (carriers || []).filter((c) => typeof c === 'string' && c !== 'self');

/**
 * Can this shop be bought from at all?
 *
 * True only when a quotable carrier is enabled AND all three of its tier fees
 * are present and inside the allowed range. A shop failing this cannot list,
 * and its existing listings cannot be checked out — which is the honest answer,
 * since the server would refuse to quote them anyway.
 */
export const hasUsableShipping = (
  fees: ShopShippingFees | null | undefined,
  carriers: string[] | null | undefined,
): boolean =>
  shippableCarriers(carriers).some((carrier) =>
    (['intra', 'inter', 'region'] as const).every((tier) => isValidShippingFee(fees?.[carrier]?.[tier])),
  );

/** Full min–max span of the three tiers — used when the buyer's province is unknown. */
export const shippingFeeRange = (fees: ShippingTierFees): { min: number; max: number } => {
  const values = [fees.intra, fees.inter, fees.region];
  return { min: Math.min(...values), max: Math.max(...values) };
};

/** Min–max span across all tiers of the shop's (non-self) carriers, for listing display. */
export const shopShippingRange = (
  fees: ShopShippingFees | null | undefined,
  carriers: string[] | null | undefined,
): { min: number; max: number } | null => {
  const values: number[] = [];
  (carriers || []).forEach((c) => {
    const f = fees?.[c];
    if (!f) return;
    [f.intra, f.inter, f.region].forEach((v) => {
      if (isValidShippingFee(v)) values.push(v);
    });
  });
  if (!values.length) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
};

const TIER_LABELS: Record<ShippingTier, { vi: string; en: string; ja: string }> = {
  intra: { vi: 'Nội tỉnh', en: 'Same province', ja: '同一省内' },
  inter: { vi: 'Ngoại tỉnh', en: 'Same region', ja: '同一地域' },
  region: { vi: 'Liên miền', en: 'Cross-region', ja: '地域間' },
};

export const tierLabel = (tier: ShippingTier, locale: string): string => {
  const l = TIER_LABELS[tier];
  return locale === 'ja-JP' ? l.ja : locale === 'en-US' ? l.en : l.vi;
};
