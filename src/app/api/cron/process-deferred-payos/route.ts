import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { processPayOSWebhookPostProcessing } from '@/lib/payos-webhook-processing';

type DrainResult = {
  ok?: boolean;
  results?: Array<{ event_id?: string }>;
};

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const token = request.nextUrl.searchParams.get('token') || request.headers.get('x-cron-secret');
  if (!secret || token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const service = createServiceSupabaseClient();
    const { data, error } = await service.rpc('drain_deferred_payos_webhooks' as never, {
      p_limit: 100,
    } as never);
    if (error) throw error;

    const drain = data as DrainResult | null;
    const postProcessed: string[] = [];
    for (const result of drain?.results || []) {
      if (!result.event_id) continue;
      await processPayOSWebhookPostProcessing(service, result.event_id);
      postProcessed.push(result.event_id);
    }

    return NextResponse.json({
      success: true,
      drained: drain?.results?.length || 0,
      post_processed: postProcessed.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
