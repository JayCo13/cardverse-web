/**
 * Shipping carriers a seller can offer for their shop. Sellers pick one or more
 * of these plus a fee range (min–max); listings display the range + carriers and
 * checkout charges the MAX of the range (difference reconciled at fulfillment).
 * Codes are stored in profiles.shipping_carriers (text[]).
 */
export type ShippingCarrierCode =
  | 'ghn'
  | 'vtp'
  | 'shopee'
  | 'self';

export interface ShippingCarrier {
  code: ShippingCarrierCode;
  /** Short label shown on badges/listings. */
  short: string;
  /** Full name shown in the shop settings picker. */
  name: string;
  /** Logo image path under /public, or null for carriers rendered with an icon (self delivery). */
  logo: string | null;
  /** Public tracking page; `{code}` is replaced with the tracking number. null = no online tracking (self delivery). */
  trackingUrl: string | null;
  /**
   * Estimated delivery window in days, counted from when the carrier PICKS UP
   * the parcel (the "đã lấy hàng" status that only appears on the carrier's own
   * tracking page). Nationwide standard-service estimate: intra-province ~1-2d,
   * inter-province ~2-4d, cross-region ~3-5d → a conservative 2-5d covers most.
   * null = in-person hand delivery (no estimate).
   */
  deliveryDays: { min: number; max: number } | null;
}

export const SHIPPING_CARRIERS: ShippingCarrier[] = [
  { code: 'ghn', short: 'GHN', name: 'Giao Hàng Nhanh (GHN)', logo: '/assets/carriers/ghn.svg', trackingUrl: 'https://donhang.ghn.vn/?order_code={code}', deliveryDays: { min: 2, max: 5 } },
  { code: 'vtp', short: 'Viettel Post', name: 'Viettel Post', logo: '/assets/carriers/vtp.svg', trackingUrl: 'https://viettelpost.com.vn/tra-cuu-hanh-trinh-don/?peopleTracking={code}', deliveryDays: { min: 2, max: 5 } },
  { code: 'shopee', short: 'SPX', name: 'Shopee Express', logo: '/assets/carriers/shopee.svg', trackingUrl: 'https://spx.vn/track?TrackingID={code}', deliveryDays: { min: 2, max: 4 } },
  { code: 'self', short: 'Tự giao', name: 'Tự giao / Gặp mặt', logo: null, trackingUrl: null, deliveryDays: null },
];

const CARRIER_BY_CODE = new Map(SHIPPING_CARRIERS.map((c) => [c.code, c]));

export const getCarrier = (code: string): ShippingCarrier | undefined =>
  CARRIER_BY_CODE.get(code as ShippingCarrierCode);

/** Estimated delivery window (days from pickup) for a carrier code, or null. */
export const getDeliveryDays = (code: string | null | undefined): { min: number; max: number } | null =>
  (code ? getCarrier(code)?.deliveryDays : null) ?? null;

/** Build the carrier's public tracking URL for a tracking number, or null if unavailable. */
export const getTrackingUrl = (code: string | null | undefined, trackingNumber: string | null | undefined): string | null => {
  if (!code || !trackingNumber) return null;
  const carrier = getCarrier(code);
  if (!carrier?.trackingUrl) return null;
  return carrier.trackingUrl.replace('{code}', encodeURIComponent(trackingNumber));
};

/** Turn stored carrier codes into their short labels, e.g. ['ghn','self'] → 'GHN, Tự giao'. */
export const carrierShortLabels = (codes: string[] | null | undefined): string =>
  (codes || [])
    .map((c) => getCarrier(c)?.short)
    .filter(Boolean)
    .join(', ');
