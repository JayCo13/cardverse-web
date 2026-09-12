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
 * VNPost, BEST Express and hand delivery are a softer version of the same
 * removal: they are still defined, but `offerable: false` keeps them out of
 * every picker and quote. See that field, and read OFFERABLE_CARRIERS rather
 * than this list whenever the question is what a shop may ship with.
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
  /**
   * Can a seller still choose this carrier?
   *
   * False retires a carrier from the product without deleting it. VNPost and
   * BEST Express were retired on 2026-09-11; both stay in this list because
   * orders already shipped with them still have to resolve a name, a logo and
   * a tracking link, and dropping the entry would leave those orders rendering
   * a bare code. What retiring removes is every place the carrier is offered
   * forward: the seller's picker, the fee table, the quote, the default set a
   * shop with no stated preference falls back to, and the range shown on a
   * listing.
   */
  offerable: boolean;
}

const ALL_TIERS: readonly ShippingTier[] = ['intra', 'inter', 'region'];

export const SHIPPING_CARRIERS: ShippingCarrier[] = [
  // GHN reads the `order_code` parameter and fills its search box with it.
  { code: 'ghn', short: 'GHN', name: 'Giao Hàng Nhanh (GHN)', logo: '/assets/carriers/ghn.svg', trackingUrl: 'https://donhang.ghn.vn/?order_code={code}', trackingPrefills: true, deliveryDays: { min: 2, max: 5 }, tiers: ALL_TIERS, booksWithCarrier: true, offerable: true },
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
  { code: 'vnp', short: 'VNPost', name: 'Vietnam Post (VNPost)', logo: '/assets/carriers/vnpost.svg', trackingUrl: 'https://www.vnpost.vn/vi/ca-nhan/chuyen-phat/chuyen-phat-trong-nuoc#!?tab=tra-cuu-hanh-trinh', trackingPrefills: false, deliveryDays: { min: 2, max: 5 }, tiers: ALL_TIERS, booksWithCarrier: true, offerable: false },
  // SPX takes the WHOLE query string as the tracking number, not a named
  // parameter — it is doing the equivalent of location.search.slice(1). So
  // `?TrackingID=SPXVN0692...` searched for the literal text
  // "TrackingID=SPXVN0692..." and returned "Không có kết quả phù hợp". The code
  // goes straight after the `?` with no name in front of it.
  { code: 'shopee', short: 'SPX', name: 'Shopee Express', logo: '/assets/carriers/shopee.svg', trackingUrl: 'https://spx.vn/track?{code}', trackingPrefills: true, deliveryDays: { min: 2, max: 4 }, tiers: ALL_TIERS, booksWithCarrier: true, offerable: true },
  { code: 'best', short: 'BEST', name: 'BEST Express', logo: '/assets/carriers/best.svg', trackingUrl: 'https://best-inc.vn/track', trackingPrefills: false, deliveryDays: { min: 2, max: 5 }, tiers: ALL_TIERS, booksWithCarrier: true, offerable: false },
  { code: 'jnt', short: 'J&T', name: 'J&T Express', logo: '/assets/carriers/jnt.svg', trackingUrl: 'https://jtexpress.vn/vi/tracking', trackingPrefills: false, deliveryDays: { min: 2, max: 5 }, tiers: ALL_TIERS, booksWithCarrier: true, offerable: true },
  // Hand delivery, retired on 2026-09-11. It priced at 0đ and sorted first, so
  // once the buyer stopped choosing a carrier every same-province order silently
  // became a meeting nobody had agreed to — and the range on the listing, which
  // deliberately excludes a 0đ nobody outside the province can have, could never
  // contain the figure such a buyer was actually charged. Orders already placed
  // this way still resolve their name and their free fee through this entry.
  { code: 'self', short: 'Tự giao', name: 'Tự giao / Gặp mặt', logo: null, trackingUrl: null, trackingPrefills: false, deliveryDays: null, tiers: ['intra'], booksWithCarrier: false, offerable: false },
];

/**
 * The carriers a seller can pick today.
 *
 * Everything that asks "what may this shop ship with" reads this; only order
 * history, which has to describe a parcel that already went out, reads the full
 * list. A code that stops being offerable therefore disappears from pickers and
 * quotes on the next load without touching any shop's stored preference — and
 * offeredCarriers filters what a shop saved through this list, so a shop that
 * had ticked VNPost simply stops being quoted for it.
 */
export const OFFERABLE_CARRIERS: ShippingCarrier[] = SHIPPING_CARRIERS.filter((c) => c.offerable);

/** Offerable carriers that a courier actually bills for — everything but hand delivery. */
export const OFFERABLE_COURIERS: ShippingCarrier[] = OFFERABLE_CARRIERS.filter((c) => c.booksWithCarrier);

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
