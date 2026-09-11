/**
 * Shipping carriers a seller can offer for their shop.
 *
 * This list is not a menu of every courier in Vietnam; it is the set GoShip
 * actually returns rates for on this account. Quoting /rates for a 200g parcel
 * on 2026-09-10 returned exactly five, on every route tried: vnp, shopee,
 * ghnv3, best, jnt. Anything the list offers beyond those is a carrier a seller
 * can advertise, a buyer can pick, and nobody can book — so the two are kept in
 * step deliberately, and a carrier is added here only once a rate for it has
 * been seen.
 *
 * Viettel Post used to be here and is not any more. It never appeared in a
 * single quote, which made 'vtp' a shop setting that guaranteed a dead end at
 * booking time. If the account starts selling it, add it back with the rest.
 *
 * Codes are stored in profiles.shipping_carriers (text[]), and are the app's
 * own — goshipCarrierToApp maps GoShip's `ghnv3` onto `ghn`, and the other four
 * happen to agree.
 */
import type { ShippingTier } from '@/lib/shipping-fee';

export type ShippingCarrierCode =
  | 'ghn'
  | 'vnp'
  | 'shopee'
  | 'best'
  | 'jnt'
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
  /**
   * The distance tiers this carrier can actually serve.
   *
   * Every courier serves all three. Hand delivery serves one: two people meet
   * somewhere they both agreed on, which is not a thing that happens between
   * Ho Chi Minh City and Hanoi. Offering it to a buyer in another province is
   * offering a delivery nobody can make, so checkout filters on this and the
   * shop's fee table only asks for the cells it can be charged for.
   */
  tiers: readonly ShippingTier[];
  /**
   * Does a courier get involved?
   *
   * False for hand delivery alone, and it answers two questions at once: what
   * the buyer pays (nothing — there is no carrier to pay) and whether a waybill
   * may be created for the order (no — booking one would attach a real carrier
   * bill to a meeting, and that bill would come off the seller's payout).
   *
   * Hand delivery is free the way meeting someone is free. It looks like free
   * shipping on the listing grid and is the opposite of it underneath: free
   * shipping means the seller pays the whole carrier bill, this means there is
   * no bill.
   */
  booksWithCarrier: boolean;
}

const ALL_TIERS: readonly ShippingTier[] = ['intra', 'inter', 'region'];

export const SHIPPING_CARRIERS: ShippingCarrier[] = [
  // GHN reads the `order_code` parameter and fills its search box with it.
  { code: 'ghn', short: 'GHN', name: 'Giao Hàng Nhanh (GHN)', logo: '/assets/carriers/ghn.svg', trackingUrl: 'https://donhang.ghn.vn/?order_code={code}', trackingPrefills: true, deliveryDays: { min: 2, max: 5 }, tiers: ALL_TIERS, booksWithCarrier: true },
  // The four below were added on 2026-09-10, when the carrier list was matched
  // to what GoShip actually quotes. Unlike GHN and SPX above, their tracking
  // links have NOT been through the browser check described above — each one is
  // the carrier's own lookup page, confirmed to return 200, with no claim about
  // what a query parameter does to the box on it. So every one of them declares
  // trackingPrefills: false, which makes the UI keep the number on screen to
  // copy. Verify one in a browser before setting it true; do not infer it from
  // the shape of another carrier's URL.
  //
  // VNPost is the one worth reading twice. It was the cheapest carrier on every
  // route quoted (15,385đ intra-city, 18,010đ Ho Chi Minh City to Hanoi) AND
  // the only one that charges nothing for khai giá — 18,010đ whether the parcel
  // declares 0đ or 10,000,000đ. For a marketplace shipping graded cards that
  // combination is worth more than the logo it does not have.
  //
  // Its lookup lives behind a hash route on a tab (#!?tab=tra-cuu-hanh-trinh),
  // which is a fragment the server never sees, so a code cannot ride in on it.
  { code: 'vnp', short: 'VNPost', name: 'Vietnam Post (VNPost)', logo: null, trackingUrl: 'https://www.vnpost.vn/vi/ca-nhan/chuyen-phat/chuyen-phat-trong-nuoc#!?tab=tra-cuu-hanh-trinh', trackingPrefills: false, deliveryDays: { min: 2, max: 5 }, tiers: ALL_TIERS, booksWithCarrier: true },
  // SPX takes the WHOLE query string as the tracking number, not a named
  // parameter — it is doing the equivalent of location.search.slice(1). So
  // `?TrackingID=SPXVN0692...` searched for the literal text
  // "TrackingID=SPXVN0692..." and returned "Không có kết quả phù hợp". The code
  // goes straight after the `?` with no name in front of it.
  { code: 'shopee', short: 'SPX', name: 'Shopee Express', logo: '/assets/carriers/shopee.svg', trackingUrl: 'https://spx.vn/track?{code}', trackingPrefills: true, deliveryDays: { min: 2, max: 4 }, tiers: ALL_TIERS, booksWithCarrier: true },
  { code: 'best', short: 'BEST', name: 'BEST Express', logo: null, trackingUrl: 'https://best-inc.vn/track', trackingPrefills: false, deliveryDays: { min: 2, max: 5 }, tiers: ALL_TIERS, booksWithCarrier: true },
  { code: 'jnt', short: 'J&T', name: 'J&T Express', logo: null, trackingUrl: 'https://jtexpress.vn/vi/tracking', trackingPrefills: false, deliveryDays: { min: 2, max: 5 }, tiers: ALL_TIERS, booksWithCarrier: true },
  { code: 'self', short: 'Tự giao', name: 'Tự giao / Gặp mặt', logo: null, trackingUrl: null, trackingPrefills: false, deliveryDays: null, tiers: ['intra'], booksWithCarrier: false },
];

const CARRIER_BY_CODE = new Map(SHIPPING_CARRIERS.map((c) => [c.code, c]));

export const getCarrier = (code: string): ShippingCarrier | undefined =>
  CARRIER_BY_CODE.get(code as ShippingCarrierCode);

/**
 * Is this a courier delivery, as opposed to two people meeting?
 *
 * Unknown codes answer true: the safe direction is to assume a bill exists and
 * charge for it, not to hand out free shipping to a carrier nobody defined.
 */
export const booksWithCarrier = (code: string | null | undefined): boolean =>
  getCarrier(code ?? '')?.booksWithCarrier ?? true;

/**
 * Can this carrier serve a delivery of this distance?
 *
 * An unknown code answers no. It is only ever asked about a carrier a shop
 * offers, and a shop offering something this app does not know about should not
 * have that treated as a yes.
 */
export const carrierServesTier = (code: string | null | undefined, tier: ShippingTier): boolean =>
  !!code && (getCarrier(code)?.tiers.includes(tier) ?? false);

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
