import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ConsumeCreditResult = {
  ok?: boolean;
  error?: string;
  replayed?: boolean;
  credits_remaining?: number;
};

export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey || !UUID_PATTERN.test(idempotencyKey)) {
      return NextResponse.json(
        { error: 'Idempotency-Key is required', code: 'idempotency_key_required' },
        { status: 400 },
      );
    }

    const body = await request.json() as { subscriptionId?: unknown };
    const subscriptionId = typeof body.subscriptionId === 'string' ? body.subscriptionId : '';
    if (!UUID_PATTERN.test(subscriptionId)) {
      return NextResponse.json({ error: 'Invalid subscriptionId' }, { status: 400 });
    }

    // Only the session identity is trusted. The SECURITY DEFINER RPC locks the
    // subscription, enforces ownership, and records the request key in the same
    // transaction as the decrement.
    const service = createServiceSupabaseClient();
    const { data, error } = await service.rpc('consume_scan_credit' as never, {
      p_user_id: user.id,
      p_subscription_id: subscriptionId,
      p_idempotency_key: idempotencyKey,
    } as never);
    if (error) throw error;

    const result = data as ConsumeCreditResult | null;
    if (!result?.ok) {
      const code = result?.error || 'credit_decrement_failed';
      const status = code === 'subscription_not_found' ? 404
        : code === 'no_credits_remaining' ? 403
          : code === 'financial_maintenance_active' ? 503
            : 409;
      return NextResponse.json({ error: code, code }, { status });
    }

    return NextResponse.json({
      creditsRemaining: result.credits_remaining,
      replayed: result.replayed === true,
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[decrement-credit] Error:', message);
    return NextResponse.json({ error: 'Failed to decrement credit' }, { status: 500 });
  }
}
