import { NextRequest, NextResponse } from 'next/server';
import { randomInt } from 'crypto';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getPayOS, MARKETPLACE_ORDER_PAYMENT_TYPE } from '@/lib/payos';

// Fee model: the 5% platform fee is charged ONCE, at withdrawal
// (src/app/api/wallet/withdraw/route.ts). Orders carry platform_fee = 0; the
// seller is credited the full amount when the order completes.
// How long a card is held for an unpaid checkout before it self-releases back
// to the marketplace (release_expired_card_reservations). Also used as the PayOS
// payment-link expiry so the dangling order is cancellable in lockstep.
const RESERVATION_MINUTES = 3;

type CheckoutItemInput = {
  cart_item_id?: string;
  card_id?: string;
  shipping_fee?: number;
};

type ShippingBody = {
  to_name: string;
  to_phone: string;
  to_district_id: number;
  to_district_name: string;
  to_province_id: number;
  to_province_name: string;
  to_ward_code: string;
  to_ward_name: string;
  to_address_detail: string;
  shipping_address?: string;
};

type CheckoutCard = {
  id: string;
  name: string;
  seller_id: string;
  price: number | null;
  status: string;
  listing_type: string | null;
};

type WalletRow = { id: string; available_balance: number };
type CreatedOrder = Record<string, unknown>;

function orderShipping(body: ShippingBody) {
  return {
    shipping_address: body.shipping_address || `${body.to_address_detail}, ${body.to_ward_name}, ${body.to_district_name}, ${body.to_province_name}`,
    to_name: body.to_name,
    to_phone: body.to_phone,
    to_district_id: body.to_district_id,
    to_district_name: body.to_district_name,
    to_province_id: body.to_province_id,
    to_province_name: body.to_province_name,
    to_ward_code: body.to_ward_code,
    to_ward_name: body.to_ward_name,
    to_address_detail: body.to_address_detail,
  };
}

