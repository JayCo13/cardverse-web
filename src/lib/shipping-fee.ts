/**
 * The one shipping number a seller may still set: a price for a single listing.
 *
 * Everything else about postage is GoShip's answer at checkout — see
 * verified-shipping.ts. Sellers used to keep a table of postage per carrier per
 * distance here; the platform books the parcel, and at booking the carrier the
 * table had made cheapest could turn out not to serve the route while the real
 * postage differed from the guess. Since 2026-09-12 the buyer pays GoShip's
 * price for the carrier they pick, and this file keeps only the listing-level
 * override and its rules.
 */

/** What a listing may charge. Zero is free shipping, and is a real answer. */
export const LISTING_SHIPPING_FEE_MIN = 0;
export const LISTING_SHIPPING_FEE_MAX = 99_999;

/**
 * Is this a price the seller set for the listing?
 *
 * Null is a listing that follows GoShip. Never coerce it with Number(): that
 * turns "said nothing" into free shipping.
 */
export const isValidListingShippingFee = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isSafeInteger(value)
  && value >= LISTING_SHIPPING_FEE_MIN
  && value <= LISTING_SHIPPING_FEE_MAX;

/**
 * What the buyer pays, in thousands.
 *
 * GoShip quotes to the đồng (26,200đ; 15,385đ). The buyer pays the next
 * thousand up, and the few hundred đồng between stay with the platform — they
 * are what covers a tariff that moves between the quote and the booking, so
 * the seller never sees a deduction they did not choose.
 */
export const roundUp1000 = (n: number): number => Math.ceil(Math.max(0, n) / 1000) * 1000;
