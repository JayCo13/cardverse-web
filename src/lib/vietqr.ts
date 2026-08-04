/**
 * VietQR / NAPAS bank account name lookup.
 *
 * Replaces the old "upload a screenshot of your banking app" step. A screenshot
 * is trivially edited; this asks the banking network who actually owns the
 * account number, so the payout destination can be tied to the verified
 * identity instead of taken on trust.
 */

const BANKS_URL = 'https://api.vietqr.io/v2/banks';
const LOOKUP_URL = 'https://api.vietqr.io/v2/lookup';

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

export type BankLookupResult =
    /** NAPAS resolved the account and returned its holder. */
    | { status: 'ok'; accountName: string }
    /** The account number is wrong, or the bank rejected the query. */
    | { status: 'not_found'; code: string; message: string }
    /** Our side could not ask: missing config, rate limit, provider down. */
    | { status: 'unavailable'; reason: string };

function credentials() {
    const clientId = process.env.VIETQR_CLIENT_ID;
    const apiKey = process.env.VIETQR_API_KEY;
    if (!clientId || !apiKey) return null;
    return { clientId, apiKey };
}

/** True when lookup is configured. Callers degrade to manual review if not. */
export function isBankLookupConfigured() {
    return credentials() !== null;
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
 * Ask NAPAS who owns an account. Never throws — every failure mode is a
 * returned status, because a lookup outage must degrade to manual review
 * rather than block a legitimate seller from submitting.
 */
export async function lookupBankAccountName(params: {
    bin: string;
    accountNumber: string;
}): Promise<BankLookupResult> {
    const creds = credentials();
    if (!creds) return { status: 'unavailable', reason: 'not_configured' };

    const accountNumber = params.accountNumber.replace(/\D/g, '');
    if (accountNumber.length < 6 || accountNumber.length > 19) {
        return { status: 'not_found', code: 'invalid_length', message: 'Số tài khoản phải có từ 6 đến 19 chữ số.' };
    }
    if (!/^\d{6}$/.test(params.bin)) {
        return { status: 'not_found', code: 'invalid_bin', message: 'Mã ngân hàng không hợp lệ.' };
    }

    let response: Response;
    try {
        response = await fetch(LOOKUP_URL, {
            method: 'POST',
            headers: {
                'x-client-id': creds.clientId,
                'x-api-key': creds.apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ bin: params.bin, accountNumber }),
            signal: AbortSignal.timeout(10_000),
        });
    } catch (error) {
        console.error('[VietQR] Lookup request failed:', error);
        return { status: 'unavailable', reason: 'network' };
    }

    if (response.status === 429) {
        return { status: 'unavailable', reason: 'rate_limited' };
    }
    if (response.status >= 500) {
        return { status: 'unavailable', reason: `upstream_${response.status}` };
    }

    let body: Record<string, unknown>;
    try {
        body = await response.json();
    } catch {
        return { status: 'unavailable', reason: 'bad_response' };
    }

    const code = String(body?.code ?? '');
    const accountName =
        typeof (body?.data as Record<string, unknown>)?.accountName === 'string'
            ? String((body.data as Record<string, unknown>).accountName).trim()
            : '';

    if (code === '00' && accountName) {
        return { status: 'ok', accountName };
    }

    // A non-"00" code is a definite answer from the network: this account
    // number does not resolve. That is a user error, not an outage.
    return {
        status: 'not_found',
        code: code || 'unknown',
        message: String(body?.desc ?? 'Không tra cứu được tài khoản này.'),
    };
}
