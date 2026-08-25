import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getKycProvider } from '@/lib/kyc';
import type { KycStatus } from '@/lib/kyc';
import { toKycSessionDecisionUpdate } from '@/lib/kyc/session-decision';
import { notifyKycIdentityApproved } from '@/lib/kyc/identity-notification';

/** Sessions a user may open per hour. Each one costs a provider credit. */
const MAX_SESSIONS_PER_HOUR = 5;

/** Marks a failure that happened after the provider session was already created. */
class PersistenceError extends Error {}

type KycSessionRow = {
    id: string;
    provider: string;
    provider_session_id: string;
    session_url: string | null;
    locale: string;
    status: string;
    verified_full_name: string | null;
    consumed_at: string | null;
    created_at: string;
    identity_email_sent_at: string | null;
};

/**
 * How long this handler will wait on the provider before giving up and
 * answering with the stored status.
 *
 * The browser polls this endpoint every few seconds, and the provider call is
 * only a fallback for a webhook that has not arrived yet — so it must never
 * spend the whole function budget. Netlify stops a function at 10s, and a
 * timeout there reaches the browser as an HTML 502 rather than a JSON reply.
 */
const POLL_PROVIDER_BUDGET_MS = 4_000;

/** Resolves to null rather than waiting past the budget. */
function withBudget<T>(work: Promise<T>): Promise<T | null> {
    return Promise.race([
        work,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), POLL_PROVIDER_BUDGET_MS)),
    ]);
}

const SESSION_COLUMNS =
    'id, provider, provider_session_id, session_url, locale, status, verified_full_name, consumed_at, created_at, identity_email_sent_at';

/**
 * Statuses where the user still has work to do at the provider, so the same
 * hosted session can simply be resumed. Terminal statuses (Declined, Expired,
 * Abandoned, Kyc Expired) must start a fresh one.
 */
const RESUMABLE_STATUSES = ['Not Started', 'In Progress', 'Awaiting User'];

const POLLABLE_STATUSES: readonly KycStatus[] = ['Not Started', 'In Progress', 'In Review'];

/** Provider sessions do not live forever; past this we start a new one. */
const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;

/** Fields safe to hand back to a browser — never the decision payload. */
function toClientShape(row: KycSessionRow) {
    return {
        id: row.id,
        provider: row.provider,
        status: row.status,
        verified_full_name: row.verified_full_name,
        consumed: !!row.consumed_at,
        created_at: row.created_at,
    };
}

