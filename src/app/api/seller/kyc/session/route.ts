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

/** Marks a step that ran out of the handler's own time budget. */
class DeadlineError extends Error {}

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

/**
 * Wall clock this handler allows itself, kept under Netlify's 10s function
 * timeout with room for the platform's own overhead.
 *
 * Every await below is billed against it. Bounding only the provider call is
 * not enough: auth, three database round trips and the provider's own 7s
 * ceiling add up past 10s on a cold start, and the function is then killed
 * mid-flight — which reaches the browser as an HTML 502 that no JSON error
 * handling can read.
 */
const FUNCTION_BUDGET_MS = 8_500;

/** Reserved out of the budget for the auth round trip. */
const AUTH_BUDGET_MS = 2_500;

/** Reserved out of the budget for the pre-checks. */
const PRECHECK_BUDGET_MS = 2_500;

/** Kept back so the session can still be written after the provider answers. */
const PERSIST_RESERVE_MS = 1_500;

/** Under this there is no point starting a provider call. */
const MIN_PROVIDER_BUDGET_MS = 1_500;

/** Cap on the approval handoff, which sends mail on a shared connection. */
const NOTIFY_BUDGET_MS = 3_000;

/** Resolves to null rather than waiting past the budget. */
function withBudget<T>(work: Promise<T>, budgetMs: number = POLL_PROVIDER_BUDGET_MS): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), budgetMs);
    });
    return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
}

/** Same, but an expired budget is an error rather than a missing value. */
async function withDeadline<T>(work: Promise<T>, budgetMs: number, step: string): Promise<T> {
    const result = await withBudget(work.then((value) => ({ value })), budgetMs);
    if (!result) throw new DeadlineError(`${step} exceeded ${budgetMs}ms`);
    return result.value;
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
    const startedAt = Date.now();
    const remainingMs = () => FUNCTION_BUDGET_MS - (Date.now() - startedAt);

    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await withDeadline(
            supabase.auth.getUser(),
            AUTH_BUDGET_MS,
            'auth.getUser'
        );
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const service = createServiceSupabaseClient();
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        // Both pre-checks are independent, so pay for one round trip rather
        // than two. This handler already spends its latency budget on auth,
        // the provider call and the insert; on a cold start the serial version
        // can push the whole function past the platform timeout.
        const [existingResult, rateResult, latestResult] = await withDeadline(Promise.all([
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
        ]), PRECHECK_BUDGET_MS, 'kyc pre-checks');

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

        // Hand the adapter what is actually left rather than letting it spend
        // its own fixed ceiling: everything above has already been billed
        // against the same function timeout, and the write below still needs
        // its share.
        const providerBudgetMs = remainingMs() - PERSIST_RESERVE_MS;
        if (providerBudgetMs < MIN_PROVIDER_BUDGET_MS) {
            throw new DeadlineError(`no time left for the provider call (${providerBudgetMs}ms)`);
        }

        const session = await provider.createSession({
            userId: user.id,
            callbackUrl: `${origin}/sell/kyc/callback`,
            language,
            email: user.email,
            expectedFullName,
            timeoutMs: providerBudgetMs,
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
        // of the four things to go fix; the browser must not learn key names,
        // provider responses, or database schema.
        const code =
            error instanceof PersistenceError ? 'persistence_error'
                : error instanceof DeadlineError || /timed out after/.test(message) ? 'timeout_error'
                    : /is not configured/.test(message) ? 'config_error'
                        : 'provider_error';

        const hint = {
            config_error: 'Thiếu biến môi trường Didit trên server.',
            provider_error: 'Nhà cung cấp xác minh từ chối yêu cầu.',
            persistence_error: 'Không ghi được phiên vào cơ sở dữ liệu.',
            timeout_error: 'Hệ thống phản hồi quá chậm. Vui lòng thử lại sau ít phút.',
        }[code];

        // A timeout is the caller's to retry, and it is the one failure the
        // platform would otherwise report as an unreadable HTML 502 — answer it
        // as 504 so the browser can tell "try again" from "go fix the server".
        const status = code === 'timeout_error' ? 504 : 502;

        console.error(
            `[KYC] Create session failed (${code}) after ${Date.now() - startedAt}ms:`,
            message
        );
        return NextResponse.json(
            { error: `Không thể khởi tạo phiên xác minh. ${hint}`, code },
            { status }
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
    const startedAt = Date.now();
    const remainingMs = () => FUNCTION_BUDGET_MS - (Date.now() - startedAt);

    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await withDeadline(
            supabase.auth.getUser(),
            AUTH_BUDGET_MS,
            'auth.getUser'
        );
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const service = createServiceSupabaseClient();
        const { data: row } = await withDeadline(service
            .from('kyc_sessions')
            .select(SESSION_COLUMNS)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle() as unknown as Promise<{ data: KycSessionRow | null }>,
            PRECHECK_BUDGET_MS, 'kyc session read');

        if (!row) return NextResponse.json({ session: null });

        // Webhooks can be delayed or lost. If the user is back on our callback
        // page and the session is still open, ask the provider directly rather
        // than leaving the UI spinning.
        if (POLLABLE_STATUSES.includes(row.status as KycStatus)) {
            try {
                const provider = getKycProvider();
                // Bound the adapter too, not just the wait: racing a promise
                // leaves the request itself running against the provider's own
                // ceiling, and that pending work is what holds the function
                // open past the platform timeout.
                // Never more than what is left after the reserve, so a slow
                // provider cannot push the poll past the function timeout.
                const pollBudgetMs = Math.min(
                    POLL_PROVIDER_BUDGET_MS,
                    remainingMs() - PERSIST_RESERVE_MS - NOTIFY_BUDGET_MS
                );
                const decision = pollBudgetMs <= 0 ? null : await withBudget(
                    provider.getDecision(row.provider_session_id, pollBudgetMs),
                    pollBudgetMs
                );
                if (decision && decision.status !== row.status) {
                    const { data: updated } = await service
                        .from('kyc_sessions')
                        .update(toKycSessionDecisionUpdate(decision) as never)
                        .eq('id', row.id)
                        .select(SESSION_COLUMNS)
                        .single() as { data: KycSessionRow | null };
                    if (updated) {
                        if (updated.status === 'Approved') {
                            // Budgeted: the handoff sends mail, and a stalled
                            // SMTP connection must not cost the user the status
                            // they are polling for. The claim is idempotent, so
                            // an abandoned send is simply retried next poll.
                            await withBudget(notifyKycIdentityApproved({
                                service,
                                sessionId: updated.id,
                                userEmail: user.email,
                            }), Math.min(NOTIFY_BUDGET_MS, Math.max(0, remainingMs())));
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
            await withBudget(notifyKycIdentityApproved({
                service,
                sessionId: row.id,
                userEmail: user.email,
            }), Math.min(NOTIFY_BUDGET_MS, Math.max(0, remainingMs())));
        }

        return NextResponse.json({ session: toClientShape(row) });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        const timedOut = error instanceof DeadlineError;
        console.error(`[KYC] Get session failed after ${Date.now() - startedAt}ms:`, message);
        return NextResponse.json(
            timedOut
                ? { error: 'Máy chủ phản hồi chậm. Vui lòng thử lại.', code: 'timeout_error' }
                : { error: 'Internal server error' },
            { status: timedOut ? 504 : 500 }
        );
    }
}
