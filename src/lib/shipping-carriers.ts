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
  /**
   * Public tracking page; `{code}` is replaced with the tracking number.
   * null = no online tracking (self delivery).
   *
   * Every carrier parses this differently and none of them document it, so each
   * template below was verified by loading it in a real browser and reading the
   * value that ended up in the carrier's own search box. Do not "tidy" one into
   * the shape of another.
   */
  trackingUrl: string | null;
  /**
   * Does opening `trackingUrl` actually fill in the code, or does the visitor
   * still have to type it? Viettel Post puts its lookup behind a reCAPTCHA
   * iframe that ignores every query parameter, so the link is a destination
   * rather than a lookup. Show the number next to the link for those carriers.
   */
  trackingPrefills: boolean;
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
  // GHN reads the `order_code` parameter and fills its search box with it.
  { code: 'ghn', short: 'GHN', name: 'Giao Hàng Nhanh (GHN)', logo: '/assets/carriers/ghn.svg', trackingUrl: 'https://donhang.ghn.vn/?order_code={code}', trackingPrefills: true, deliveryDays: { min: 2, max: 5 } },
  // Viettel Post renders its lookup inside an iframe
  // (viettelpost.vn/viettelpost-iframe/tra-cuu-hanh-trinh-don-hang-v3-recaptcha)
  // whose src carries no query of its own, so nothing on the outer URL reaches
  // the form. The `peopleTracking` parameter this used to send was dead: it was
  // tested along with orderNumber, order, code, tracking, keyword and billCode,
  // on both the page and the iframe, and the box stayed empty every time. The
  // reCAPTCHA in front of it says that is deliberate. Link to the page and let
  // the UI show the number to copy.
  { code: 'vtp', short: 'Viettel Post', name: 'Viettel Post', logo: '/assets/carriers/vtp.svg', trackingUrl: 'https://viettelpost.com.vn/tra-cuu-hanh-trinh-don/', trackingPrefills: false, deliveryDays: { min: 2, max: 5 } },
  // SPX takes the WHOLE query string as the tracking number, not a named
  // parameter — it is doing the equivalent of location.search.slice(1). So
  // `?TrackingID=SPXVN0692...` searched for the literal text
  // "TrackingID=SPXVN0692..." and returned "Không có kết quả phù hợp". The code
  // goes straight after the `?` with no name in front of it.
  { code: 'shopee', short: 'SPX', name: 'Shopee Express', logo: '/assets/carriers/shopee.svg', trackingUrl: 'https://spx.vn/track?{code}', trackingPrefills: true, deliveryDays: { min: 2, max: 4 } },
  { code: 'self', short: 'Tự giao', name: 'Tự giao / Gặp mặt', logo: null, trackingUrl: null, trackingPrefills: false, deliveryDays: null },
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

/**
 * Does this carrier's tracking link arrive with the code already in the box, or
 * does the visitor still have to paste it? Callers that hide the number behind
 * a link need to keep it on screen when this is false.
 */
export const trackingPrefillsCode = (code: string | null | undefined): boolean =>
  !!code && !!getCarrier(code)?.trackingPrefills;

/**
 * Does the seller have to supply a tracking number for this carrier?
 *
 * Every carrier except hand delivery. Sellers book their own shipments on the
 * carrier's own system and paste the code back here; the platform books nothing.
 *
 * The consequence to know: GHN registers its webhook per Client ID, so events
 * for a parcel booked in a seller's own GHN account are delivered to that
 * account, never to us. Reading delivery status for seller-booked parcels
 * therefore needs a source that is not tied to the booking account — a
 * multi-carrier tracking service — and that one source covers Viettel Post and
 * SPX too, neither of which we integrate with either.
 */
export const sellerSuppliesTracking = (code: string | null | undefined): boolean =>
  !!code && code !== 'self';

/** Turn stored carrier codes into their short labels, e.g. ['ghn','self'] → 'GHN, Tự giao'. */
export const carrierShortLabels = (codes: string[] | null | undefined): string =>
  (codes || [])
    .map((c) => getCarrier(c)?.short)
    .filter(Boolean)
    .join(', ');

/**
 * Where to send someone to follow a parcel, or null when nowhere yet.
 *
 * The stored link first, because GoShip gives the right one and gives it only
 * once the carrier has accepted the shipment. Before that there is genuinely
 * nothing to track: GoShip reports carrier_code and tracking_url both null, its
 * own tracker does not know the shipment either, and a link built from the
 * carrier plus GoShip's code sends the buyer to a 404.
 *
 * So null is an answer, not a gap — the caller shows no button rather than a
 * broken one.
 */
export const parcelTrackingUrl = (
  carrier: string | null | undefined,
  trackingNumber: string | null | undefined,
  carrierTrackingUrl: string | null | undefined,
): string | null => {
  if (carrierTrackingUrl) return carrierTrackingUrl;
  return trackingNumber ? getTrackingUrl(carrier, trackingNumber) : null;
};
