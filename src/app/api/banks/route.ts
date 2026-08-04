import { NextResponse } from 'next/server';
import { getVietQrBanks } from '@/lib/vietqr';

// Bank directory for the seller form. Proxied rather than fetched from the
// browser so the response is cached once per deployment region instead of once
// per visitor, and so a VietQR outage surfaces as our error, not a CORS one.
export const revalidate = 86400;

export async function GET() {
    try {
        const banks = await getVietQrBanks();
        return NextResponse.json({
            // Only banks NAPAS can resolve a holder name for — offering the
            // others would put the user in a flow that cannot complete.
            banks: banks.filter((bank) => bank.lookupSupported === 1),
        });
    } catch (error) {
        console.error('[Banks] Failed to load VietQR bank list:', error);
        return NextResponse.json({ error: 'Không tải được danh sách ngân hàng.' }, { status: 502 });
    }
}
