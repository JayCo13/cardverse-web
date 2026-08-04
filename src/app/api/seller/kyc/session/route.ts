import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getKycProvider } from '@/lib/kyc';

/** Sessions a user may open per hour. Each one costs a provider credit. */
const MAX_SESSIONS_PER_HOUR = 5;

/** Marks a failure that happened after the provider session was already created. */
class PersistenceError extends Error {}

type KycSessionRow = {
    id: string;
    provider: string;
    provider_session_id: string;
    status: string;
    verified_full_name: string | null;
    consumed_at: string | null;
    created_at: string;
};

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

        // Already an approved seller — nothing to verify.
        const { data: existing } = await service
            .from('seller_verifications')
            .select('status')
            .eq('user_id', user.id)
            .maybeSingle() as { data: { status: string } | null };

        if (existing?.status === 'approved') {
            return NextResponse.json({ error: 'Tài khoản đã được xác minh.' }, { status: 400 });
        }
        if (existing?.status === 'pending') {
            return NextResponse.json({ error: 'Hồ sơ đang chờ duyệt.' }, { status: 400 });
        }

        // Rate limit in the database, not in memory: this runs on serverless
        // where each instance would otherwise keep its own counter.
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { count } = await service
            .from('kyc_sessions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .gte('created_at', oneHourAgo);

        if ((count ?? 0) >= MAX_SESSIONS_PER_HOUR) {
            return NextResponse.json(
                { error: 'Bạn đã mở quá nhiều phiên xác minh. Vui lòng thử lại sau 1 giờ.' },
                { status: 429 }
            );
        }

        const body = await request.json().catch(() => ({} as Record<string, unknown>));
        const language = typeof body?.language === 'string' ? body.language : 'vi';
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

        const { data: row, error: insertError } = await service
            .from('kyc_sessions')
            .insert({
                user_id: user.id,
                provider: provider.name,
                provider_session_id: session.providerSessionId,
                workflow_id: session.workflowId,
                status: session.status,
            } as never)
            .select('id, provider, provider_session_id, status, verified_full_name, consumed_at, created_at')
            .single() as { data: KycSessionRow | null; error: { message?: string } | null };

        if (insertError || !row) {
            // The provider session already exists at this point, so a failure
            // here costs a verification credit. Almost always a missing table
            // (migration not applied) or a bad service-role key.
            throw new PersistenceError(insertError?.message || 'Failed to persist KYC session');
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
            .select('id, provider, provider_session_id, status, verified_full_name, consumed_at, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle() as { data: KycSessionRow | null };

        if (!row) return NextResponse.json({ session: null });

        // Webhooks can be delayed or lost. If the user is back on our callback
        // page and the session is still open, ask the provider directly rather
        // than leaving the UI spinning.
        if (row.status === 'Not Started' || row.status === 'In Progress') {
            try {
                const provider = getKycProvider();
                const decision = await provider.getDecision(row.provider_session_id);
                if (decision.status !== row.status) {
                    const { data: updated } = await service
                        .from('kyc_sessions')
                        .update({ status: decision.status } as never)
                        .eq('id', row.id)
                        .select('id, provider, provider_session_id, status, verified_full_name, consumed_at, created_at')
                        .single() as { data: KycSessionRow | null };
                    if (updated) return NextResponse.json({ session: toClientShape(updated) });
                }
            } catch (pollError) {
                // Non-fatal: fall through and report the stored status.
                console.warn('[KYC] Status poll failed:', pollError);
            }
        }

        return NextResponse.json({ session: toClientShape(row) });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        console.error('[KYC] Get session failed:', message);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
