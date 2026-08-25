/**
 * Bank account holder lookup through NAPAS.
 *
 * Replaces the old "upload a screenshot of your banking app" step. A screenshot
 * is trivially edited; this asks the banking network who actually owns the
 * account number, so the payout destination can be tied to the verified
 * identity instead of taken on trust.
 *
 * The provider is Tra Cứu Bank, billed per successful lookup. VietQR held this
 * job until it moved lookup behind a subscription ("The Free Plan will no
 * longer support from August 20, 2024"), which prices a per-seller onboarding
 * call like a high-volume one. VietQR's bank directory is still free and still
 * used — see `./vietqr` — including for the BIN the client sends us.
 */

import { bankCodeForBin } from './vietqr';

const LOOKUP_URL = 'https://tracuubank.com/api/lookup';

/**
 * Kept well under the platform's function timeout. The provider advertises
 * sub-second responses, so anything near this ceiling is already a fault.
 */
const REQUEST_TIMEOUT_MS = 6_000;

export type BankLookupResult =
    /** NAPAS resolved the account and returned its holder. */
    | { status: 'ok'; accountName: string }
    /** The account number is wrong, or the bank rejected the query. */
    | { status: 'not_found'; code: string; message: string }
    /** Our side could not ask: missing config, no balance, rate limit, outage. */
    | { status: 'unavailable'; reason: string };

function apiKey() {
    return process.env.TRACUUBANK_API_KEY || '';
}

/** True when lookup is configured. Callers degrade to manual review if not. */
export function isBankLookupConfigured() {
    return apiKey().length > 0;
}

/**
 * Conditions that are ours to fix, not the seller's.
 *
 * The provider reports these in prose rather than a distinct code, and calling
 * them "account not found" would blame a seller for our billing and block a
 * legitimate submission. Every one of them belongs in the manual-review path.
 */
const OPERATOR_FAULT = /số dư|không đủ|hết tiền|nạp tiền|balance|insufficient|token|quota|expired|khóa|khoá|suspend/i;

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
    if (!isBankLookupConfigured()) return { status: 'unavailable', reason: 'not_configured' };

    const accountNumber = params.accountNumber.replace(/\D/g, '');
    if (accountNumber.length < 6 || accountNumber.length > 19) {
        return { status: 'not_found', code: 'invalid_length', message: 'Số tài khoản phải có từ 6 đến 19 chữ số.' };
    }
    if (!/^\d{6}$/.test(params.bin)) {
        return { status: 'not_found', code: 'invalid_bin', message: 'Mã ngân hàng không hợp lệ.' };
    }

    // This provider keys on the bank's short code, not the BIN the rest of the
    // system carries. Failing to resolve it is our problem, not the seller's.
    let bankCode: string | null;
    try {
        bankCode = await bankCodeForBin(params.bin);
    } catch (error) {
        console.error('[BankLookup] Bank directory unavailable:', error);
        return { status: 'unavailable', reason: 'bank_directory' };
    }
    if (!bankCode) {
        return { status: 'not_found', code: 'unknown_bin', message: 'Ngân hàng này chưa được hỗ trợ tra cứu.' };
    }

    const url = `${LOOKUP_URL}?bank_code=${encodeURIComponent(bankCode)}&bank_number=${encodeURIComponent(accountNumber)}`;

    let response: Response;
    try {
        response = await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey()}` },
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
        if (!response.ok) return { status: 'unavailable', reason: `upstream_${response.status}` };
        return { status: 'unavailable', reason: 'bad_response' };
    }

    const message = typeof body.message === 'string' ? body.message : '';

    // Log verbatim. A generic "provider refused" is what turned an out-of-credit
    // account into a timeout hunt on the KYC side; the operator needs the reason
    // the provider actually gave, even though the seller must never see it.
    if (response.status === 401 || response.status === 403) {
        console.error(`[BankLookup] Rejected by provider (HTTP ${response.status}): ${message}`);
        return { status: 'unavailable', reason: 'unauthorized' };
    }
    if (response.status === 402 || OPERATOR_FAULT.test(message)) {
        console.error(`[BankLookup] Account cannot pay for lookups: ${message}`);
        return { status: 'unavailable', reason: 'insufficient_balance' };
    }
    if (response.status === 429) {
        return { status: 'unavailable', reason: 'rate_limited' };
    }
    if (response.status >= 500) {
        console.error(`[BankLookup] Provider error HTTP ${response.status}: ${message}`);
        return { status: 'unavailable', reason: `upstream_${response.status}` };
    }

    const data = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>;
    const accountName = typeof data.accountName === 'string' ? data.accountName.trim() : '';

    if (body.status === 'success' && accountName) {
        return { status: 'ok', accountName };
    }

    // Anything left is a definite answer about this account number.
    return {
        status: 'not_found',
        code: String(body.code ?? response.status),
        message: message || 'Không tra cứu được tài khoản này.',
    };
}