function shippingIsComplete(body: Partial<ShippingBody>) {
  return !!(
    body.to_name &&
    body.to_phone &&
    body.to_district_id &&
    body.to_district_name &&
    body.to_province_id &&
    body.to_province_name &&
    body.to_ward_code &&
    body.to_ward_name &&
    body.to_address_detail
  );
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const mode = body.mode as 'cart' | 'offer';
    const paymentMethod = body.payment_method as 'wallet' | 'direct_payos';

    if (!['cart', 'offer'].includes(mode)) {
      return NextResponse.json({ error: 'Invalid checkout mode' }, { status: 400 });
    }

    if (!['wallet', 'direct_payos'].includes(paymentMethod)) {
      return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 });
    }

    if (!shippingIsComplete(body)) {
      return NextResponse.json({ error: 'Shipping address is incomplete' }, { status: 400 });
    }

    await supabase.rpc('release_expired_card_reservations' as never);

    const checkoutItems: Array<{
      cartItemId?: string;
      offerId?: string;
      card: CheckoutCard;
      amount: number;
      shippingFee: number;
      offerBuyerId?: string;
    }> = [];

    if (mode === 'cart') {
      const inputs = (body.items || []) as CheckoutItemInput[];
      if (inputs.length === 0) {
        return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
      }

      for (const input of inputs) {
        if (!input.cart_item_id) {
          return NextResponse.json({ error: 'cart_item_id is required' }, { status: 400 });
        }

        const { data: cartItem, error: cartError } = await supabase
          .from('cart_items')
          .select('id, card_id, user_id')
          .eq('id', input.cart_item_id)
          .eq('user_id', user.id)
          .single<{ id: string; card_id: string; user_id: string }>();

        if (cartError || !cartItem) {
          return NextResponse.json({ error: 'Cart item not found' }, { status: 404 });
        }

        const { data: card, error: cardError } = await supabase
          .from('cards')
          .select('id, name, seller_id, price, status, listing_type')
          .eq('id', cartItem.card_id)
          .single<CheckoutCard>();

        if (cardError || !card || card.status !== 'active' || card.listing_type !== 'sale') {
          return NextResponse.json({ error: 'Một thẻ trong giỏ hàng không còn khả dụng.', code: 'card_unavailable' }, { status: 409 });
        }

        if (card.seller_id === user.id) {
          return NextResponse.json({ error: 'Bạn không thể mua bài đăng của chính mình.' }, { status: 400 });
        }

        checkoutItems.push({
          cartItemId: cartItem.id,
          card,
          amount: Number(card.price || 0),
          shippingFee: Math.max(0, parseInt(String(input.shipping_fee || 0)) || 0),
        });
      }
    } else {
      const offerId = body.offer_id as string | undefined;
      const shippingFee = Math.max(0, parseInt(String(body.shipping_fee || 0)) || 0);

      if (!offerId) {
        return NextResponse.json({ error: 'offer_id is required' }, { status: 400 });
      }

      const { data: offer, error: offerError } = await supabase
        .from('offers')
        .select('id, card_id, buyer_id, price, status')
        .eq('id', offerId)
        .single<{ id: string; card_id: string; buyer_id: string; price: number; status: string }>();

      if (offerError || !offer) {
        return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
      }

      if (offer.buyer_id !== user.id) {
        return NextResponse.json({ error: 'Chỉ người mua mới có thể thanh toán offer này.' }, { status: 403 });
      }

      if (offer.status !== 'chosen') {
        return NextResponse.json({ error: 'Offer này chưa sẵn sàng để thanh toán.', code: 'offer_not_ready' }, { status: 409 });
      }

      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, status')
        .eq('offer_id', offerId)
        .in('status', ['pending_payment', 'paid', 'shipping', 'delivered', 'completed'])
        .maybeSingle();

      if (existingOrder) {
        return NextResponse.json({ error: 'Offer này đã có đơn hàng.', code: 'order_exists', order: existingOrder }, { status: 409 });
      }

      const { data: card, error: cardError } = await supabase
        .from('cards')
        .select('id, name, seller_id, price, status, listing_type')
        .eq('id', offer.card_id)
        .single<CheckoutCard>();

      if (cardError || !card || card.status === 'sold') {
        return NextResponse.json({ error: 'Thẻ này không còn khả dụng.', code: 'card_unavailable' }, { status: 409 });
      }

      checkoutItems.push({
        offerId: offer.id,
        offerBuyerId: offer.buyer_id,
        card,
        amount: Number(offer.price),
        shippingFee,
      });
    }

    const totalPaid = checkoutItems.reduce((sum, item) => sum + item.amount + item.shippingFee, 0);
    const shipping = orderShipping(body as ShippingBody);

    let walletRow: WalletRow | null = null;
    if (paymentMethod === 'wallet') {
      const { data: wallet, error: walletError } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', user.id)
        .single<WalletRow>();

      if (walletError || !wallet) {
        return NextResponse.json({ error: 'Không tìm thấy ví. Vui lòng nạp tiền trước.' }, { status: 400 });
      }
      if (wallet.available_balance < totalPaid) {
        return NextResponse.json({ error: 'Insufficient balance', available: wallet.available_balance, required: totalPaid }, { status: 400 });
      }
      walletRow = wallet;
    }

    // Wallet mutations go through the service-role client: RLS allows owners
    // to SELECT their wallet but all writes are server-trusted only.
    const service = createServiceSupabaseClient();

    const claimedCardIds: string[] = [];
    const soldCardIds: string[] = [];
    const createdOrderIds: string[] = [];
    let walletDebited = false;

    const unavailableError = (message: string) => {
      const err = new Error(message);
      (err as any).status = 409;
      (err as any).code = 'card_unavailable';
      return err;
    };

    try {
      const reservedUntil = new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000).toISOString();
      if (mode === 'cart') {
        for (const item of checkoutItems) {
          const { data: claimed } = await supabase
            .from('cards')
            .update({ status: 'in_transaction', reserved_until: reservedUntil, updated_at: new Date().toISOString() } as never)
            .eq('id', item.card.id)
            .eq('status', 'active')
            .eq('listing_type', 'sale')
            .select('id')
            .maybeSingle<{ id: string }>();

          if (!claimed) {
            throw unavailableError('Một thẻ vừa được người khác mua hoặc giữ thanh toán.');
          }
          claimedCardIds.push(item.card.id);
        }
      } else {
        // Offer mode: claim the card atomically too (previously only cart
        // mode claimed, leaving a TOCTOU window where an expired 2h offer
        // hold was re-sold to someone else and this path still force-sold
        // the card a second time). The accept flow left the card
        // 'in_transaction'; it may have lapsed back to 'active' — both are
        // claimable, but only if nobody else has a live order on the card.
        const item = checkoutItems[0];

        const { data: conflictingOrder } = await supabase
          .from('orders')
          .select('id')
          .eq('card_id', item.card.id)
          .neq('buyer_id', user.id)
          .in('status', ['pending_payment', 'paid', 'shipping', 'delivered', 'completed'])
          .limit(1)
          .maybeSingle();
        if (conflictingOrder) {
          throw unavailableError('Thẻ này đã được người khác mua.');
        }

        const { data: claimed } = await supabase
          .from('cards')
          .update({ status: 'in_transaction', reserved_until: reservedUntil, updated_at: new Date().toISOString() } as never)
          .eq('id', item.card.id)
          .in('status', ['active', 'in_transaction'])
          .select('id')
          .maybeSingle<{ id: string }>();

        if (!claimed) {
          throw unavailableError('Thẻ này không còn khả dụng.');
        }
        claimedCardIds.push(item.card.id);
      }

      if (paymentMethod === 'wallet') {
        const wallet = walletRow!;
        const newBalance = wallet.available_balance - totalPaid;

        // Optimistic lock on the balance we just read: of two concurrent
        // checkouts only the first matches, the second gets 409 (same pattern
        // as wallet/withdraw).
        const { data: debited, error: deductError } = await service
          .from('wallets')
          .update({ available_balance: newBalance, updated_at: new Date().toISOString() } as never)
          .eq('user_id', user.id)
          .eq('available_balance', wallet.available_balance)
          .select('id')
          .maybeSingle();
        if (deductError || !debited) {
          const conflict = new Error('Số dư vừa thay đổi, vui lòng thử lại.');
          (conflict as any).status = 409;
          (conflict as any).code = 'balance_changed';
          throw deductError || conflict;
        }
        walletDebited = true;

        const { error: walletTransactionError } = await service.from('wallet_transactions').insert({
          wallet_id: wallet.id,
          user_id: user.id,
          type: 'marketplace_buy',
          amount: -totalPaid,
          balance_after: newBalance,
          description: mode === 'offer' ? 'Thanh toán offer thẻ' : 'Thanh toán giỏ hàng CardVerse',
          reference_id: checkoutItems[0]?.card.id,
        } as never);
        if (walletTransactionError) throw walletTransactionError;

        const orders: CreatedOrder[] = [];
        for (const item of checkoutItems) {
          const amount = item.amount;
          const { data: order, error: orderError } = await supabase
            .from('orders')
            .insert({
              card_id: item.card.id,
              seller_id: item.card.seller_id,
              buyer_id: user.id,
              offer_id: item.offerId || null,
              amount,
              platform_fee: 0, // fee is charged at withdrawal, not at sale
              total_paid: amount + item.shippingFee,
              shipping_fee: item.shippingFee,
              payment_method: 'wallet',
              status: 'paid',
              ...shipping,
            } as never)
            .select()
            .single();

          if (orderError) throw orderError;
          orders.push(order);
          createdOrderIds.push((order as { id: string }).id);

          // Guarded: only a card still holding OUR claim can be sold. If the
          // claim was raced away, abort — the catch rolls back the orders and
          // refunds, instead of force-selling a card someone else bought.
          const { data: soldCard } = await supabase
            .from('cards')
            .update({ status: 'sold', reserved_until: null, updated_at: new Date().toISOString() } as never)
            .eq('id', item.card.id)
            .eq('status', 'in_transaction')
            .select('id')
            .maybeSingle<{ id: string }>();

          if (!soldCard) {
            throw unavailableError('Một thẻ vừa được người khác mua hoặc giữ thanh toán.');
          }
          soldCardIds.push(item.card.id);
        }

        // Notify sellers only after every order committed — a mid-loop
        // failure must not leave sellers with "please ship" notifications
        // for orders that were rolled back.
        for (const item of checkoutItems) {
          await service.from('notifications').insert({
            user_id: item.card.seller_id,
            type: 'order_new',
            title: 'Đơn hàng mới!',
            message: `Thẻ "${item.card.name}" đã được thanh toán. Vui lòng giao hàng.`,
            card_id: item.card.id,
            offer_id: item.offerId || null,
          } as never);
        }

        if (mode === 'cart') {
          const cartItemIds = checkoutItems.map(item => item.cartItemId).filter(Boolean) as string[];
          await supabase.from('cart_items').delete().eq('user_id', user.id).in('id', cartItemIds);
        }

        return NextResponse.json({ success: true, orders, payment_method: 'wallet' });
      }

      const orderCode = randomInt(10_000_000, 99_999_999);
      const { data: paymentOrder, error: poError } = await supabase
        .from('payment_orders')
        .insert({
          user_id: user.id,
          order_code: orderCode,
          package_type: MARKETPLACE_ORDER_PAYMENT_TYPE,
          amount: totalPaid,
          status: 'pending',
        } as never)
        .select()
        .single<{ id: string }>();
      if (poError || !paymentOrder) throw (poError || new Error('Could not create payment order'));

        const orders: CreatedOrder[] = [];
      for (const item of checkoutItems) {
        const amount = item.amount;
        const { data: order, error: orderError } = await supabase
          .from('orders')
          .insert({
            card_id: item.card.id,
            seller_id: item.card.seller_id,
            buyer_id: user.id,
            offer_id: item.offerId || null,
            amount,
            platform_fee: 0, // fee is charged at withdrawal, not at sale
            total_paid: amount + item.shippingFee,
            shipping_fee: item.shippingFee,
            payment_method: 'direct_payos',
            payment_order_id: paymentOrder.id,
            status: 'pending_payment',
            ...shipping,
          } as never)
          .select()
          .single();
        if (orderError) throw orderError;
        orders.push(order);
        createdOrderIds.push((order as { id: string }).id);
      }

      if (mode === 'cart') {
        const cartItemIds = checkoutItems.map(item => item.cartItemId).filter(Boolean) as string[];
        await supabase.from('cart_items').delete().eq('user_id', user.id).in('id', cartItemIds);
      }
      // (Offer mode: the card was already claimed 'in_transaction' with a
      // fresh reserved_until in the atomic claim above.)

      const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const paymentLink = await getPayOS().paymentRequests.create({
        orderCode,
        amount: totalPaid,
        description: mode === 'offer' ? 'Thanh toan offer CV' : 'Thanh toan gio hang CV',
        expiredAt: Math.floor((Date.now() + RESERVATION_MINUTES * 60 * 1000) / 1000),
        cancelUrl: `${origin}/orders?status=cancelled`,
        returnUrl: `${origin}/orders?status=success`,
        items: checkoutItems.map(item => ({
          name: item.card.name.substring(0, 50),
          quantity: 1,
          price: item.amount + item.shippingFee,
        })),
      });

      await supabase
        .from('payment_orders')
        .update({
          payos_payment_link_id: paymentLink.paymentLinkId,
          payos_checkout_url: paymentLink.checkoutUrl,
        } as never)
        .eq('order_code', orderCode);

      return NextResponse.json({
        success: true,
        orders,
        payment_method: 'direct_payos',
        checkoutUrl: paymentLink.checkoutUrl,
        qrCode: paymentLink.qrCode,
        orderCode,
      });
    } catch (err) {
      // Full rollback, in dependency order. Previously a mid-loop failure in
      // a multi-item wallet checkout left earlier orders 'paid' and their
      // cards 'sold' while STILL refunding the buyer 100% — free cards.
      // 1) Remove every order this request created (paid or pending_payment).
      if (createdOrderIds.length > 0) {
        await service.from('orders').delete().in('id', createdOrderIds);
      }

      // 2) Un-sell cards this request flipped to 'sold' (guarded so a card
      //    legitimately re-sold elsewhere is never clobbered back to active).
      if (soldCardIds.length > 0) {
        await supabase
          .from('cards')
          .update({ status: 'active', reserved_until: null, updated_at: new Date().toISOString() } as never)
          .in('id', soldCardIds)
          .eq('status', 'sold');
      }

      // 3) Release cart claims that never reached 'sold'. Offer-mode cards
      //    stay 'in_transaction' — the offer is still 'chosen', so the hold
      //    should persist (release_expired_card_reservations self-heals it
      //    when the fresh reserved_until lapses).
      if (mode === 'cart') {
        for (const cardId of claimedCardIds) {
          await supabase
            .from('cards')
            .update({ status: 'active', reserved_until: null, updated_at: new Date().toISOString() } as never)
            .eq('id', cardId)
            .eq('status', 'in_transaction');
        }
      }

      // 4) Compensation: if the wallet was already debited but order creation
      // failed afterwards, put the money back (best-effort with one retry —
      // previously the buyer simply lost the balance).
      if (walletDebited) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const { data: currentWallet } = await service
            .from('wallets')
            .select('id, available_balance')
            .eq('user_id', user.id)
            .single<{ id: string; available_balance: number }>();
          if (!currentWallet) break;

          const refundedBalance = currentWallet.available_balance + totalPaid;
          const { data: refunded } = await service
            .from('wallets')
            .update({ available_balance: refundedBalance, updated_at: new Date().toISOString() } as never)
            .eq('user_id', user.id)
            .eq('available_balance', currentWallet.available_balance)
            .select('id')
            .maybeSingle();

          if (refunded) {
            await service.from('wallet_transactions').insert({
              wallet_id: currentWallet.id,
              user_id: user.id,
              type: 'refund',
              amount: totalPaid,
              balance_after: refundedBalance,
              description: 'Hoàn tiền - thanh toán thất bại',
              reference_id: checkoutItems[0]?.card.id,
            } as never);
            break;
          }
        }
      }
      throw err;
    }
  } catch (error: any) {
    console.error('Checkout error:', error);
    const status = typeof error?.status === 'number' ? error.status : 500;
    return NextResponse.json(
      { error: error.message || 'Internal server error', ...(error?.code ? { code: error.code } : {}) },
      { status },
    );
  }
}
