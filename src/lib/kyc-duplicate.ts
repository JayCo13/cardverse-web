import type { SupabaseClient } from '@supabase/supabase-js';

export interface KycDuplicateResult {
    cccdDuplicate: boolean;
    bankDuplicate: boolean;
    matchedCount: number; // number of distinct OTHER accounts that matched
    notes: string | null; // human-readable summary (shown to admin)
}

const EMPTY: KycDuplicateResult = {
    cccdDuplicate: false,
    bankDuplicate: false,
    matchedCount: 0,
    notes: null,
};

async function matchingUserIds(
    service: SupabaseClient,
    userId: string,
    column: 'cccd_id_number' | 'bank_account_number' | 'document_number_hash',
    value: string
): Promise<string[]> {
    const { data, error } = await service
        .from('seller_verifications')
        .select('user_id')
        .eq(column, value)
        .neq('user_id', userId)
        .in('status', ['approved', 'pending']);

    if (error || !data) return [];
    return (data as Array<{ user_id: string }>).map((r) => r.user_id);
}

/**
 * Detect whether this CCCD / bank account is already used by ANOTHER account.
 * Must be called with the service-role client so RLS doesn't hide other users'
 * rows. Only matches against approved/pending verifications (active sellers).
 */
export async function findKycDuplicates(
    service: SupabaseClient,
    params: {
        userId: string;
        /** Legacy plaintext CCCD, still present on rows created before Didit. */
        cccdIdNumber?: string | null;
        /** Keyed hash of the document number from the identity provider. */
        documentNumberHash?: string | null;
        bankAccountNumber?: string | null;
    }
): Promise<KycDuplicateResult> {
    const cccd = (params.cccdIdNumber || '').trim();
    const hash = (params.documentNumberHash || '').trim();
    const bank = (params.bankAccountNumber || '').trim();
    if (!cccd && !hash && !bank) return EMPTY;

    const [cccdUsers, hashUsers, bankUsers] = await Promise.all([
        cccd ? matchingUserIds(service, params.userId, 'cccd_id_number', cccd) : Promise.resolve([]),
        hash ? matchingUserIds(service, params.userId, 'document_number_hash', hash) : Promise.resolve([]),
        bank ? matchingUserIds(service, params.userId, 'bank_account_number', bank) : Promise.resolve([]),
    ]);

    const documentUsers = [...cccdUsers, ...hashUsers];
    const cccdDuplicate = documentUsers.length > 0;
    const bankDuplicate = bankUsers.length > 0;
    if (!cccdDuplicate && !bankDuplicate) return EMPTY;

    const notes: string[] = [];
    if (cccdDuplicate) notes.push('Số giấy tờ đã được dùng ở một tài khoản khác.');
    if (bankDuplicate) notes.push('Số tài khoản ngân hàng đã được dùng ở một tài khoản khác.');

    return {
        cccdDuplicate,
        bankDuplicate,
        matchedCount: new Set([...documentUsers, ...bankUsers]).size,
        notes: notes.join(' '),
    };
}
