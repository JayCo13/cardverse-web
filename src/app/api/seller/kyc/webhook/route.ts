import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getKycProvider, TERMINAL_KYC_STATUSES } from '@/lib/kyc';
import type { KycStatus } from '@/lib/kyc';
import { DECISION_BEARING_KYC_STATUSES, toKycSessionDecisionUpdate } from '@/lib/kyc/session-decision';
import { notifyKycIdentityApproved } from '@/lib/kyc/identity-notification';

// Signature verification needs the byte-exact body, so this route must never
// be cached or statically optimised.
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    const rawBody = await request.text();

    const provider = getKycProvider();
    const event = provider.parseWebhook(rawBody, request.headers);

    // parseWebhook returns null for a bad signature, a stale timestamp, or a
    // malformed payload. Answer the same way for all three — a caller that
    // cannot sign should learn nothing about which check rejected it.
    if (!event) {
        console.warn('[KYC Webhook] Rejected: signature verification failed');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = createServiceSupabaseClient();

    const { data: session, error: lookupError } = await service
        .from('kyc_sessions')
        .select('id, user_id, status, consumed_at')
        .eq('provider', provider.name)
        .eq('provider_session_id', event.providerSessionId)
        .maybeSingle() as {
            data: { id: string; user_id: string; status: string; consumed_at: string | null } | null;
            error: { message?: string } | null;
        };

    // A query error is not the same as "no such session" — a missing table or
    // a broken service key would otherwise be acknowledged and dropped, and the
    // provider would never retry. Fail loudly so it does.
    if (lookupError) {
        console.error('[KYC Webhook] Session lookup failed:', lookupError);
        return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
    }

    if (!session) {
        // A session we never created, or one from another environment sharing
        // the destination. Acknowledge so the provider stops retrying.
        console.warn(`[KYC Webhook] Unknown session ${event.providerSessionId}`);
        return NextResponse.json({ acknowledged: true });
    }

    // vendor_data is set by us at creation time and echoed back signed. A
    // mismatch means the event does not belong to this row.
    if (event.vendorData && event.vendorData !== session.user_id) {
        console.error(
            `[KYC Webhook] vendor_data mismatch for session ${event.providerSessionId}: ` +
            `expected ${session.user_id}, got ${event.vendorData}`
        );
        return NextResponse.json({ acknowledged: true });
    }

    // Terminal statuses are final; a late or replayed event must not reopen
    // them, and a consumed session must never be mutated after redemption.
    if (TERMINAL_KYC_STATUSES.includes(session.status as KycStatus) || session.consumed_at) {
        return NextResponse.json({ acknowledged: true });
    }

    const update: Record<string, unknown> = { status: event.status };

    if (DECISION_BEARING_KYC_STATUSES.includes(event.status)) {
        try {
            // Fetch rather than trust the webhook body: the GET is authenticated
            // with our API key and returns the full, current decision.
            const decision = await provider.getDecision(event.providerSessionId);
            Object.assign(update, toKycSessionDecisionUpdate(decision));
        } catch (error) {
            // Record the status change anyway and let the provider retry, or
            // let the GET /session poll fill in the decision later.
            console.error(`[KYC Webhook] Decision fetch failed for ${event.providerSessionId}:`, error);
        }
    }

    const { data: updatedSession, error: updateError } = await service
        .from('kyc_sessions')
        .update(update as never)
        .eq('id', session.id)
        // The submit RPC can consume the session after our lookup but before
        // this write obtains its row lock. Re-check here so a late webhook can
        // never mutate identity evidence after it granted seller rights.
        .is('consumed_at', null)
        .select('id') as {
            data: { id: string }[] | null;
            error: { message?: string } | null;
        };

    if (updateError) {
        // 5xx so the provider retries with backoff.
        console.error('[KYC Webhook] Failed to persist session update:', updateError);
        return NextResponse.json({ error: 'Failed to persist' }, { status: 500 });
    }

    if (!updatedSession?.length) {
        return NextResponse.json({ acknowledged: true });
    }

    if (update.status === 'Approved') {
        const deliveryStatus = await notifyKycIdentityApproved({
            service,
            sessionId: session.id,
        });
        if (deliveryStatus === 'retry_required') {
            // Do not acknowledge a transient notification/email failure. Didit
            // will retry this signed event, while the database claim prevents
            // concurrent attempts from sending duplicate emails.
            return NextResponse.json(
                { error: 'KYC completion delivery pending' },
                { status: 503 },
            );
        }
    }

    console.log(
        `[KYC Webhook] session=${event.providerSessionId} user=${session.user_id} status=${update.status}`
    );

    return NextResponse.json({ acknowledged: true });
}
