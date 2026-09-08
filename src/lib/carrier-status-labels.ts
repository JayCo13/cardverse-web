/**
 * The carrier's own delivery status, in the reader's language.
 *
 * Kept apart from `carrier-tracking.ts` on purpose: that module talks to
 * 17TRACK and reads the API key, so importing it from a client component would
 * pull server code into the browser bundle. These are only strings.
 *
 * The keys are the statuses 17TRACK reports, plus Delayed from GoShip. Anything outside them
 * resolves to null, and the caller decides what to show instead — a status we
 * cannot name is better left blank than printed raw.
 */
export const CARRIER_STATUS_LABELS: Record<string, { vi: string; en: string; ja: string }> = {
  NotFound: { vi: 'Hãng chưa có thông tin', en: 'No carrier data yet', ja: '配送業者の情報なし' },
  InfoReceived: { vi: 'Đã tiếp nhận thông tin', en: 'Info received', ja: '情報受付済み' },
  InTransit: { vi: 'Đang vận chuyển', en: 'In transit', ja: '輸送中' },
  OutForDelivery: { vi: 'Đang giao đến bạn', en: 'Out for delivery', ja: '配達中' },
  AvailableForPickup: { vi: 'Chờ nhận tại điểm giao', en: 'Available for pickup', ja: '受取可能' },
  Delivered: { vi: 'Đã giao thành công', en: 'Delivered', ja: '配達完了' },
  DeliveryFailure: { vi: 'Giao không thành công', en: 'Delivery failed', ja: '配達失敗' },
  Exception: { vi: 'Có sự cố', en: 'Exception', ja: '異常' },
  Expired: { vi: 'Quá hạn theo dõi', en: 'Tracking expired', ja: '追跡期限切れ' },
  // Not a 17TRACK status: GoShip flags a parcel behind schedule, which is
  // neither an exception nor plain transit. See CarrierStatus.
  Delayed: { vi: 'Chậm lấy/giao', en: 'Delayed', ja: '集荷/配達の遅延' },
};

export function carrierStatusLabel(status: string | null | undefined, locale: string): string | null {
  const entry = status ? CARRIER_STATUS_LABELS[status] : undefined;
  if (!entry) return null;
  return entry[locale === 'ja-JP' ? 'ja' : locale === 'en-US' ? 'en' : 'vi'];
}
