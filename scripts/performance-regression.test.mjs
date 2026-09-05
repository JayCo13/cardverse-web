import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Exercise the real TypeScript handlers with isolated database/payment mocks.
// No environment secrets, network, payment, or database writes are used.
const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
function loadTs(path, mocks = {}) {
  const filename = fileURLToPath(new URL(path, root));
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  });
  const compiledModule = { exports: {} };
  runInNewContext(outputText, {
    module: compiledModule, exports: compiledModule.exports, console, process: { env: {} },
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === 'crypto') return require('node:crypto');
      throw new Error(`Unmocked dependency: ${name}`);
    },
  }, { filename });
  return compiledModule.exports;
}

const nextServer = {
  NextResponse: { json: (data, init) => new Response(JSON.stringify(data), init) },
};
function query(result, calls, table) {
  const chain = {};
  for (const method of ['select', 'eq', 'in', 'single', 'maybeSingle', 'returns', 'order', 'limit', 'delete', 'insert']) {
    chain[method] = (...args) => {
      calls.push({ table, method, args });
      return chain;
    };
  }
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
}
const routeUser = loadTs('src/lib/supabase/route-user.ts');

// Routes resolve their caller through getRouteUser, which reads the verified
// JWT claims rather than asking the auth server for the whole user record.
// The stub answers the same shape the library does.
const claimsAuth = (userId) => ({
  getClaims: async () => (userId
    ? { data: { claims: { sub: userId, email: `${userId}@example.test` } }, error: null }
    : { data: null, error: { message: 'no session' } }),
  getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
});

const shippingFee = loadTs('src/lib/shipping-fee.ts');
function shippingHarness(profiles, error = null) {
  const calls = [];
  const service = { from: table => query({ data: profiles, error }, calls, table) };
  const shipping = loadTs('src/lib/verified-shipping.ts', {
    'server-only': {},
    '@/lib/ghn': {},
    '@/lib/shipping-fee': shippingFee,
    '@/lib/supabase/service': { createServiceSupabaseClient: () => service },
  });
  return { shipping, calls };
}
const seller = (id, fees = { intra: 20000, inter: 30000, region: 40000 }) => ({
  id, shipping_carriers: ['self', 'ghn'], shipping_fees: { ghn: fees },
  address_province_id: 1, address_province_name: 'Hà Nội',
});
const quoteInput = sellerId => ({ sellerId, toProvinceId: 1, toProvinceName: 'Hà Nội' });

test('shipping batch reads profiles once and matches single-seller quoting', async () => {
  const { shipping, calls } = shippingHarness([seller('s1'), seller('s2')]);
  const result = await shipping.quoteCheapestConfiguredShippingBatch([quoteInput('s1'), quoteInput('s2'), quoteInput('s1')]);
  assert.equal(calls.filter(call => call.method === 'select').length, 1);
  assert.deepEqual(Array.from(calls.find(call => call.method === 'in').args[1]), ['s1', 's2']);
  for (const id of ['s1', 's2']) {
    const single = shippingHarness(seller(id)).shipping;
    assert.equal(JSON.stringify(result.get(id)), JSON.stringify(await single.quoteCheapestConfiguredShipping(quoteInput(id))));
  }
});

test('shipping batch rejects missing sellers, invalid fees, and database errors', async () => {
  await assert.rejects(shippingHarness([]).shipping.quoteCheapestConfiguredShippingBatch([quoteInput('missing')]), /configuration_missing/);
  await assert.rejects(shippingHarness([seller('s1', { intra: 0 })]).shipping.quoteCheapestConfiguredShippingBatch([quoteInput('s1')]), /fee_not_configured/);
  await assert.rejects(shippingHarness(null, { message: 'offline' }).shipping.quoteCheapestConfiguredShippingBatch([quoteInput('s1')]), /shipping_quote_failed/);
});

