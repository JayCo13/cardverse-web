import type { SupabaseClient } from '@supabase/supabase-js';

/** Which identifier collided with another account. */
export type KycDuplicateAxis = 'document' | 'bank' | 'both';

export interface KycDuplicateResult {
    cccdDuplicate: boolean;
    bankDuplicate: boolean;
    matchedCount: number; // number of distinct OTHER accounts that matched
    /** The other accounts this collided with. Admin-only — never shown to the submitter. */
    matchedUserIds: string[];
    /** Null when nothing matched. */
    axis: KycDuplicateAxis | null;
    notes: string | null; // human-readable summary (shown to admin)
}

const EMPTY: KycDuplicateResult = {
    cccdDuplicate: false,
    bankDuplicate: false,
    matchedCount: 0,
    matchedUserIds: [],
    axis: null,
    notes: null,
};

async function matchingUserIds(
    service: SupabaseClient,
    userId: string,
    column: 'cccd_id_number' | 'bank_account_number_normalized' | 'document_number_hash',
    value: string
): Promise<string[]> {
    const { data, error } = await service
        .from('seller_verifications')
        .select('user_id')
        .eq(column, value)
        .neq('user_id', userId)
        .in('status', ['approved', 'pending']);

    // Surface the failure instead of reporting "no duplicates". A swallowed
    // error here would let a blocked identity through as if it were clean.
    if (error) throw error;
    return (data as Array<{ user_id: string }> | null || []).map((r) => r.user_id);
}

/**
 * Detect whether this CCCD / bank account is already used by ANOTHER account.
 * Must be called with the service-role client so RLS doesn't hide other users'
 * rows.
 *
 * Only `approved` and `pending` rows count — those are the statuses that
 * represent a *live* binding. A `rejected` row is deliberately ignored:
 * otherwise someone who mistyped a stranger's account number would lock that
 * stranger out of ever selling.
 *
 * The caller's own row is excluded, so re-submitting after a rejection with
 * one's own document and bank account always passes.
 */
export async function findKycDuplicates(
    service: SupabaseClient,
    params: {
        userId: string;
        /** Legacy plaintext CCCD, still present on rows created before Didit. */
        cccdIdNumber?: string | null;
        /** Keyed hash of the document number from the identity provider. */
        documentNumberHash?: string | null;
        /** Raw as typed; normalised to digits here before comparing. */
        bankAccountNumber?: string | null;
    }
): Promise<KycDuplicateResult> {
    const cccd = (params.cccdIdNumber || '').trim();
    const hash = (params.documentNumberHash || '').trim();
    // Digits only: the bank treats "1907 5664 8370 14" and "19075664837014" as
    // one account, so a space must not buy a second seller account.
    const bank = (params.bankAccountNumber || '').replace(/\D/g, '');
    if (!cccd && !hash && !bank) return EMPTY;

    const [cccdUsers, hashUsers, bankUsers] = await Promise.all([
        cccd ? matchingUserIds(service, params.userId, 'cccd_id_number', cccd) : Promise.resolve([]),
        hash ? matchingUserIds(service, params.userId, 'document_number_hash', hash) : Promise.resolve([]),
        bank ? matchingUserIds(service, params.userId, 'bank_account_number_normalized', bank) : Promise.resolve([]),
    ]);

    const documentUsers = [...cccdUsers, ...hashUsers];
    const cccdDuplicate = documentUsers.length > 0;
    const bankDuplicate = bankUsers.length > 0;
    if (!cccdDuplicate && !bankDuplicate) return EMPTY;

    const notes: string[] = [];
    if (cccdDuplicate) notes.push('Số giấy tờ đã được dùng ở một tài khoản khác.');
    if (bankDuplicate) notes.push('Số tài khoản ngân hàng đã được dùng ở một tài khoản khác.');

    const matchedUserIds = [...new Set([...documentUsers, ...bankUsers])];

    return {
        cccdDuplicate,
        bankDuplicate,
        matchedCount: matchedUserIds.length,
        matchedUserIds,
        axis: cccdDuplicate && bankDuplicate ? 'both' : cccdDuplicate ? 'document' : 'bank',
        notes: notes.join(' '),
    };
}
