import { PayOS } from '@payos/node';

// Lazy-init PayOS client — the SDK throws at construction time
// if env vars are missing (which happens during `npm run build`).
let _payos: InstanceType<typeof PayOS> | null = null;

export function getPayOS() {
    if (!_payos) {
        _payos = new PayOS({
            clientId: process.env.PAYOS_CLIENT_ID,
            apiKey: process.env.PAYOS_API_KEY,
            checksumKey: process.env.PAYOS_CHECKSUM_KEY,
        });
    }
    return _payos;
}

// Package definitions
export const PACKAGES = {
    day_pass: {
        name: 'DAY PASS',
        amount: 29000,
        description: 'Day Pass 24H',
        durationHours: 24,
    },
    credit_pack: {
        name: 'COLLECTOR',
        amount: 49000,
        description: 'Credit Pack 100',
        credits: 100,
    },
    vip_pro: {
        name: 'VIP PRO',
        amount: 149000,
        description: 'VIP Pro Monthly',
        durationDays: 30,
    },
} as const;

export type PackageType = keyof typeof PACKAGES;

export const DEPOSIT_PAYMENT_TYPE = 'deposit' as const;
export const MARKETPLACE_ORDER_PAYMENT_TYPE = 'marketplace_order' as const;

export const SUBSCRIPTION_PACKAGE_TYPES = Object.keys(PACKAGES) as PackageType[];

export type PaymentOrderType =
    | PackageType
    | typeof DEPOSIT_PAYMENT_TYPE
    | typeof MARKETPLACE_ORDER_PAYMENT_TYPE;
