/**
 * The statuses this app stores against an order.
 *
 * All that remains of the 17TRACK integration, which is gone: shipments are
 * booked through GoShip now, so the carrier's events arrive on a webhook keyed
 * to a code we issued rather than being polled against a number a seller typed.
 * The vocabulary outlived the service because the database, the release logic
 * and every label in the UI are written in it — see goship-status.ts for what
 * maps onto it.
 */
export type CarrierStatus =
    | 'NotFound' | 'InfoReceived' | 'InTransit' | 'Expired' | 'AvailableForPickup'
    | 'OutForDelivery' | 'DeliveryFailure' | 'Delivered' | 'Exception'
    | 'Delayed';