function checkoutHarness({ authenticated = true, missingCart = false, cardOverride = {}, shippingError = false, offerMode = false, multipleSellers = false, seller2Overrides = {} } = {}) {
  const calls = [];
  const cart = [{ id: 'cart1', card_id: 'card1', user_id: 'buyer' }, { id: 'cart2', card_id: 'card2', user_id: 'buyer' }];
  if (multipleSellers) cart.push({ id: 'cart3', card_id: 'card3', user_id: 'buyer' });
  const cards = cart.map(item => ({ id: item.card_id, seller_id: item.card_id === 'card3' ? 'seller2' : 'seller', name: 'Card', price: 100000, status: 'active', listing_type: 'sale', is_bundle: false, bundle_items: null, ...cardOverride }));
  let settlement;
  const supabase = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'buyer' } : null }, error: null }) },
    from: table => query({ data: table === 'offers' ? { id: 'offer1', card_id: 'card1', buyer_id: 'buyer', price: 75000, status: 'chosen' } : table === 'orders' ? null : table === 'cart_items' ? (missingCart ? [] : cart) : offerMode ? cards[0] : cards, error: null }, calls, table),
    rpc: async name => { calls.push({ rpc: name }); return { data: 0, error: null }; },
  };
  const service = {
    from: table => query({ data: null, error: null }, calls, table),
    rpc: async (name, payload) => {
      calls.push({ rpc: name });
      if (name === 'get_marketplace_checkout_replay') return { data: { found: false }, error: null };
      settlement = payload;
      if (name === 'stage_payos_marketplace_checkout') {
        return { data: {
          payment_order: { id: 'payment1', order_code: payload.p_order_code, payos_checkout_url: 'https://pay.example.test/checkout' },
          orders: payload.p_orders.map(order => ({ ...order, id: order.order_id })),
        }, error: null };
      }
      assert.equal(name, 'create_verified_wallet_marketplace_orders');
      return { data: { orders: payload.p_orders.map(order => ({ ...order, id: order.order_id })) }, error: null };
    },
  };
  const route = loadTs('src/app/api/checkout/route.ts', {
    'next/server': nextServer,
    '@/lib/supabase/server': { createServerSupabaseClient: async () => supabase },
    '@/lib/supabase/service': { createServiceSupabaseClient: () => service },
    '@/lib/financial-idempotency': { hashFinancialRequest: input => { calls.push({ hashInput: input }); return loadTs('src/lib/financial-idempotency.ts').hashFinancialRequest(input); }, stableFinancialUuid: value => value },
    '@/lib/payos': {}, '@/lib/payos-link-claim': {}, '@/lib/request-localization': {},
    '@/lib/wallet-checkout-error': {}, '@/lib/bundle': {},
    '@/lib/order-paid-chat': { announcePaidOrdersInChat: async () => {} },
    '@/lib/verified-shipping': shippingHarness([
      { ...seller('seller'), shipping_carriers: ['ghn', 'vtp'], shipping_fees: { ghn: { intra: 20000, region: 40000 }, vtp: { intra: 35000, region: 55000 } } },
      { ...seller('seller2'), display_name: 'Second Seller', shipping_carriers: ['ghn'], shipping_fees: { ghn: { intra: 15000, region: 30000 } }, ...seller2Overrides },
    ], shippingError ? { message: 'missing profile' } : null).shipping,
  });
  const request = (items = [{ cart_item_id: 'cart1' }, { cart_item_id: 'cart2' }]) => ({
    headers: new Headers({ 'idempotency-key': '11111111-1111-4111-8111-111111111111' }),
    json: async () => ({ mode: 'cart', payment_method: 'wallet', items, to_name: 'Test', to_phone: 'test', to_district_id: 1, to_district_name: 'District', to_province_id: 1, to_province_name: 'Hà Nội', to_ward_code: '1', to_ward_name: 'Ward', to_address_detail: 'Test' }),
  });
  return { route, request, calls, settlement: () => settlement };
}

test('cart checkout batches reads while retaining atomic RPC, ordering, and one fee per seller', async () => {
  const h = checkoutHarness();
  const response = await h.route.POST(h.request([{ cart_item_id: 'cart2', shipping_fee: 1 }, { cart_item_id: 'cart1', shipping_fee: 999999 }]));
  assert.equal(response.status, 200);
  assert.equal(h.calls.filter(call => call.method === 'select' && ['cart_items', 'cards'].includes(call.table)).length, 2);
  assert.ok(h.calls.some(call => call.table === 'cart_items' && call.method === 'eq' && call.args[0] === 'user_id' && call.args[1] === 'buyer'));
  const orders = h.settlement().p_orders;
  assert.deepEqual(Array.from(orders, order => order.card_id), ['card2', 'card1']);
  assert.deepEqual(Array.from(orders, order => order.shipping_fee), [20000, 0]);
  assert.ok(orders.every(order => order.metadata.shipping_carrier === 'ghn'));
  assert.equal(orders.reduce((sum, order) => sum + order.total_paid, 0), 220000);
  assert.equal(h.settlement().p_idempotency_key, '11111111-1111-4111-8111-111111111111');
});

