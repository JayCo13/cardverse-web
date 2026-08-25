import { hashDocumentNumber } from './index';
import type { KycDecision, KycStatus } from './types';

/** Provider statuses whose decision endpoint may contain identity evidence. */
export const DECISION_BEARING_KYC_STATUSES: readonly KycStatus[] = [
    'Approved',
    'Declined',
    'In Review',
    'Abandoned',
];

/**
 * Webhook delivery and browser-triggered reconciliation must persist the same
 * provider evidence. Otherwise a delayed webhook could approve a session
 * without the identity data needed by seller verification.
 */
export function toKycSessionDecisionUpdate(decision: KycDecision) {
    const { identity } = decision;

    return {
        status: decision.status,
        verified_full_name: identity.fullName,
        verified_dob: identity.dateOfBirth,
        verified_document_type: identity.documentType,
        verified_issuing_state: identity.issuingState,
        document_number_hash: hashDocumentNumber(identity.documentNumber),
        liveness_score: identity.livenessScore,
        face_match_score: identity.faceMatchScore,
        nfc_verified: identity.nfcVerified,
        warnings: identity.warnings,
        decision: decision.raw,
    };
}
