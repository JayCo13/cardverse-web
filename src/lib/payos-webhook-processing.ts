import type { SupabaseClient } from '@supabase/supabase-js';
import { sendOrderPlacedToBuyer, sendOrderPlacedToSeller } from './mail';
import { announceOrderPaidInChat } from './order-paid-chat';

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
    .select('id, card_id, seller_id, buyer_id, offer_id, status, amount, shipping_fee, platform_fee, total_paid, shipping_address')
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

      // Receipts ride on the same first-time branch as the notification, so a
      // webhook retry cannot mail the same order twice. Failures here must not
      // abort post-processing — the payment is already committed — so they are
      // swallowed by the mail helpers and never rethrown.
      await sendOrderPlacedEmails(supabase, order);
    }

    // Deliberately outside the notification branch. Post-processing is only
    // at-least-once: an invocation that died after inserting `order_new` but
    // before this line would, on retry or on the deferred drain, see the
    // notification, skip the whole branch and mark itself complete — leaving the
    // seller with a bell and no message in the thread they actually read.
    // This delivery carries its own idempotency (a unique index on the receipt),
    // so it does not need to borrow the notification's.
    await announceOrderPaidInChat(supabase, order);
  }
}

type PaidOrder = {
  id: string;
  card_id: string;
  seller_id: string;
  buyer_id: string;
  offer_id: string | null;
  amount: number;
  shipping_fee: number | null;
  platform_fee: number | null;
  total_paid: number | null;
  shipping_address: string | null;
};

async function sendOrderPlacedEmails(supabase: SupabaseClient, order: PaidOrder) {
  try {
    const [{ data: card }, { data: people }] = await Promise.all([
      supabase.from('cards').select('name').eq('id', order.card_id).maybeSingle(),
      supabase
        .from('profiles')
        .select('id, email, display_name')
        .in('id', [order.buyer_id, order.seller_id]),
    ]);

    const byId = new Map(
      ((people || []) as Array<{ id: string; email: string | null; display_name: string | null }>)
        .map((person) => [person.id, person]),
    );
    const buyer = byId.get(order.buyer_id);
    const seller = byId.get(order.seller_id);
    const cardName = (card as { name?: string } | null)?.name || 'Thẻ CardVerseHub';
    const shippingFee = order.shipping_fee ?? 0;

    await Promise.allSettled([
      sendOrderPlacedToBuyer(buyer?.email || '', {
        orderId: order.id,
        cardName,
        amount: order.amount,
        shippingFee,
        totalPaid: order.total_paid ?? order.amount + shippingFee,
        shippingAddress: order.shipping_address,
      }),
      sendOrderPlacedToSeller(seller?.email || '', {
        orderId: order.id,
        cardName,
        amount: order.amount,
        platformFee: order.platform_fee,
        buyerName: buyer?.display_name || null,
        shippingAddress: order.shipping_address,
      }),
    ]);
  } catch (mailError) {
    console.error('[PayOS] Order placed emails failed:', mailError);
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
