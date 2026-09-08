import { goshipStatusToCarrierStatus, goshipTerminalFailure } from '@/lib/goship-status';
import type { CarrierStatus } from '@/lib/carrier-tracking';
import { goshipCarrierToApp } from '@/lib/goship';

/**
 * What GoShip pushes when a shipment moves.
 *
 * Fields per doc.goship.io/api/shipment/webhook-reference. Only the ones that
 * decide something are read; the rest of the payload is carried by GoShip for
 * its own reasons and reading it would invent coupling nobody asked for.
 *
 *   gcode   GoShip's shipment code — issued by them, one per shipment, and the
 *           key an event is matched on. tracking_number is not: a seller types
 *           that, two sellers can type the same thing, and three orders in this
 *           database share one today.
 *   code    the carrier's own code, once the carrier has accepted the shipment.
 *           Absent at first, which is why it is not the match key.
 *   status  a status code as a string — "901", not 901.
 */
export type GoshipWebhookEvent = {
    gcode: string;
    carrierCode: string | null;
    orderRef: string | null;
    /** GoShip's carrier code, mapped to the app's own. */
    carrierSlug: string | null;
    statusCode: number;
    statusText: string | null;
    carrierStatus: CarrierStatus;
    /** Set when this event ends the order rather than advancing it. */
    terminalFailure: { reason: string } | null;
    isLost: boolean;
    isPartDelivery: boolean;
    isReturn: boolean;
};

const str = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
    return s || null;
};

const flag = (v: unknown): boolean => v === 1 || v === '1' || v === true;

/**
 * Read an event, or null if it is not one we can act on.
 *
 * Null for a missing gcode or a status this codebase has not been taught: both
 * would otherwise become a guess written onto an order, and an order is where
 * the money is. The caller logs what it could not read.
 */
export function readGoshipEvent(body: unknown): GoshipWebhookEvent | null {
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;

    const gcode = str(b.gcode);
    if (!gcode) return null;

    const statusRaw = str(b.status);
    const statusCode = Number(statusRaw);
    if (!Number.isInteger(statusCode)) return null;

    const carrierStatus = goshipStatusToCarrierStatus(statusCode);
    if (!carrierStatus) return null;

    return {
        gcode,
        carrierCode: str(b.code),
        orderRef: str(b.order_id),
        carrierSlug: str(b.carrier_short_name) ? goshipCarrierToApp(str(b.carrier_short_name) as string) : null,
        statusCode,
        statusText: str(b.status_text),
        carrierStatus,
        terminalFailure: goshipTerminalFailure(statusCode),
        // GoShip reports these beside the status, and they can be true while the
        // status says something milder. A lost parcel is lost whatever code
        // came with it.
        isLost: flag(b.is_lost),
        isPartDelivery: flag(b.is_part_delivery),
        isReturn: flag(b.is_return),
    };
}