for (const [name, options, expected] of [
  ['anonymous', { authenticated: false }, 401],
  ['foreign/missing cart row', { missingCart: true }, 404],
  ['sold card', { cardOverride: { status: 'sold' } }, 409],
  ['own listing', { cardOverride: { seller_id: 'buyer' } }, 400],
  ['bundle cart item', { cardOverride: { is_bundle: true } }, 409],
  ['shipping database unavailable', { shippingError: true }, 503],
]) {
  test(`checkout rejects ${name} before settlement`, async () => {
    const h = checkoutHarness(options);
    assert.equal((await h.route.POST(h.request())).status, expected);
    assert.equal(h.settlement(), undefined);
  });
}

test('checkout rejects duplicate cart ids before settlement', async () => {
  const h = checkoutHarness();
  assert.equal((await h.route.POST(h.request([{ cart_item_id: 'cart1' }, { cart_item_id: 'cart1' }]))).status, 400);
  assert.equal(h.settlement(), undefined);
});

test('wallet notifications identify each exact paid order', async () => {
  const h = checkoutHarness();
  assert.equal((await h.route.POST(h.request())).status, 200);
  const notifications = h.calls.filter(call => call.table === 'notifications' && call.method === 'insert');
  assert.equal(notifications.length, 2);
  for (const { args: [notification] } of notifications) {
    const order = h.settlement().p_orders.find(order => order.card_id === notification.card_id);
    assert.equal(notification.order_id, order.order_id);
    assert.equal(notification.user_id, order.seller_id);
  }
});

for (const carrier of ['vtp', 'ghn', 'self', 'unknown']) {
  test(`offer checkout validates selected carrier ${carrier} and ignores browser fees`, async () => {
    const h = checkoutHarness({ offerMode: true });
    const request = h.request();
    const body = await request.json();
    request.json = async () => ({ ...body, mode: 'offer', offer_id: 'offer1', shipping_carrier: carrier, shipping_fee: 1 });
    const response = await h.route.POST(request);
    if (carrier === 'self' || carrier === 'unknown') {
      assert.equal(response.status, 409);
      assert.equal(h.settlement(), undefined);
      return;
    }
    assert.equal(response.status, 200);
    const order = h.settlement().p_orders[0];
    assert.equal(order.amount, 75000);
    assert.equal(order.shipping_fee, carrier === 'vtp' ? 35000 : 20000);
    assert.equal(order.metadata.shipping_carrier, carrier);
    assert.equal(h.calls.find(call => call.hashInput).hashInput.shipping_carrier, carrier);
    const notification = h.calls.find(call => call.table === 'notifications' && call.method === 'insert').args[0];
    assert.equal(notification.order_id, order.order_id);
    assert.equal(notification.offer_id, 'offer1');
  });
}

for (const paymentMethod of ['wallet', 'direct_payos']) {
  test(`cart ${paymentMethod} charges each seller once and preserves independent carrier choices`, async () => {
    const h = checkoutHarness({ multipleSellers: true });
    const request = h.request([{ cart_item_id: 'cart1' }, { cart_item_id: 'cart3' }, { cart_item_id: 'cart2' }]);
    const body = await request.json();
    request.json = async () => ({ ...body, payment_method: paymentMethod, shipping_carriers: { seller: 'vtp', seller2: 'ghn' }, shipping_fee: 1 });
    const response = await h.route.POST(request);
    assert.equal(response.status, 200);
    const orders = h.settlement().p_orders;
    assert.deepEqual(Array.from(orders, order => order.shipping_fee), [35000, 15000, 0]);
    assert.deepEqual(Array.from(orders, order => order.metadata.shipping_carrier), ['vtp', 'ghn', 'vtp']);
    assert.equal(orders.reduce((sum, order) => sum + order.total_paid, 0), 350000);
    assert.equal(h.calls.filter(call => call.table === 'notifications' && call.method === 'insert').length, paymentMethod === 'wallet' ? 3 : 0);
    if (paymentMethod === 'direct_payos') assert.equal((await response.json()).checkoutUrl, 'https://pay.example.test/checkout');
  });
}

