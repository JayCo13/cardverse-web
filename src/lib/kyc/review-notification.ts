import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminNotificationEmails } from '@/lib/admin-recipients';
import { sendKycManualReviewToAdmin } from '@/lib/mail';
import type { Database } from '@/lib/supabase/database.types';
import type { KycWarning } from './types';

type ServiceClient = SupabaseClient<Database>;

type ReviewAlertClaim = {
    user_id: string;
    provider: string;
    provider_session_id: string;
    verified_full_name: string | null;
    locale: string;
    warnings: KycWarning[] | null;
};

export type KycReviewAlertStatus =
    | 'delivered'
    | 'already_delivered'
    | 'not_applicable'
    | 'retry_required';

/**
 * True when the database has no such function.
 *
 * PostgREST reports it as PGRST202 before it ever reaches Postgres; 42883 is
 * what Postgres itself raises when the schema cache is stale enough to let the
 * call through.
 */
function isMissingFunction(error: { code?: string | null; message?: string | null }) {
    return error.code === 'PGRST202'
        || error.code === '42883'
        || /could not find the function|does not exist/i.test(error.message || '');
}

/**
 * Render the provider's warnings as the lines a reviewer actually needs.
 *
 * Falls back through the fields Didit populates inconsistently between
 * features, so a warning is never reduced to an empty bullet.
 */
function describeWarnings(warnings: KycWarning[] | null): string[] {
    if (!Array.isArray(warnings)) return [];
    return warnings
        .map((warning) => {
            const label = warning.shortDescription || warning.longDescription || warning.risk;
            if (!label) return null;
            return warning.feature ? `${warning.feature}: ${label}` : label;
        })
        .filter((line): line is string => !!line);
}

/**
 * Tell the review team that a session needs a human decision in the provider's
 * console.
 *
 * Claimed in the database rather than guarded in memory: the webhook and the
 * browser's status poll both observe the move to 'In Review', and on
 * serverless they can observe it concurrently on different instances. The claim
 * is what stops the team getting the same alert twice.
 *
 * Never throws. A failed alert leaves the claim released and the session
 * unmarked, so the next observer retries it.
 */
export async function notifyKycNeedsManualReview(input: {
    service: ServiceClient;
    sessionId: string;
    /** Saves a lookup when the caller already knows it. */
    userEmail?: string | null;
}): Promise<KycReviewAlertStatus> {
    const { service, sessionId } = input;

    const { data: claimData, error: claimError } = await service.rpc(
        'claim_kyc_review_alert' as never,
        { p_session_id: sessionId } as never,
    );
    if (claimError) {
        // A missing function is a deploy that ran ahead of its migration, and
        // it will not fix itself on retry. Reporting it as retryable would make
        // the webhook answer 503 to every 'In Review' event and leave Didit
        // redelivering the same one indefinitely.
        if (isMissingFunction(claimError)) {
            console.error(
                '[KYC] claim_kyc_review_alert is missing — apply migration ' +
                '20260826000100_kyc_manual_review_alert.sql. No review alert sent.',
            );
            return 'not_applicable';
        }
        console.error('[KYC] Failed to claim manual-review alert:', claimError);
        return 'retry_required';
    }

    // No row means the claim did not apply: the session left 'In Review', was
    // consumed, the alert already went out, or another request holds it.
    const claim = (claimData as ReviewAlertClaim[] | null)?.[0];
    if (!claim) return 'not_applicable';

    let userEmail = input.userEmail || null;
    if (!userEmail) {
        const { data, error } = await service.auth.admin.getUserById(claim.user_id);
        if (error) console.error('[KYC] Failed to resolve seller email for review alert:', error);
        userEmail = data.user?.email || null;
    }

    const adminEmails = await getAdminNotificationEmails();
    const delivered = await sendKycManualReviewToAdmin({
        fullName: claim.verified_full_name,
        userEmail,
        providerSessionId: claim.provider_session_id,
        warnings: describeWarnings(claim.warnings),
        adminEmails,
    });

    if (delivered) {
        const { error } = await service
            .from('kyc_sessions')
            .update({
                review_alert_sent_at: new Date().toISOString(),
                review_alert_sending_at: null,
            } as never)
            .eq('id', sessionId);
        if (error) {
            console.error('[KYC] Failed to mark review alert delivered:', error);
            return 'retry_required';
        }
        return 'delivered';
    }

    // Release the claim so the next webhook retry or poll can try again,
    // rather than leaving it held for the full five-minute reclaim window.
    const { error: releaseError } = await service
        .from('kyc_sessions')
        .update({ review_alert_sending_at: null } as never)
        .eq('id', sessionId)
        .is('review_alert_sent_at', null);
    if (releaseError) console.error('[KYC] Failed to release review alert claim:', releaseError);

    return 'retry_required';
}