// POST: open a hosted identity-verification session and return its URL.
export async function POST(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const service = createServiceSupabaseClient();
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        // Both pre-checks are independent, so pay for one round trip rather
        // than two. This handler already spends its latency budget on auth,
        // the provider call and the insert; on a cold start the serial version
        // can push the whole function past the platform timeout.
        const [existingResult, rateResult, latestResult] = await Promise.all([
            service
                .from('seller_verifications')
                .select('status')
                .eq('user_id', user.id)
                .maybeSingle(),
            service
                .from('kyc_sessions')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', user.id)
                .gte('created_at', oneHourAgo),
            service
                .from('kyc_sessions')
                .select(SESSION_COLUMNS)
                .eq('user_id', user.id)
                .is('consumed_at', null)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
        ]);

        const existing = existingResult.data as { status: string } | null;
        const count = rateResult.count;
        const latest = latestResult.data as KycSessionRow | null;

        // Already an approved seller — nothing to verify.
        if (existing?.status === 'approved') {
            return NextResponse.json({ error: 'Tài khoản đã được xác minh.' }, { status: 400 });
        }
        if (existing?.status === 'pending') {
            return NextResponse.json({ error: 'Hồ sơ đang chờ duyệt.' }, { status: 400 });
        }

        if (latest?.status === 'In Review') {
            return NextResponse.json({
                code: 'kyc_under_review',
                session: toClientShape(latest),
            }, { status: 409 });
        }

        // Resume an unfinished session rather than opening another one. The
        // user backing out of the provider's page and clicking again is the
        // normal case, and creating a second session there costs a credit and
        // can collide with this one: the provider deduplicates by vendor_data,
        // so it may hand back the session we already hold.
        if (
            latest?.session_url &&
            RESUMABLE_STATUSES.includes(latest.status) &&
            Date.now() - new Date(latest.created_at).getTime() < RESUME_WINDOW_MS
        ) {
            return NextResponse.json({
                session: toClientShape(latest),
                url: latest.session_url,
                resumed: true,
            });
        }

        // Rate limit in the database, not in memory: this runs on serverless
        // where each instance would otherwise keep its own counter.
        if ((count ?? 0) >= MAX_SESSIONS_PER_HOUR) {
            return NextResponse.json(
                { error: 'Bạn đã mở quá nhiều phiên xác minh. Vui lòng thử lại sau 1 giờ.' },
                { status: 429 }
            );
        }

        const body = await request.json().catch(() => ({} as Record<string, unknown>));
        const language = typeof body?.language === 'string' ? body.language : 'vi';
        const locale = language === 'ja' ? 'ja-JP' : language === 'en' ? 'en-US' : 'vi-VN';
        const expectedFullName = typeof body?.full_name === 'string' ? body.full_name : null;

        const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
        const provider = getKycProvider();

        const session = await provider.createSession({
            userId: user.id,
            callbackUrl: `${origin}/sell/kyc/callback`,
            language,
            email: user.email,
            expectedFullName,
        });

        // Upsert, not insert: the provider deduplicates by vendor_data, so it
        // can legitimately return a session id we already store. Treat that as
        // the same session rather than a conflict.
        const { data: row, error: upsertError } = await service
            .from('kyc_sessions')
            .upsert({
                user_id: user.id,
                provider: provider.name,
                provider_session_id: session.providerSessionId,
                session_url: session.url,
                locale,
                workflow_id: session.workflowId,
                status: session.status,
            } as never, { onConflict: 'provider,provider_session_id' })
            .select(SESSION_COLUMNS)
            .single() as { data: KycSessionRow | null; error: { message?: string } | null };

        if (upsertError || !row) {
            // The provider session already exists at this point, so a failure
            // here costs a verification credit. Almost always a missing table
            // (migration not applied) or a bad service-role key.
            throw new PersistenceError(upsertError?.message || 'Failed to persist KYC session');
        }

        return NextResponse.json({ session: toClientShape(row), url: session.url });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal server error';

        // Classify without leaking specifics. The operator needs to know which
        // of the three things to go fix; the browser must not learn key names,
        // provider responses, or database schema.
        const code =
            error instanceof PersistenceError ? 'persistence_error'
                : /is not configured/.test(message) ? 'config_error'
                    : 'provider_error';

        const hint = {
            config_error: 'Thiếu biến môi trường Didit trên server.',
            provider_error: 'Nhà cung cấp xác minh từ chối yêu cầu.',
            persistence_error: 'Không ghi được phiên vào cơ sở dữ liệu.',
        }[code];

        console.error(`[KYC] Create session failed (${code}):`, message);
        return NextResponse.json(
            { error: `Không thể khởi tạo phiên xác minh. ${hint}`, code },
            { status: 502 }
        );
    }
}

/**
 * GET: latest session status for the signed-in user.
 *
 * The browser polls this instead of reading `kyc_sessions` directly — the table
 * has no grants for `authenticated`, so the decision payload (document images,
 * MRZ, scores) can never be pulled client-side.
 */
export async function GET() {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const service = createServiceSupabaseClient();
        const { data: row } = await service
            .from('kyc_sessions')
            .select(SESSION_COLUMNS)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle() as { data: KycSessionRow | null };

        if (!row) return NextResponse.json({ session: null });

        // Webhooks can be delayed or lost. If the user is back on our callback
        // page and the session is still open, ask the provider directly rather
        // than leaving the UI spinning.
        if (POLLABLE_STATUSES.includes(row.status as KycStatus)) {
            try {
                const provider = getKycProvider();
                const decision = await withBudget(provider.getDecision(row.provider_session_id));
                if (decision && decision.status !== row.status) {
                    const { data: updated } = await service
                        .from('kyc_sessions')
                        .update(toKycSessionDecisionUpdate(decision) as never)
                        .eq('id', row.id)
                        .select(SESSION_COLUMNS)
                        .single() as { data: KycSessionRow | null };
                    if (updated) {
                        if (updated.status === 'Approved') {
                            await notifyKycIdentityApproved({
                                service,
                                sessionId: updated.id,
                                userEmail: user.email,
                            });
                        }
                        return NextResponse.json({ session: toClientShape(updated) });
                    }
                }
            } catch (pollError) {
                // Non-fatal: fall through and report the stored status.
                console.warn('[KYC] Status poll failed:', pollError);
            }
        }

        // Only when the handoff has not been delivered yet. This branch used to
        // run on every poll, re-reading the session and re-upserting the
        // notification long after the email had gone out.
        if (row.status === 'Approved' && !row.identity_email_sent_at) {
            await notifyKycIdentityApproved({
                service,
                sessionId: row.id,
                userEmail: user.email,
            });
        }

        return NextResponse.json({ session: toClientShape(row) });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        console.error('[KYC] Get session failed:', message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
