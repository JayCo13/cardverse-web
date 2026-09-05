import { NextRequest, NextResponse } from 'next/server';
import { randomInt } from 'crypto';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { hashFinancialRequest, stableFinancialUuid } from '@/lib/financial-idempotency';
import { getPayOS } from '@/lib/payos';
import { CheckoutShippingError, quoteCheckoutConfiguredShippingBatch } from '@/lib/verified-shipping';
import { attachClaimedPayOSLink, claimPayOSLinkCreation } from '@/lib/payos-link-claim';
import { translateRequest } from '@/lib/request-localization';
import { walletCheckoutError } from '@/lib/wallet-checkout-error';
import { announcePaidOrdersInChat } from '@/lib/order-paid-chat';
import { matchBundleSelection, type BundleItem, type BundleSelection } from '@/lib/bundle';

// Fee model: the 8% platform fee is charged ONCE, at withdrawal
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
  is_bundle: boolean | null;
  bundle_items: BundleItem[] | null;
};

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
    const idempotencyKey = request.headers.get('idempotency-key');
    const mode = body.mode as 'cart' | 'offer';
    const paymentMethod = body.payment_method as 'wallet' | 'direct_payos';

    if (!['cart', 'offer'].includes(mode)) {
      return NextResponse.json({ error: 'Invalid checkout mode' }, { status: 400 });
    }

    if (!['wallet', 'direct_payos'].includes(paymentMethod)) {
      return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 });
    }
    if (!idempotencyKey || !/^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
      return NextResponse.json({ error: 'Idempotency-Key is required' }, { status: 400 });
    }

    if (!shippingIsComplete(body)) {
      return NextResponse.json({ error: 'Shipping address is incomplete' }, { status: 400 });
    }

    // Older cart clients omit this map and retain their cheapest-carrier default.
    const cartCarriers = mode === 'cart' ? body.shipping_carriers : undefined;
    if (cartCarriers !== undefined && (
      !cartCarriers || typeof cartCarriers !== 'object' || Array.isArray(cartCarriers)
      || Object.values(cartCarriers).some(carrier => typeof carrier !== 'string' || !carrier.trim())
    )) {
      return NextResponse.json({ error: 'Invalid shipping carriers.', code: 'invalid_shipping_carrier' }, { status: 400 });
    }

    const requestItems: Array<{ cart_item_id: string | null }> = Array.isArray(body.items)
      ? body.items.map((item: CheckoutItemInput) => ({ cart_item_id: item.cart_item_id || null }))
      : [];
    const apiRequestHash = hashFinancialRequest({
      version: 1,
      route: 'checkout',
      user_id: user.id,
      mode,
      payment_method: paymentMethod,
      items: requestItems,
      offer_id: body.offer_id || null,
      ...(mode === 'offer' && body.shipping_carrier ? { shipping_carrier: body.shipping_carrier } : {}),
      ...(cartCarriers !== undefined ? { shipping_carriers: cartCarriers } : {}),
      ...orderShipping(body as ShippingBody),
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
        { error: conflict ? 'Idempotency key conflicts with another checkout.' : 'Could not replay checkout.', code: conflict ? 'idempotency_conflict' : 'checkout_replay_failed' },
        { status: conflict ? 409 : 500 },
      );
    }
    const replay = replayData as unknown as {
      found?: boolean;
      payment_method?: 'wallet' | 'direct_payos';
      orders?: CreatedOrder[];
      payment_order?: { checkout_url?: string | null; order_code?: number };
    };
    if (replay.found) {
      if (mode === 'cart' && requestItems.length > 0) {
        const cartItemIds = requestItems.map((item) => item.cart_item_id).filter(Boolean) as string[];
        await supabase.from('cart_items').delete().eq('user_id', user.id).in('id', cartItemIds);
      }
      if (replay.payment_method === 'wallet' && replay.orders?.length) {
        // A replay reaches here when the RPC committed but the original request
        // never finished — precisely the case where the chat receipt is still
        // missing. The announcement is idempotent, so running it on every replay
        // costs nothing and is the only remaining chance to send it.
        await announcePaidOrdersInChat(service, replay.orders);
        return NextResponse.json({ success: true, orders: replay.orders, payment_method: 'wallet', replayed: true });
      }
      if (replay.payment_method === 'direct_payos' && replay.orders?.length && replay.payment_order?.checkout_url) {
        return NextResponse.json({
          success: true,
          orders: replay.orders,
          payment_method: 'direct_payos',
          checkoutUrl: replay.payment_order.checkout_url,
          orderCode: replay.payment_order.order_code,
          replayed: true,
        });
      }
      return NextResponse.json({
        error: 'Checkout exists, but the PayOS link is not ready. Do not create another payment; contact support.',
        code: 'payment_link_recovery_required',
      }, { status: 409 });
    }

    await supabase.rpc('release_expired_card_reservations' as never);

    const checkoutItems: Array<{
      cartItemId?: string;
      offerId?: string;
      card: CheckoutCard;
      amount: number;
      shippingFee: number;
      /** The carrier the fee was quoted from — the seller ships with this one. */
      shippingCarrier?: string;
      offerBuyerId?: string;
      /** Set only for a bundle offer: the cards this payment takes out of the listing. */
      bundleSelection?: BundleItem[];
      bundleRemaining?: BundleItem[];
    }> = [];

    if (mode === 'cart') {
      const inputs = (body.items || []) as CheckoutItemInput[];
      if (inputs.length === 0) {
        return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
      }

      if (inputs.some(input => !input.cart_item_id)) {
        return NextResponse.json({ error: 'cart_item_id is required' }, { status: 400 });
      }
      const cartIds = inputs.map(input => input.cart_item_id!);
      if (new Set(cartIds).size !== cartIds.length) {
        return NextResponse.json({ error: 'Duplicate cart item', code: 'duplicate_cart_item' }, { status: 400 });
      }
      // Two scoped reads instead of two round trips for every item. The
      // settlement RPC still locks and validates canonical inventory/prices.
      const { data: cartRows, error: cartError } = await supabase
        .from('cart_items')
        .select('id, card_id, user_id')
        .in('id', cartIds)
        .eq('user_id', user.id)
        .returns<{ id: string; card_id: string; user_id: string }[]>();
      if (cartError || !cartRows || cartRows.length !== cartIds.length) {
        return NextResponse.json({ error: 'Cart item not found' }, { status: 404 });
      }
      const { data: cardRows, error: cardError } = await supabase
        .from('cards')
        .select('id, name, seller_id, price, status, listing_type, is_bundle, bundle_items')
        .in('id', cartRows.map(item => item.card_id))
        .returns<CheckoutCard[]>();
      const cartById = new Map(cartRows.map(item => [item.id, item]));
      const cardById = new Map((cardRows || []).map(card => [card.id, card]));
      for (const cartId of cartIds) {
        const cartItem = cartById.get(cartId)!;
        const card = cardById.get(cartItem.card_id);
        if (cardError || !card || card.status !== 'active' || card.listing_type !== 'sale') {
          return NextResponse.json({ error: 'A card in the cart is no longer available.', code: 'card_unavailable' }, { status: 409 });
        }

        if (card.seller_id === user.id) {
          return NextResponse.json({ error: 'You cannot buy your own listing.', code: 'self_purchase_forbidden' }, { status: 400 });
        }
        if (card.is_bundle) {
          return NextResponse.json({
            error: 'Open the bundle listing to select the exact cards you want to buy.',
            code: 'bundle_cart_checkout_unsupported',
          }, { status: 409 });
        }

        checkoutItems.push({
          cartItemId: cartItem.id,
          card,
          amount: Number(card.price || 0),
          shippingFee: 0,
        });
      }
    } else {
      const offerId = body.offer_id as string | undefined;

      if (!offerId) {
        return NextResponse.json({ error: 'offer_id is required' }, { status: 400 });
      }

      const { data: offer, error: offerError } = await supabase
        .from('offers')
        .select('id, card_id, buyer_id, price, status, bundle_selection')
        .eq('id', offerId)
        .single<{ id: string; card_id: string; buyer_id: string; price: number; status: string; bundle_selection: BundleItem[] | null }>();

      if (offerError || !offer) {
        return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
      }

      if (offer.buyer_id !== user.id) {
        return NextResponse.json({ error: 'Only the buyer can pay for this offer.', code: 'offer_forbidden' }, { status: 403 });
      }

      if (offer.status !== 'chosen') {
        return NextResponse.json({ error: 'This offer is not ready for checkout.', code: 'offer_not_ready' }, { status: 409 });
      }

      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id, status')
        .eq('offer_id', offerId)
        .in('status', ['pending_payment', 'paid', 'shipping', 'delivered', 'completed'])
        .maybeSingle();

      if (existingOrder) {
        return NextResponse.json({ error: 'An order already exists for this offer.', code: 'order_exists', order: existingOrder }, { status: 409 });
      }

      const { data: card, error: cardError } = await supabase
        .from('cards')
        .select('id, name, seller_id, price, status, listing_type, is_bundle, bundle_items')
        .eq('id', offer.card_id)
        .single<CheckoutCard>();

      if (cardError || !card || card.status === 'sold') {
        return NextResponse.json({ error: 'This card is no longer available.', code: 'card_unavailable' }, { status: 409 });
      }
      // ── Bundle offer: this payment takes only the cards the offer named ──
      //
      // The listing is not reserved for a partial bundle offer (see
      // perform_offer_action), so the cards can be gone by now. Re-match them
      // here and hand the RPC the same {selection, before, remaining} triple the
      // buy path sends, which is what makes the inventory subtraction atomic.
      let bundleSelection: BundleItem[] | undefined;
      let bundleRemaining: BundleItem[] | undefined;

      if (card.is_bundle) {
        const stored = Array.isArray(offer.bundle_selection) ? offer.bundle_selection : [];
        if (stored.length === 0) {
          return NextResponse.json({
            error: 'This bundle offer did not name any cards. Ask the seller to reject it and send a new one.',
            code: 'bundle_offer_selection_missing',
          }, { status: 409 });
        }
        const items = Array.isArray(card.bundle_items) ? card.bundle_items : [];
        const selectors: BundleSelection[] = stored.map(item => ({
          title: String(item?.title ?? ''),
          price: Number(item?.price) || 0,
        }));
        const matched = matchBundleSelection(items, selectors);
        if (!matched) {
          return NextResponse.json({
            error: 'Some cards in this offer are no longer in the listing.',
            code: 'bundle_item_unavailable',
          }, { status: 409 });
        }
        bundleSelection = matched.matched;
        bundleRemaining = matched.remaining;
      }

      checkoutItems.push({
        offerId: offer.id,
        offerBuyerId: offer.buyer_id,
        card,
        // The agreed offer price, not the sum of the cards: the discount is the
        // whole point of an offer.
        amount: Number(offer.price),
        shippingFee: 0,
        bundleSelection,
        bundleRemaining,
      });
    }

    // Only sellers in the verified checkout may be quoted. A submitted map
    // must cover all of them; never silently replace a missing buyer choice.
    const checkoutSellerIds = [...new Set(checkoutItems.map(item => item.card.seller_id))];
    if (cartCarriers !== undefined && (
      Object.keys(cartCarriers).length !== checkoutSellerIds.length
      || checkoutSellerIds.some(sellerId => !Object.hasOwn(cartCarriers, sellerId))
    )) {
      return NextResponse.json({ error: 'Choose a carrier for each seller.', code: 'invalid_shipping_carrier' }, { status: 400 });
    }
    let shippingQuotes: Map<string, { carrier: string; fee: number }>;
    try {
      shippingQuotes = await quoteCheckoutConfiguredShippingBatch(checkoutSellerIds.map(sellerId => ({
        sellerId,
        carrier: mode === 'offer'
          ? (body.shipping_carrier ? String(body.shipping_carrier).trim() : undefined)
          : (cartCarriers !== undefined ? cartCarriers[sellerId].trim() : undefined),
        toProvinceId: Number(body.to_province_id),
        toProvinceName: String(body.to_province_name),
      })));
    } catch (shippingError) {
      const known = shippingError instanceof CheckoutShippingError;
      const code = known ? shippingError.code : 'shipping_quote_failed';
      if (!known) console.error('Checkout shipping quote failed:', shippingError);
      return NextResponse.json({
        error: 'Could not quote checkout shipping.',
        code,
        ...(known && shippingError.sellerId ? {
          seller_id: shippingError.sellerId,
          seller_name: shippingError.sellerName || null,
        } : {}),
      }, { status: code === 'shipping_quote_failed' ? 503 : 409 });
    }
    const chargedSellers = new Set<string>();
    for (const item of checkoutItems) {
      const sellerId = item.card.seller_id;
      const quote = shippingQuotes.get(sellerId)!;
      item.shippingFee = chargedSellers.has(sellerId) ? 0 : quote.fee;
      item.shippingCarrier = quote.carrier;
      chargedSellers.add(sellerId);
    }

    const totalPaid = checkoutItems.reduce((sum, item) => sum + item.amount + item.shippingFee, 0);
    const plannedOrderIds = checkoutItems.map((item, index) => stableFinancialUuid(
      `checkout:${user.id}:${idempotencyKey}:${index}:${item.card.id}`,
    ));
    const shipping = orderShipping(body as ShippingBody);

    // Wallet mutations go through the service-role client: RLS allows owners
    // to SELECT their wallet but all writes are server-trusted only.
    try {
      const reservedUntil = new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000).toISOString();
      const orderSpecs = checkoutItems.map((item, index) => ({
        order_id: plannedOrderIds[index],
        card_id: item.card.id,
        seller_id: item.card.seller_id,
        offer_id: item.offerId || null,
        amount: item.amount,
        shipping_fee: item.shippingFee,
        total_paid: item.amount + item.shippingFee,
        metadata: {
          api_request_hash: apiRequestHash,
          // What the seller ships with. Read by the fulfilment dialog.
          ...(item.shippingCarrier ? { shipping_carrier: item.shippingCarrier } : {}),
          // The immutable inventory snapshot a refund is allowed to restore,
          // written the same way /api/marketplace/buy writes it.
          ...(item.bundleSelection ? {
            bundle_selection: item.bundleSelection,
            bundle_items_before: item.card.bundle_items || [],
            bundle_inventory_state: 'reserved',
          } : {}),
        },
        ...(item.bundleSelection ? {
          bundle_items_before: item.card.bundle_items || [],
          bundle_remaining: item.bundleRemaining || [],
        } : {}),
        ...shipping,
      }));

      if (paymentMethod === 'wallet') {
        const { data: walletResultData, error: walletOrderError } = await service.rpc(
          'create_verified_wallet_marketplace_orders' as never,
          {
            p_user_id: user.id,
            p_orders: orderSpecs,
            p_idempotency_key: idempotencyKey,
            p_description: mode === 'offer' ? 'Card offer payment' : 'CardVerseHub cart payment',
          } as never,
        );
        if (walletOrderError || !walletResultData) {
          console.error('Atomic wallet checkout failed:', walletOrderError);
          const mapped = walletCheckoutError(walletOrderError);
          return NextResponse.json(
            { error: mapped.message, code: mapped.code },
            { status: mapped.status },
          );
        }
        const walletResult = walletResultData as unknown as { orders?: CreatedOrder[] };
        const orders = walletResult.orders || [];
        if (orders.length !== checkoutItems.length) {
          throw new Error('Atomic wallet checkout returned an inconsistent order count');
        }

        for (const item of checkoutItems) {
          const order = orders.find(order => order.card_id === item.card.id
            && order.seller_id === item.card.seller_id);
          if (!order?.id) throw new Error('Paid order missing for checkout notification');
          const { error: notificationError } = await service.from('notifications').insert({
            user_id: item.card.seller_id,
            type: 'order_new',
            title: 'New order!',
            message: `Card "${item.card.name}" was paid for. Please ship the order.`,
            card_id: item.card.id,
            offer_id: item.offerId || null,
            order_id: order.id,
          } as never);
          if (notificationError) {
            console.error('Checkout notification failed:', notificationError);
          }
        }

        // The bell alone left the seller guessing when to pack: put the receipt
        // in the thread the two of them are actually using. Driven off the rows
        // the RPC returned, so this and the replay path above stay identical.
        await announcePaidOrdersInChat(service, orders);

        if (mode === 'cart') {
          const cartItemIds = checkoutItems.map(item => item.cartItemId).filter(Boolean) as string[];
          await supabase.from('cart_items').delete().eq('user_id', user.id).in('id', cartItemIds);
        }

        return NextResponse.json({ success: true, orders, payment_method: 'wallet' });
      }

      const orderCode = randomInt(10_000_000, 99_999_999);
      const { data: stagedData, error: stageError } = await service.rpc(
        'stage_payos_marketplace_checkout' as never,
        {
          p_user_id: user.id,
          p_order_code: orderCode,
          p_orders: orderSpecs,
          p_idempotency_key: idempotencyKey,
          p_reserved_until: reservedUntil,
        } as never,
      );
      const staged = stagedData as unknown as {
        payment_order?: { id: string; order_code: number; payos_checkout_url?: string | null };
        orders?: CreatedOrder[];
      };
      const paymentOrder = staged?.payment_order;
      const orders = staged?.orders || [];
      if (stageError) {
        console.error('Atomic PayOS checkout staging failed:', stageError);
        const mapped = walletCheckoutError(stageError);
        return NextResponse.json(
          { error: mapped.message, code: mapped.code },
          { status: mapped.status },
        );
      }
      if (!paymentOrder || orders.length !== checkoutItems.length) {
        throw new Error('Could not stage PayOS checkout');
      }
      const persistedOrderCode = Number(paymentOrder.order_code);

      if (mode === 'cart') {
        const cartItemIds = checkoutItems.map(item => item.cartItemId).filter(Boolean) as string[];
        await supabase.from('cart_items').delete().eq('user_id', user.id).in('id', cartItemIds);
      }
      if (paymentOrder.payos_checkout_url) {
        return NextResponse.json({
          success: true,
          orders,
          payment_method: 'direct_payos',
          checkoutUrl: paymentOrder.payos_checkout_url,
          orderCode: persistedOrderCode,
        });
      }
      const linkClaim = await claimPayOSLinkCreation(service, user.id, persistedOrderCode);
      if (linkClaim.checkoutUrl) {
        return NextResponse.json({
          success: true,
          orders,
          payment_method: 'direct_payos',
          checkoutUrl: linkClaim.checkoutUrl,
          orderCode: persistedOrderCode,
          replayed: true,
        });
      }

      const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const paymentLink = await getPayOS().paymentRequests.create({
        orderCode: persistedOrderCode,
        amount: totalPaid,
        description: translateRequest(
          request,
          mode === 'offer' ? 'payos_description_offer_checkout' : 'payos_description_cart_checkout',
        ).slice(0, 25),
        expiredAt: Math.floor((Date.now() + RESERVATION_MINUTES * 60 * 1000) / 1000),
        cancelUrl: `${origin}/orders?status=cancelled`,
        returnUrl: `${origin}/orders?status=success`,
        items: checkoutItems.map(item => ({
          name: item.card.name.substring(0, 50),
          quantity: 1,
          price: item.amount + item.shippingFee,
        })),
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
        orders,
        payment_method: 'direct_payos',
        checkoutUrl: paymentLink.checkoutUrl,
        qrCode: paymentLink.qrCode,
        orderCode: persistedOrderCode,
      });
    } catch (err) {
      // Both wallet settlement and direct-PayOS database staging are atomic.
      // If the external provider call is uncertain, keep the reservation
      // fail-closed for webhook/retry/expiry recovery rather than releasing a
      // potentially payable order back to the marketplace.
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
