/**
 * VietQR bank directory.
 *
 * Public, free and unauthenticated — the one part of VietQR still worth using
 * after lookup moved behind a subscription. It backs the seller form's bank
 * dropdown and is the source of the BIN that form submits.
 *
 * It is NOT a source of bank codes for the lookup provider. The two directories
 * disagree on 18 of 59 shared BINs, and two of those collide: VietQR's "SCB"
 * (970429) is the lookup provider's Sacombank. `./bank-lookup` resolves codes
 * from the provider's own list for exactly that reason — do not add a
 * BIN-to-code helper here.
 */

const BANKS_URL = 'https://api.vietqr.io/v2/banks';

export interface VietQrBank {
    code: string;
    /** 6-digit bank identification number used by NAPAS. */
    bin: string;
    name: string;
    shortName: string;
    logo: string;
    /** 1 when this bank supports account-name lookup. */
    lookupSupported: number;
}

/**
 * Bank directory. Public and effectively static, so it is cached for a day —
 * the BIN is what the lookup call needs, and a stale logo is harmless.
 */
export async function getVietQrBanks(): Promise<VietQrBank[]> {
    const response = await fetch(BANKS_URL, { next: { revalidate: 86400 } });
    if (!response.ok) {
        throw new Error(`VietQR bank list failed: HTTP ${response.status}`);
    }

    const body = await response.json();
    const data = Array.isArray(body?.data) ? body.data : [];

    return data.map((bank: Record<string, unknown>) => ({
        code: String(bank.code ?? ''),
        bin: String(bank.bin ?? ''),
        name: String(bank.name ?? ''),
        shortName: String(bank.shortName ?? bank.short_name ?? ''),
        logo: String(bank.logo ?? ''),
        lookupSupported: Number(bank.lookupSupported ?? 0),
    })).filter((bank: VietQrBank) => bank.bin && bank.shortName);
}
