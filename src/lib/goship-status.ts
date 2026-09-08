import type { CarrierStatus } from '@/lib/carrier-tracking';

/**
 * GoShip's shipment codes, mapped onto the statuses this app already stores.
 *
 * Source: doc.goship.io/api/shipment/shipment-status-code — 21 codes, read from
 * the documentation rather than guessed. The app's own vocabulary stays as it
 * is, so apply_carrier_tracking_event, complete_delivered_orders,
 * dispute_evidence_verdict and every label in the UI keep working untouched;
 * only this file knows GoShip exists.
 *
 * Two decisions worth stating, because money follows them:
 *
 * `Delivered` is reached by 905 and 913 alone. It is a one-way door — it starts
 * the 72h release clock — so nothing that merely suggests success gets to open
 * it. 916 (partial delivery) in particular does not: a card marketplace ships
 * one item, so "partly delivered" is a problem to look at, not a sale to pay
 * out.
 *
 * The return journey (907, 908) is Exception rather than DeliveryFailure. A
 * failure is one delivery attempt that missed; a parcel travelling back to the
 * seller is the order ending, and reading them as the same thing hides the
 * difference from whoever has to resolve it.
 */
const STATUS_BY_CODE: Record<number, CarrierStatus> = {
    900: 'InfoReceived',      // Đơn mới — saved, not yet with the carrier
    901: 'InfoReceived',      // Chờ lấy hàng
    902: 'InfoReceived',      // Lấy hàng — courier on its way to collect
    903: 'InTransit',         // Đã lấy hàng — the carrier now holds it
    904: 'OutForDelivery',    // Giao hàng
    905: 'Delivered',         // Giao thành công
    906: 'DeliveryFailure',   // Giao thất bại
    907: 'Exception',         // Đang chuyển hoàn
    908: 'Exception',         // Chuyển hoàn — back with the seller
    909: 'Delivered',         // Đã đối soát — reconciliation follows delivery
    910: 'Delivered',         // Đã đối soát khách
    911: 'Delivered',         // Đã trả COD cho khách
    912: 'Delivered',         // Chờ thanh toán COD
    913: 'Delivered',         // Hoàn thành
    914: 'Exception',         // Đơn hủy
    915: 'Delayed',           // Chậm lấy/giao — late, not broken; see CarrierStatus
    916: 'Exception',         // Giao hàng một phần — see the note above
    917: 'Exception',         // Thất lạc hàng
    918: 'InTransit',         // Đang lưu kho
    919: 'InTransit',         // Đang vận chuyển
    1000: 'Exception',        // Đơn lỗi
};

/**
 * The app's status for a GoShip code, or null for a code this file has not been
 * taught.
 *
 * Null rather than a default: an unrecognised code reaching a money path as
 * "InTransit" would be a guess written into an order, where null lets the
 * caller log it and leave the row alone until someone looks.
 */
export function goshipStatusToCarrierStatus(code: unknown): CarrierStatus | null {
    const n = typeof code === 'number' ? code : Number(String(code ?? '').trim());
    return Number.isInteger(n) ? (STATUS_BY_CODE[n] ?? null) : null;
}

/** Every code this file knows, for tests and for logging what it does not. */
export const KNOWN_GOSHIP_CODES = Object.keys(STATUS_BY_CODE).map(Number);
