import { randomInt } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getPayOS } from '@/lib/payos';
import { hashFinancialRequest, stableFinancialUuid } from '@/lib/financial-idempotency';
import { quoteCheapestConfiguredShipping } from '@/lib/verified-shipping';
import { attachClaimedPayOSLink, claimPayOSLinkCreation } from '@/lib/payos-link-claim';
import { translateRequest } from '@/lib/request-localization';
import { announcePaidOrdersInChat } from '@/lib/order-paid-chat';

const RESERVATION_MINUTES = 15;

type TransactionRow = {
  id: string;
  card_id: string;
  seller_id: string;
  buyer_id: string;
  offer_id: string | null;
  price: number;
  status: string;
  expires_at: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: transactionId } = await params;
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey || !/^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
      return NextResponse.json({ error: 'Idempotency-Key is required' }, { status: 400 });
    }

    const body = await request.json();
    const {
      payment_method, shipping_address,
      to_name, to_phone,
      to_district_id, to_district_name,
      to_province_id, to_province_name,
      to_ward_code, to_ward_name, to_address_detail,
    } = body;

    if (!['wallet', 'direct_payos'].includes(payment_method)) {
      return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 });
    }
    if (
      !to_name || !to_phone || !to_district_id || !to_district_name
      || !to_province_id || !to_province_name || !to_ward_code
      || !to_ward_name || !to_address_detail
    ) {
      return NextResponse.json({ error: 'Shipping address is incomplete' }, { status: 400 });
    }

    const apiRequestHash = hashFinancialRequest({
      version: 1,
      route: 'transaction_pay',
      user_id: user.id,
      transaction_id: transactionId,
      payment_method,
      shipping_address: shipping_address || null,
      to_name,
      to_phone,
      to_district_id,
      to_district_name,
      to_province_id,
      to_province_name,
      to_ward_code,
      to_ward_name,
      to_address_detail,
    });
    const service = createServiceSupabaseClient();
    const { data: replayData, error: replayError } = await service.rpc(
      'get_marketplace_checkout_replay' as never,
      {
        p_user_id: user.id,
        p_idempotency_key: idempotencyKey,
        p_request_hash: apiRequestHash,
      } as never,
    );
    if (replayError) {
      const conflict = replayError.message.includes('idempotency_conflict');
      return NextResponse.json(
        { error: conflict ? 'Idempotency key conflicts with another payment.' : 'Could not replay payment.', code: conflict ? 'idempotency_conflict' : 'checkout_replay_failed' },
        { status: conflict ? 409 : 500 },
      );
    }
    const replay = replayData as unknown as {
      found?: boolean;
      payment_method?: 'wallet' | 'direct_payos';
      orders?: Array<Record<string, unknown>>;
      payment_order?: { checkout_url?: string | null; order_code?: number };
    };
    if (replay.found) {
      const order = replay.orders?.[0];
      if (replay.payment_method === 'wallet' && order) {
        // Idempotent, and the only remaining chance to announce if the original
        // request died after the RPC committed.
        await announcePaidOrdersInChat(service, [order]);
        return NextResponse.json({ success: true, order, payment_method: 'wallet', replayed: true });
      }
      if (replay.payment_method === 'direct_payos' && order && replay.payment_order?.checkout_url) {
        return NextResponse.json({
          success: true,
          order,
          payment_method: 'direct_payos',
          checkoutUrl: replay.payment_order.checkout_url,
          orderCode: replay.payment_order.order_code,
          replayed: true,
        });
      }
      return NextResponse.json({
        error: 'Payment exists, but the PayOS link is not ready. Do not create another payment; contact support.',
        code: 'payment_link_recovery_required',
      }, { status: 409 });
    }

    const { data: transaction, error: transactionError } = await supabase
      .from('transactions')
      .select('id, card_id, seller_id, buyer_id, offer_id, price, status, expires_at')
      .eq('id', transactionId)
      .single<TransactionRow>();
    if (transactionError || !transaction) {
      return NextResponse.json({ error: 'Transaction not found.', code: 'transaction_not_found' }, { status: 404 });
    }
    if (transaction.buyer_id !== user.id) {
      return NextResponse.json({ error: 'Only the buyer can pay for this transaction.', code: 'transaction_forbidden' }, { status: 403 });
    }
    if (transaction.status !== 'active' || new Date(transaction.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'This transaction is no longer active.', code: 'transaction_inactive' }, { status: 409 });
    }

    const { data: card, error: cardError } = await supabase
      .from('cards')
      .select('id, name, status')
      .eq('id', transaction.card_id)
      .single<{ id: string; name: string; status: string }>();
    if (cardError || !card) {
      return NextResponse.json({ error: 'Card not found.', code: 'card_not_found' }, { status: 404 });
    }
    if (card.status === 'sold') {
      return NextResponse.json({ error: 'This card was already sold.', code: 'card_unavailable' }, { status: 409 });
    }

    const amount = Number(transaction.price);
    const shippingFee = await quoteCheapestConfiguredShipping({
      sellerId: transaction.seller_id,
      toProvinceId: Number(to_province_id),
      toProvinceName: String(to_province_name),
    });
    const totalPaid = amount + shippingFee;
    const orderId = stableFinancialUuid(`transaction-pay:${user.id}:${idempotencyKey}:${transactionId}`);
    const orderShipping = {
      shipping_address: shipping_address || null,
      to_name: to_name || null,
      to_phone: to_phone || null,
      to_district_id: to_district_id || null,
      to_district_name: to_district_name || null,
      to_province_id: to_province_id || null,
      to_province_name: to_province_name || null,
      to_ward_code: to_ward_code || null,
      to_ward_name: to_ward_name || null,
      to_address_detail: to_address_detail || null,
    };
    const orderSpec = {
      order_id: orderId,
      card_id: transaction.card_id,
      seller_id: transaction.seller_id,
      offer_id: transaction.offer_id,
      transaction_id: transactionId,
      amount,
      shipping_fee: shippingFee,
      total_paid: totalPaid,
      metadata: { api_request_hash: apiRequestHash },
      ...orderShipping,
    };

    if (payment_method === 'wallet') {
      const { data: walletResultData, error: walletOrderError } = await service.rpc(
        'create_verified_wallet_marketplace_orders' as never,
        {
          p_user_id: user.id,
          p_orders: [orderSpec],
          p_idempotency_key: idempotencyKey,
          p_description: `Card offer purchase: ${card.name}`,
        } as never,
      );
      if (walletOrderError || !walletResultData) {
        return NextResponse.json({ error: 'Verified balance is insufficient.', code: 'insufficient_verified_balance' }, { status: 409 });
      }

      const walletResult = walletResultData as unknown as { orders?: Array<Record<string, unknown>> };
      const order = walletResult.orders?.[0];
      if (!order) {
        throw new Error('Atomic wallet transaction did not return an order');
      }

      const { error: notificationError } = await service.from('notifications').insert({
        user_id: transaction.seller_id,
        type: 'order_new',
        title: 'New order!',
        message: `Card "${card.name}" was paid for. Please ship the order.`,
        card_id: transaction.card_id,
        transaction_id: transactionId,
        order_id: orderId,
      } as never);
      if (notificationError) {
        console.error('Transaction payment notification failed:', notificationError);
      }

      // No-ops unless these two already have a conversation. Driven off the
      // order row so the amount is whatever was really charged — quoting the
      // route's bare `amount` would drop the shipping fee.
      await announcePaidOrdersInChat(service, [order]);

      return NextResponse.json({ success: true, order, payment_method: 'wallet' });
    }

    const reservedUntil = new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000);
    const orderCode = randomInt(10_000_000, 99_999_999);
    const { data: stagedData, error: stageError } = await service.rpc(
      'stage_payos_marketplace_checkout' as never,
      {
        p_user_id: user.id,
        p_order_code: orderCode,
        p_orders: [orderSpec],
        p_idempotency_key: idempotencyKey,
        p_reserved_until: reservedUntil.toISOString(),
      } as never,
    );
    const staged = stagedData as unknown as {
      payment_order?: { id: string; order_code: number; payos_checkout_url?: string | null };
      orders?: Array<Record<string, unknown>>;
    };
    const paymentOrder = staged?.payment_order;
    const order = staged?.orders?.[0];
    if (stageError || !paymentOrder || !order) {
      throw stageError || new Error('Could not stage PayOS transaction');
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const persistedOrderCode = Number(paymentOrder.order_code);
    if (paymentOrder.payos_checkout_url) {
      return NextResponse.json({
        success: true,
        order,
        payment_method: 'direct_payos',
        checkoutUrl: paymentOrder.payos_checkout_url,
        orderCode: persistedOrderCode,
      });
    }
    const linkClaim = await claimPayOSLinkCreation(service, user.id, persistedOrderCode);
    if (linkClaim.checkoutUrl) {
      return NextResponse.json({
        success: true,
        order,
        payment_method: 'direct_payos',
        checkoutUrl: linkClaim.checkoutUrl,
        orderCode: persistedOrderCode,
        replayed: true,
      });
    }
    const paymentLink = await getPayOS().paymentRequests.create({
      orderCode: persistedOrderCode,
      amount: totalPaid,
      description: translateRequest(request, 'payos_description_card_purchase').slice(0, 25),
      expiredAt: Math.floor(reservedUntil.getTime() / 1000),
      cancelUrl: `${origin}/orders?status=cancelled`,
      returnUrl: `${origin}/orders?status=success`,
      items: [{ name: card.name.substring(0, 50), quantity: 1, price: totalPaid }],
    });
    await attachClaimedPayOSLink(service, {
      userId: user.id,
      orderCode: persistedOrderCode,
      claimId: linkClaim.claimId!,
      paymentLinkId: paymentLink.paymentLinkId,
      checkoutUrl: paymentLink.checkoutUrl,
    });

    return NextResponse.json({
      success: true,
      order,
      payment_method: 'direct_payos',
      checkoutUrl: paymentLink.checkoutUrl,
      qrCode: paymentLink.qrCode,
      orderCode: persistedOrderCode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Transaction pay error:', error);
    return NextResponse.json({ error: message || 'Internal server error' }, { status: 500 });
  }
}