for (const [carriers, expected] of [
  [{ seller: 'ghn' }, 400],
  [{ seller: 'ghn', foreign: 'vtp' }, 400],
  [{ seller: 'ghn', seller2: 'vtp' }, 409],
  [{ seller: 'ghn', seller2: 'self' }, 409],
  [{ seller: 'ghn', seller2: '' }, 400],
  [[], 400], [null, 400],
]) {
  test(`cart rejects invalid carrier mapping ${JSON.stringify(carriers)}`, async () => {
    const h = checkoutHarness({ multipleSellers: true });
    const request = h.request([{ cart_item_id: 'cart1' }, { cart_item_id: 'cart2' }, { cart_item_id: 'cart3' }]);
    const body = await request.json();
    request.json = async () => ({ ...body, shipping_carriers: carriers });
    assert.equal((await h.route.POST(request)).status, expected);
    assert.equal(h.settlement(), undefined);
  });
}

test('carrier choices affect idempotency even with equal fees; object key order does not', () => {
  const { hashFinancialRequest } = loadTs('src/lib/financial-idempotency.ts');
  const first = hashFinancialRequest({ shipping_carriers: { seller: 'ghn', seller2: 'vtp' } });
  assert.notEqual(first, hashFinancialRequest({ shipping_carriers: { seller: 'vtp', seller2: 'vtp' } }));
  assert.equal(first, hashFinancialRequest({ shipping_carriers: { seller2: 'vtp', seller: 'ghn' } }));
});

test('selected shipping batch recalculates tiers and validates each seller in one read', async () => {
  const { shipping, calls } = shippingHarness([
    { ...seller('s1'), shipping_carriers: ['ghn', 'vtp'], shipping_fees: { ghn: { intra: 20000, region: 40000 }, vtp: { intra: 35000, region: 55000 } } },
    seller('s2'),
  ]);
  const quotes = await shipping.quoteCheckoutConfiguredShippingBatch([
    { ...quoteInput('s1'), carrier: 'vtp', toProvinceId: 2, toProvinceName: 'Hồ Chí Minh' },
    { ...quoteInput('s2'), carrier: 'ghn' },
  ]);
  assert.equal(quotes.get('s1').fee, 55000);
  assert.equal(quotes.get('s2').fee, 20000);
  assert.equal(calls.filter(call => call.method === 'select').length, 1);
  await assert.rejects(shipping.quoteCheckoutConfiguredShippingBatch([{ ...quoteInput('s2'), carrier: 'vtp' }]), /invalid_shipping_carrier/);
});

for (const [overrides, expectedCode] of [
  [{ shipping_fees: { ghn: {} } }, 'shipping_fee_not_configured'],
  [{ address_province_name: null }, 'seller_shipping_origin_missing'],
  [{ shipping_carriers: ['vtp'] }, 'invalid_shipping_carrier'],
]) {
  test(`checkout identifies the affected seller for ${expectedCode}`, async () => {
    const h = checkoutHarness({ multipleSellers: true, seller2Overrides: overrides });
    const request = h.request([{ cart_item_id: 'cart1' }, { cart_item_id: 'cart2' }, { cart_item_id: 'cart3' }]);
    const body = await request.json();
    request.json = async () => ({ ...body, shipping_carriers: { seller: 'ghn', seller2: 'ghn' } });
    const response = await h.route.POST(request);
    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.equal(payload.code, expectedCode);
    assert.equal(payload.seller_id, 'seller2');
    assert.equal(payload.seller_name, 'Second Seller');
    assert.equal(h.settlement(), undefined);
  });
}

test('shipping read failure does not blame any seller configuration', async () => {
  const h = checkoutHarness({ shippingError: true });
  const response = await h.route.POST(h.request());
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.code, 'shipping_quote_failed');
  assert.equal(payload.seller_id, undefined);
  assert.equal(h.settlement(), undefined);
});

