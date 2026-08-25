import { createHmac } from 'crypto';
import { diditProvider } from './didit';
import type { KycIdentity, KycProvider } from './types';
import { namesMatch, normalizeVietnameseName } from '@/lib/kyc-verification';

export * from './types';

/**
 * Resolve the active identity provider. Adding FPT.AI / VNPT later means adding
 * a case here; nothing downstream of `KycProvider` needs to change.
 */
export function getKycProvider(): KycProvider {
    const name = process.env.KYC_PROVIDER || 'didit';
    switch (name) {
        case 'didit':
            return diditProvider;
        default:
            throw new Error(`Unsupported KYC_PROVIDER: ${name}`);
    }
}

/**
 * Keyed hash of a document number.
 *
 * Duplicate detection only ever needs equality, so we store an HMAC instead of
 * the CCCD itself: a database leak then exposes no national ID numbers, and the
 * hash is useless without KYC_DOCUMENT_HASH_SECRET. Keyed (not plain SHA-256)
 * because the CCCD keyspace is small enough to enumerate.
 */
export function hashDocumentNumber(documentNumber: string | null | undefined): string | null {
    const value = (documentNumber || '').replace(/\s+/g, '').toUpperCase();
    if (!value) return null;

    const secret = process.env.KYC_DOCUMENT_HASH_SECRET;
    if (!secret) throw new Error('KYC_DOCUMENT_HASH_SECRET is not configured');

    return createHmac('sha256', secret).update(value).digest('hex');
}

export interface KycAcceptancePolicy {
    minLivenessScore: number;
    minFaceMatchScore: number;
}

export const DEFAULT_ACCEPTANCE_POLICY: KycAcceptancePolicy = {
    minLivenessScore: Number(process.env.KYC_MIN_LIVENESS_SCORE ?? 70),
    minFaceMatchScore: Number(process.env.KYC_MIN_FACE_MATCH_SCORE ?? 70),
};

/**
 * Reasons a decision cannot be auto-approved. Empty array means the submission
 * may skip manual review. Anything returned here is shown to the admin.
 */
export function evaluateIdentity(
    identity: KycIdentity,
    policy: KycAcceptancePolicy = DEFAULT_ACCEPTANCE_POLICY,
    evidence?: { hasDocumentNumberHash?: boolean }
): string[] {
    const flags: string[] = [];

    if (!identity.fullName) {
        flags.push('Nhà cung cấp không đọc được họ tên trên giấy tờ.');
    }
    // Provider-backed sessions deliberately discard the raw document number
    // after hashing it. A keyed hash proves the provider read a document
    // number without retaining the national identifier itself.
    if (!identity.documentNumber && !evidence?.hasDocumentNumberHash) {
        flags.push('Nhà cung cấp không đọc được số giấy tờ.');
    }

    // Scores are optional: a workflow without a liveness node returns null, and
    // that is a configuration question, not a fraud signal. Only an explicit
    // low score blocks auto-approval.
    if (identity.livenessScore !== null && identity.livenessScore < policy.minLivenessScore) {
        flags.push(`Điểm liveness thấp (${identity.livenessScore}/${policy.minLivenessScore}).`);
    }
    if (identity.faceMatchScore !== null && identity.faceMatchScore < policy.minFaceMatchScore) {
        flags.push(`Điểm khớp khuôn mặt thấp (${identity.faceMatchScore}/${policy.minFaceMatchScore}).`);
    }

    for (const warning of identity.warnings) {
        if (warning.logType === 'warning') {
            flags.push(warning.shortDescription || warning.risk || 'Cảnh báo rủi ro từ nhà cung cấp.');
        }
    }

    return flags;
}

/**
 * Names must agree across three places before money can move: the identity
 * document, what the user typed, and the bank account holder. Compared after
 * stripping diacritics and case, which is how Vietnamese bank apps render them.
 */
export function checkNameConsistency(params: {
    verifiedName: string | null;
    submittedName: string;
    bankAccountName: string;
}): { matches: boolean; flags: string[] } {
    const verified = params.verifiedName || '';
    const flags: string[] = [];

    if (!normalizeVietnameseName(verified)) {
        return { matches: false, flags: ['Không có tên đã xác minh để đối chiếu.'] };
    }
    if (!namesMatch(params.submittedName, verified)) {
        flags.push('Họ tên đăng ký không khớp với giấy tờ đã xác minh.');
    }
    if (!namesMatch(params.bankAccountName, verified)) {
        flags.push('Tên chủ tài khoản ngân hàng không khớp với giấy tờ đã xác minh.');
    }

    return { matches: flags.length === 0, flags };
}
