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
        name: 'BOX BREAK 24H',
        amount: 69000,
        description: 'Day Pass 24H',
        durationHours: 24,
    },
    credit_pack: {
        name: 'COLLECTOR',
        amount: 99000,
        description: 'Credit Pack 100',
        credits: 100,
    },
    vip_pro: {
        name: 'MERCHANT VIP Pro',
        amount: 299000,
        description: 'VIP Pro Monthly',
        durationDays: 30,
    },
} as const;

export type PackageType = keyof typeof PACKAGES;
