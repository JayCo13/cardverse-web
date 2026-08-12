import type { SupabaseClient } from '@supabase/supabase-js';

type WebhookFinancialResult = {
  ok?: boolean;
  payment_order_id?: string;
  order_type?: string;
  payment_status?: string;
};

type PostProcessingClaim = {
  ok?: boolean;
  claimed?: boolean;
  completed?: boolean;
  claim_id?: string;
  result?: WebhookFinancialResult;
};

// Payment/order/funding/inventory/accepted-transaction mutations are already
// committed atomically by apply_payos_webhook_event. Post-processing is kept
// non-financial and retry-safe: it only emits a deduplicated notification.
async function finalizeMarketplaceOrders(supabase: SupabaseClient, paymentOrderId: string) {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, card_id, seller_id, status')
    .eq('payment_order_id', paymentOrderId);
  if (error) throw error;

  const paidOrders = (orders || []).filter((order) =>
    ['paid', 'shipping', 'delivered', 'completed', 'disputed'].includes(order.status),
  );

  for (const order of paidOrders) {
    const { data: existingNotification } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', order.seller_id)
      .eq('order_id', order.id)
      .eq('type', 'order_new')
      .maybeSingle();

    if (!existingNotification) {
      const { error: notificationError } = await supabase.from('notifications').insert({
        user_id: order.seller_id,
        type: 'order_new',
        title: 'New order!',
        message: 'The buyer completed payment. Please prepare the order for shipping.',
        card_id: order.card_id,
        order_id: order.id,
      });
      if (notificationError) throw notificationError;
    }
  }
}

export async function processPayOSWebhookPostProcessing(
  supabase: SupabaseClient,
  eventId: string,
) {
  const { data: claimData, error: claimError } = await supabase.rpc(
    'claim_payos_webhook_post_processing',
    { p_event_id: eventId },
  );
  if (claimError) throw claimError;

  const claim = claimData as PostProcessingClaim | null;
  if (!claim?.claimed || !claim.claim_id || !claim.result) {
    return { processed: false, completed: !!claim?.completed };
  }

  try {
    const result = claim.result;
    if (!result.payment_order_id) throw new Error('Missing payment_order_id');

    if (result.order_type === 'marketplace_order') {
      if (result.payment_status === 'paid') {
        await finalizeMarketplaceOrders(supabase, result.payment_order_id);
      }
    } else if (['day_pass', 'credit_pack', 'vip_pro'].includes(result.order_type || '')) {
      const { error: fulfillmentError } = await supabase.rpc('fulfill_subscription_payment', {
        p_payment_order_id: result.payment_order_id,
      });
      if (fulfillmentError) throw fulfillmentError;
    }

    const { error: finishError } = await supabase.rpc('finish_payos_webhook_post_processing', {
      p_event_id: eventId,
      p_claim_id: claim.claim_id,
      p_success: true,
      p_error: null,
    });
    if (finishError) throw finishError;
    return { processed: true, completed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.rpc('finish_payos_webhook_post_processing', {
      p_event_id: eventId,
      p_claim_id: claim.claim_id,
      p_success: false,
      p_error: message,
    });
    throw error;
  }
}
