export const MIN_OFFER_PERCENT = 5;
export const MAX_OFFER_PERCENT = 99;

export function isValidOfferPercent(acceptOffers: boolean, value: number): boolean {
  if (!Number.isInteger(value)) return false;
  if (!acceptOffers) return value >= 0 && value <= MAX_OFFER_PERCENT;
  return value >= MIN_OFFER_PERCENT && value <= MAX_OFFER_PERCENT;
}
