/**
 * VietQR bank directory.
 *
 * Public, free and unauthenticated — the one part of VietQR still worth using
 * after lookup moved behind a subscription. It is the source of truth for the
 * BIN the seller form submits, and for translating that BIN into the short bank
 * code the lookup provider expects (see `./bank-lookup`).
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

/**
 * Short bank code ("VCB") for a NAPAS BIN ("970436").
 *
 * The rest of the system carries the BIN because that is what NAPAS and the
 * seller form use; the lookup provider keys on the code instead. Resolving it
 * here keeps that mismatch in one place, off the shape stored in
 * `bank_account_lookups`.
 */
export async function bankCodeForBin(bin: string): Promise<string | null> {
    const banks = await getVietQrBanks();
    return banks.find((bank) => bank.bin === bin)?.code || null;
}
