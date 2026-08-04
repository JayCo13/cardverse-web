/**
 * Vendor-agnostic identity-verification contract.
 *
 * Everything the app consumes is expressed here so swapping Didit for another
 * provider (FPT.AI / VNPT once a C06 connection is worth its contract, or
 * Shufti as a fallback) means writing one adapter, not touching route handlers.
 */

/** Provider session lifecycle. Mirrors Didit's status vocabulary verbatim. */
export type KycStatus =
    | 'Not Started'
    | 'In Progress'
    | 'Awaiting User'
    | 'Approved'
    | 'Declined'
    | 'In Review'
    | 'Resubmitted'
    | 'Abandoned'
    | 'Expired'
    | 'Kyc Expired';

/** Statuses past which the session can no longer become Approved. */
export const TERMINAL_KYC_STATUSES: readonly KycStatus[] = [
    'Declined',
    'Abandoned',
    'Expired',
    'Kyc Expired',
];

export interface CreateKycSessionInput {
    /** Our user id. Sent as vendor_data so webhooks are attributable. */
    userId: string;
    /** Where the provider returns the user once the flow finishes. */
    callbackUrl: string;
    /** ISO 639-1 UI language for the hosted flow. */
    language?: string;
    email?: string | null;
    /** Name the user typed, passed as a hint so the provider can cross-check. */
    expectedFullName?: string | null;
}

export interface CreatedKycSession {
    providerSessionId: string;
    /** Hosted verification URL the user is sent to. */
    url: string;
    status: KycStatus;
    workflowId: string | null;
}

/** Identity as attested by the provider — never by the client. */
export interface KycIdentity {
    fullName: string | null;
    /** ISO date (YYYY-MM-DD) or null when the provider could not read it. */
    dateOfBirth: string | null;
    documentNumber: string | null;
    documentType: string | null;
    issuingState: string | null;
    /** 0–100. Null when the workflow has no liveness step. */
    livenessScore: number | null;
    /** 0–100. Null when the workflow has no face-match step. */
    faceMatchScore: number | null;
    /** True only when the document chip was read and its integrity checked. */
    nfcVerified: boolean;
    /** Provider risk notes; surfaced to admins on flagged submissions. */
    warnings: KycWarning[];
}

export interface KycWarning {
    feature: string | null;
    risk: string | null;
    logType: string | null;
    shortDescription: string | null;
    longDescription: string | null;
}

export interface KycDecision {
    providerSessionId: string;
    status: KycStatus;
    identity: KycIdentity;
    /** Untouched provider payload, persisted for admin review and disputes. */
    raw: unknown;
}

/** Minimal, signature-verified envelope extracted from a provider webhook. */
export interface KycWebhookEvent {
    eventId: string | null;
    webhookType: string | null;
    providerSessionId: string;
    status: KycStatus;
    /** vendor_data — our user id, as sent at session creation. */
    vendorData: string | null;
}

export interface KycProvider {
    readonly name: string;
    createSession(input: CreateKycSessionInput): Promise<CreatedKycSession>;
    getDecision(providerSessionId: string): Promise<KycDecision>;
    /**
     * Verify the signature and return the event, or null when the signature,
     * timestamp, or payload shape is not acceptable. Never throws on bad input
     * so callers can answer 401 without leaking which check failed.
     */
    parseWebhook(rawBody: string, headers: Headers): KycWebhookEvent | null;
}
