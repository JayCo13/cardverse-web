import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getPayOS } from '@/lib/payos';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { processPayOSWebhookPostProcessing } from '@/lib/payos-webhook-processing';

/** Order code PayOS sends when validating a webhook URL. Never a real order. */
const PAYOS_VALIDATION_ORDER_CODE = 123;

type PayOSVerifiedWebhook = {
  orderCode: number;
  code: string;
  amount: number;
  currency?: string;
  description?: string;
  reference?: string;
  transactionDateTime?: string;
};

type FinancialWebhookResult = {
  ok?: boolean;
  error?: string;
  status?: string;
  event_id?: string;
};

function eventKey(body: unknown, webhook: PayOSVerifiedWebhook) {
  const providerReference = webhook.reference?.trim();
  if (providerReference) return `reference:${providerReference}`;
  return `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}`;
}

function sanitizedEvidence(webhook: PayOSVerifiedWebhook) {
  return {
    orderCode: webhook.orderCode,
    code: webhook.code,
    amount: webhook.amount,
    currency: webhook.currency || 'VND',
    reference: webhook.reference || null,
    transactionDateTime: webhook.transactionDateTime || null,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (
      process.env.NODE_ENV !== 'production'
      && process.env.PAYOS_ALLOW_TEST_WEBHOOK_BYPASS === 'true'
      && body?.data?.orderCode === PAYOS_VALIDATION_ORDER_CODE
    ) {
      return NextResponse.json({ success: true });
    }

    let webhook: PayOSVerifiedWebhook;
    try {
      webhook = await getPayOS().webhooks.verify(body) as PayOSVerifiedWebhook;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[SECURITY] Invalid PayOS webhook signature:', message);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // PayOS registers a webhook URL by POSTing a signed probe carrying the
    // sample order code, which matches no real payment. It only accepts the URL
    // on a 2xx, so answering the probe from the order lookup below returned 404
    // and PayOS reported "Webhook url invalid" — with no way to register at all.
    //
    // Acknowledging it here is safe on two counts: the signature check above
    // already proves the request came from PayOS, and every real order code is
    // randomInt(10_000_000, 99_999_999), so 123 can never collide with one.
    if (webhook.orderCode === PAYOS_VALIDATION_ORDER_CODE) {
      console.log('[PayOS] Webhook URL validation probe acknowledged');
      return NextResponse.json({ success: true });
    }

    const service = createServiceSupabaseClient();
    const { data, error } = await service.rpc('record_payos_webhook' as never, {
      p_provider_event_key: eventKey(body, webhook),
      p_order_code: webhook.orderCode,
      p_event_code: webhook.code,
      p_amount: webhook.amount,
      p_currency: webhook.currency || 'VND',
      p_signature_verified: true,
      p_payload_sanitized: sanitizedEvidence(webhook),
      p_provider_occurred_at: webhook.transactionDateTime || null,
    } as never);
    if (error) throw error;

    const result = data as FinancialWebhookResult | null;
    if (!result?.ok) {
      const status = result?.error === 'payment_order_not_found' ? 404 : 400;
      return NextResponse.json({ error: result?.error || 'Webhook rejected' }, { status });
    }

    // During cutover the signed event is durably stored but no financial or
    // fulfilment mutation runs. The drain job reuses the same event id later.
    if (result.status === 'deferred') {
      return NextResponse.json({ success: true, deferred: true });
    }

    if (result.event_id) {
      await processPayOSWebhookPostProcessing(service, result.event_id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ERROR] PayOS webhook error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