test('balance-only wallet read skips history and maintenance but preserves auth and ownership', async () => {
  const calls = [];
  let authenticated = true;
  const supabase = {
    get auth() { return claimsAuth(authenticated ? 'buyer' : null); },
    from: table => query({ data: { available_balance: 200000 }, error: null }, calls, table),
    rpc: async () => { throw new Error('Balance view must not call RPCs'); },
  };
  const route = loadTs('src/app/api/wallet/route.ts', {
    'next/server': nextServer,
    '@/lib/supabase/server': { createServerSupabaseClient: async () => supabase },
    '@/lib/supabase/service': {},
    '@/lib/supabase/route-user': routeUser,
  });
  const request = { nextUrl: new URL('http://localhost/api/wallet?view=balance') };
  const response = await route.GET(request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.ok(calls.every(call => call.table === 'wallets'));
  assert.ok(calls.some(call => call.method === 'eq' && call.args[0] === 'user_id' && call.args[1] === 'buyer'));
  authenticated = false;
  assert.equal((await route.GET(request)).status, 401);
});

test('cart badge reads an owner-scoped count without downloading card rows', async () => {
  const calls = [];
  const supabase = {
    auth: claimsAuth('buyer'),
    from: table => query({ count: 3, error: null }, calls, table),
  };
  const route = loadTs('src/app/api/cart/route.ts', {
    'next/server': nextServer,
    '@/lib/supabase/server': { createServerSupabaseClient: async () => supabase },
    '@/lib/supabase/route-user': routeUser,
  });
  const response = await route.GET({ nextUrl: new URL('http://localhost/api/cart?view=count') });
  assert.deepEqual(await response.json(), { count: 3 });
  assert.equal(calls.find(call => call.method === 'select').args[1].head, true);
  assert.ok(calls.some(call => call.method === 'eq' && call.args[0] === 'user_id' && call.args[1] === 'buyer'));
});

test('account summary answers both badges from one auth check and three independent queries', async () => {
  const calls = [];
  let authenticated = true;
  const results = {
    cart_items: { count: 3, error: null },
    offers: null, // set per call below
  };
  let offersCall = 0;
  const supabase = {
    get auth() { return claimsAuth(authenticated ? 'buyer' : null); },
    from(table) {
      if (table !== 'offers') return query(results[table], calls, table);
      // First offers query is the received-pending join, second is the sent count.
      const result = offersCall++ === 0
        ? { data: [{ card_id: 'card-a' }, { card_id: 'card-a' }, { card_id: 'card-b' }], error: null }
        : { count: 2, error: null };
      return query(result, calls, table);
    },
  };
  const route = loadTs('src/app/api/account/summary/route.ts', {
    'next/server': nextServer,
    '@/lib/supabase/server': { createServerSupabaseClient: async () => supabase },
    '@/lib/supabase/route-user': routeUser,
  });

  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {
    cartCount: 3,
    receivedPending: 3,
    sentAwaitingPayment: 2,
    actionCount: 5,
    cardPendingCounts: { 'card-a': 2, 'card-b': 1 },
  });

  // Three tables, no fourth round trip, and the cart badge stays head-only.
  assert.deepEqual([...new Set(calls.map(call => call.table))].sort(), ['cart_items', 'offers']);
  const cartSelect = calls.find(call => call.table === 'cart_items' && call.method === 'select');
  assert.equal(cartSelect.args[1].head, true);

  // The received-pending count must come from a join, not from a preceding
  // read of every card the seller owns.
  assert.ok(!calls.some(call => call.table === 'cards'));
  const receivedSelect = calls.find(call => call.table === 'offers' && call.method === 'select');
  assert.match(receivedSelect.args[0], /cards!inner\(seller_id\)/);
  assert.ok(calls.some(call => call.method === 'eq' && call.args[0] === 'cards.seller_id' && call.args[1] === 'buyer'));

  // Owner scoping on both sides.
  assert.ok(calls.some(call => call.table === 'cart_items' && call.method === 'eq' && call.args[0] === 'user_id' && call.args[1] === 'buyer'));
  assert.ok(calls.some(call => call.table === 'offers' && call.method === 'eq' && call.args[0] === 'buyer_id' && call.args[1] === 'buyer'));

  authenticated = false;
  assert.equal((await route.GET()).status, 401);
});
