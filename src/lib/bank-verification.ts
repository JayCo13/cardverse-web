import type { SupabaseClient } from '@supabase/supabase-js';
import { lookupBankAccountName, type BankLookupResult } from './bank-lookup';
import { namesMatch, normalizeVietnameseName } from './kyc-verification';

/**
 * Lookups a single user may trigger per hour.
 *
 * The limit exists because each call that reaches NAPAS is billed. Calls that
 * never got there are not counted — see the query below.
 */
const MAX_LOOKUPS_PER_HOUR = 15;

/** How long a successful lookup stands in for a fresh call. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type VerifiedBankAccount = BankLookupResult & { cached: boolean };

/**
 * Resolve an account holder through NAPAS, with a database-backed rate limit
 * and cache.
 *
 * Must be called with the service client: `bank_account_lookups` has no grants
 * for `authenticated`, so a browser can neither read a cached result nor forge
 * one. Every failure is a returned status, never a throw — a lookup outage
 * should route a seller to manual review, not lock them out.
 */
export async function verifyBankAccount(
    service: SupabaseClient,
    params: { userId: string; bin: string; accountNumber: string }
): Promise<VerifiedBankAccount> {
    const accountNumber = params.accountNumber.replace(/\D/g, '');

    // Reuse a recent successful answer for the same account. Account ownership
    // effectively never changes, and this keeps resubmissions off the quota.
    const cacheFloor = new Date(Date.now() - CACHE_TTL_MS).toISOString();
    const { data: cached } = await service
        .from('bank_account_lookups')
        .select('account_name')
        .eq('bin', params.bin)
        .eq('account_number', accountNumber)
        .eq('status', 'ok')
        .gte('created_at', cacheFloor)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle() as { data: { account_name: string | null } | null };

    if (cached?.account_name) {
        return { status: 'ok', accountName: cached.account_name, cached: true };
    }

    // Count only the attempts that actually reached the network.
    //
    // Every outcome is logged, including `unavailable` — our own failures: no
    // credit on the provider account, a missing key, a timeout. Counting those
    // against the seller meant an outage spent their hourly allowance on calls
    // that were never billed and never answered, and then locked them out of
    // retrying once it was fixed. Ten of the fifteen lookups on record are that
    // kind of failure.
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await service
        .from('bank_account_lookups')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', params.userId)
        .neq('status', 'unavailable')
        .gte('created_at', hourAgo);

    if ((count ?? 0) >= MAX_LOOKUPS_PER_HOUR) {
        return { status: 'unavailable', reason: 'rate_limited', cached: false };
    }

    const result = await lookupBankAccountName({ bin: params.bin, accountNumber });

    // Log every outcome, including failures: the count above is what makes the
    // rate limit real, and repeated not_found attempts are worth seeing.
    const { error: logError } = await service
        .from('bank_account_lookups')
        .insert({
            user_id: params.userId,
            bin: params.bin,
            account_number: accountNumber,
            status: result.status,
            account_name: result.status === 'ok' ? result.accountName : null,
            provider_code: result.status === 'not_found' ? result.code : null,
        } as never);

    if (logError) console.error('[Bank] Failed to log lookup:', logError);

    return { ...result, cached: false };
}

export interface BankNameCheck {
    /** True only when NAPAS confirmed the holder and it matches the identity. */
    matches: boolean;
    /** Reasons the user must fix something and re-submit. */
    flags: string[];
    /** Holder name as returned by the network, when there was one. */
    verifiedAccountName: string | null;
}

/**
 * Compare the account holder NAPAS reported against the name on the verified
 * identity document. Compared after stripping diacritics and case, which is
 * how both banking systems and Vietnamese ID documents render names.
 */
export function checkBankAccountHolder(params: {
    lookup: VerifiedBankAccount;
    identityName: string | null;
}): BankNameCheck {
    const identity = normalizeVietnameseName(params.identityName || '');

    if (params.lookup.status === 'unavailable') {
        return {
            matches: false,
            verifiedAccountName: null,
            flags: ['Hệ thống tra cứu ngân hàng đang bận, vui lòng thử lại sau vài phút.'],
        };
    }

    if (params.lookup.status === 'not_found') {
        return {
            matches: false,
            verifiedAccountName: null,
            flags: [`Ngân hàng không tìm thấy tài khoản này: ${params.lookup.message}`],
        };
    }

    if (!identity) {
        return {
            matches: false,
            verifiedAccountName: params.lookup.accountName,
            flags: ['Không có tên đã xác minh để đối chiếu với chủ tài khoản.'],
        };
    }

    if (!namesMatch(params.lookup.accountName, params.identityName || '')) {
        return {
            matches: false,
            verifiedAccountName: params.lookup.accountName,
            flags: [
                `Chủ tài khoản ngân hàng ("${params.lookup.accountName}") không khớp với giấy tờ đã xác minh.`,
            ],
        };
    }

    return { matches: true, verifiedAccountName: params.lookup.accountName, flags: [] };
}
