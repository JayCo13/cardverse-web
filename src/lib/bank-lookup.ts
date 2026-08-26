/**
 * Bank account holder lookup through NAPAS, via BankLookup.
 *
 * Replaces the old "upload a screenshot of your banking app" step. A screenshot
 * is trivially edited; this asks the banking network who actually owns the
 * account number, so the payout destination can be tied to the verified
 * identity instead of taken on trust.
 *
 * VietQR held this job until it moved lookup behind a subscription ("The Free
 * Plan will no longer support from August 20, 2024") and then withdrew it
 * entirely. Its bank directory is still free and still used for the seller
 * form's dropdown — see `./vietqr` — but only for that.
 */

const BASE_URL = 'https://api.banklookup.net';

/**
 * Kept under the platform's function timeout, with room for the directory
 * fetch that may precede it on a cold cache.
 */
const REQUEST_TIMEOUT_MS = 6_000;

/** The directory is one uncached call away from the whole budget. */
const DIRECTORY_TIMEOUT_MS = 8_000;

export type BankLookupResult =
    /** NAPAS resolved the account and returned its holder. */
    | { status: 'ok'; accountName: string }
    /** The account number is wrong, or the bank rejected the query. */
    | { status: 'not_found'; code: string; message: string }
    /** Our side could not ask: missing config, no credit, rate limit, outage. */
    | { status: 'unavailable'; reason: string };

type ProviderBank = {
    bin: number | string;
    code: string;
    lookup_supported: number;
};

/**
 * Failure markers that mean the request never reached NAPAS on our account's
 * behalf. Matched against the provider's `msg`, because it reuses HTTP 422 for
 * both these and a genuine unknown account.
 */
const OPERATOR_FAULT = /HEADER|API_INFO|API_KEY|SECRET|TOKEN|CREDIT|BALANCE|UNAUTHORIZED|FORBIDDEN|PERMISSION|SUSPEND|EXPIRED/i;

function operatorFaultReason(message: string) {
    if (/CREDIT|BALANCE/i.test(message)) return 'insufficient_balance';
    return 'unauthorized';
}

function credentials() {
    const key = process.env.BANKLOOKUP_API_KEY;
    const secret = process.env.BANKLOOKUP_API_SECRET;
    if (!key || !secret) return null;
    return { key, secret };
}

/** True when lookup is configured. Callers degrade to manual review if not. */
export function isBankLookupConfigured() {
    return credentials() !== null;
}

/**
 * Bank code this provider expects for a NAPAS BIN.
 *
 * Read from the provider's own directory, never from VietQR's — the two
 * disagree on 18 of 59 shared BINs, and two of those disagreements collide
 * outright: VietQR calls 970403 "STB" and 970429 "SCB", while this provider
 * uses "SCB" for 970403 and "SGCB" for 970429. Mapping through the wrong
 * authority would silently query Sacombank for an SCB account and hand back a
 * different real person's name.
 *
 * Cached for a day: the directory is effectively static, and an uncached call
 * has been measured near five seconds.
 */
async function bankCodeForBin(bin: string): Promise<string | null> {
    const response = await fetch(`${BASE_URL}/bank/list`, {
        next: { revalidate: 86400 },
        signal: AbortSignal.timeout(DIRECTORY_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`Bank directory failed: HTTP ${response.status}`);
    }

    const body = await response.json();
    const banks: ProviderBank[] = Array.isArray(body) ? body : (body?.data ?? []);

    const match = banks.find((bank) => String(bank.bin) === bin);
    if (!match) return null;
    // A bank the provider lists but cannot query is a definite answer, not an
    // outage — treated as unsupported by the caller below.
    return match.lookup_supported === 1 ? match.code : null;
}

/**
 * Ask NAPAS who owns an account. Never throws — every failure mode is a
 * returned status, because a lookup outage must degrade to manual review
 * rather than block a legitimate seller from submitting.
 */
export async function lookupBankAccountName(params: {
    /** 6-digit NAPAS bank identification number, as sent by the client. */
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

    // Failing to reach the directory is our problem, not the seller's.
    let bankCode: string | null;
    try {
        bankCode = await bankCodeForBin(params.bin);
    } catch (error) {
        console.error('[BankLookup] Bank directory unavailable:', error);
        return { status: 'unavailable', reason: 'bank_directory' };
    }
    if (!bankCode) {
        return { status: 'not_found', code: 'unsupported_bank', message: 'Ngân hàng này chưa hỗ trợ tra cứu tự động.' };
    }

    let response: Response;
    try {
        response = await fetch(BASE_URL, {
            method: 'POST',
            headers: {
                'x-api-key': creds.key,
                'x-api-secret': creds.secret,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ bank: bankCode, account: accountNumber }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        const name = (error as Error)?.name;
        const reason = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
        console.error(`[BankLookup] Lookup request failed (${reason}):`, error);
        return { status: 'unavailable', reason };
    }

    let body: Record<string, unknown> = {};
    try {
        body = (await response.json()) as Record<string, unknown>;
    } catch {
        return { status: 'unavailable', reason: response.ok ? 'bad_response' : `upstream_${response.status}` };
    }

    const message = typeof body.msg === 'string' ? body.msg : '';

    // Log verbatim. A generic "provider refused" is what turned an out-of-credit
    // account into a timeout hunt on the KYC side; the operator needs the reason
    // the provider actually gave, even though the seller must never see it.
    switch (response.status) {
        case 402:
            console.error(`[BankLookup] Out of credit — top up at banklookup.net: ${message}`);
            return { status: 'unavailable', reason: 'insufficient_balance' };
        case 401:
        case 403:
            console.error(`[BankLookup] Credentials rejected (HTTP ${response.status}): ${message}`);
            return { status: 'unavailable', reason: 'unauthorized' };
        case 429:
            return { status: 'unavailable', reason: 'rate_limited' };
        case 422:
            // Documented as "not found", but the provider also answers 422 for
            // problems on our side: a missing header is MISSING_HEADER and a bad
            // key is API_INFO_NOT_FOUND, both 422. Reading the status alone
            // would report our own misconfiguration as the seller's account not
            // existing — blaming them for our billing or deployment, and
            // blocking a legitimate submission.
            if (OPERATOR_FAULT.test(message)) {
                console.error(`[BankLookup] Request rejected for a reason on our side: ${message}`);
                return { status: 'unavailable', reason: operatorFaultReason(message) };
            }
            return { status: 'not_found', code: '422', message: message || 'Không tìm thấy tài khoản này.' };
    }

    if (response.status >= 500) {
        console.error(`[BankLookup] Provider error HTTP ${response.status}: ${message}`);
        return { status: 'unavailable', reason: `upstream_${response.status}` };
    }

    const data = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>;
    const ownerName = typeof data.ownerName === 'string' ? data.ownerName.trim() : '';

    if (body.success === true && ownerName) {
        return { status: 'ok', accountName: ownerName };
    }

    // A 200 that carries neither an owner nor a documented failure code is a
    // shape we do not recognise. Do not read it as a verdict on the account.
    if (response.ok && !ownerName) {
        console.error(`[BankLookup] Unrecognised success payload: ${JSON.stringify(body).slice(0, 200)}`);
        return { status: 'unavailable', reason: 'bad_response' };
    }

    return {
        status: 'not_found',
        code: String(body.code ?? response.status),
        message: message || 'Không tra cứu được tài khoản này.',
    };
}
