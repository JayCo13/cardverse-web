import type { SupabaseClient } from '@supabase/supabase-js';
import { translations } from '@/lib/i18n';
import { sendKYCIdentityApproved } from '@/lib/mail';
import type { SupportedLocale } from '@/lib/request-localization';
import type { Database } from '@/lib/supabase/database.types';

type ServiceClient = SupabaseClient<Database>;

type IdentitySession = {
    id: string;
    user_id: string;
    status: string;
    consumed_at: string | null;
    identity_email_sent_at: string | null;
};

type EmailClaim = {
    user_id: string;
    verified_full_name: string | null;
    locale: string;
};

export type KycIdentityDeliveryStatus =
    | 'delivered'
    | 'already_delivered'
    | 'not_applicable'
    | 'retry_required';

function supportedLocale(value: string): SupportedLocale {
    if (value === 'en-US' || value === 'ja-JP') return value;
    return 'vi-VN';
}

/**
 * Deliver the post-Didit handoff once per provider session.
 *
 * The database unique key makes the in-app notification idempotent. Email has
 * a separate atomic claim so a webhook retry and browser reconciliation cannot
 * send two copies concurrently; a failed/stale claim remains retryable.
 */
export async function notifyKycIdentityApproved(input: {
    service: ServiceClient;
    sessionId: string;
    userEmail?: string | null;
}): Promise<KycIdentityDeliveryStatus> {
    const { service, sessionId } = input;
    const { data: session, error: sessionError } = await service
        .from('kyc_sessions')
        .select('id, user_id, status, consumed_at, identity_email_sent_at')
        .eq('id', sessionId)
        .maybeSingle() as { data: IdentitySession | null; error: { message?: string } | null };

    if (sessionError) {
        console.error('[KYC] Could not load identity notification session:', sessionError);
        return 'retry_required';
    }
    if (!session || session.status !== 'Approved' || session.consumed_at) {
        return 'not_applicable';
    }

    const fallback = translations['en-US'];
    const { error: notificationError } = await service
        .from('notifications')
        .upsert({
            user_id: session.user_id,
            type: 'kyc_identity_approved',
            title: fallback.notification_kyc_identity_approved_title,
            message: fallback.notification_kyc_identity_approved_message,
            kyc_session_id: session.id,
            read: false,
        } as never, {
            onConflict: 'kyc_session_id,type',
            ignoreDuplicates: true,
        });

    if (notificationError) {
        console.error('[KYC] Failed to create identity-complete notification:', notificationError);
    }

    if (session.identity_email_sent_at) {
        return notificationError ? 'retry_required' : 'already_delivered';
    }

    const { data: claimData, error: claimError } = await service.rpc(
        'claim_kyc_identity_email' as never,
        { p_session_id: session.id } as never,
    );
    if (claimError) {
        console.error('[KYC] Failed to claim identity-complete email:', claimError);
        return 'retry_required';
    }

    const claim = (claimData as EmailClaim[] | null)?.[0];
    // Another request currently owns the delivery claim. A webhook must ask
    // the provider to retry until that owner either marks the email sent or
    // releases/fails the claim; GET callers simply ignore this status.
    if (!claim) return 'retry_required';

    let userEmail = input.userEmail || null;
    if (!userEmail) {
        const { data, error } = await service.auth.admin.getUserById(claim.user_id);
        if (error) console.error('[KYC] Failed to resolve identity email recipient:', error);
        userEmail = data.user?.email || null;
    }

    const delivered = !!userEmail && await sendKYCIdentityApproved(
        userEmail,
        claim.verified_full_name || userEmail,
        supportedLocale(claim.locale),
    );

    if (delivered) {
        const { error } = await service
            .from('kyc_sessions')
            .update({
                identity_email_sent_at: new Date().toISOString(),
                identity_email_sending_at: null,
            } as never)
            .eq('id', session.id);
        if (error) console.error('[KYC] Failed to mark identity email delivered:', error);
        if (error) return 'retry_required';
        return notificationError ? 'retry_required' : 'delivered';
    }

    const { error: releaseError } = await service
        .from('kyc_sessions')
        .update({ identity_email_sending_at: null } as never)
        .eq('id', session.id)
        .is('identity_email_sent_at', null);
    if (releaseError) console.error('[KYC] Failed to release identity email claim:', releaseError);
    return 'retry_required';
}
