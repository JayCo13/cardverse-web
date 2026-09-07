import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, mocks = {}) {
  const output = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, Intl, require: name => {
    if (!(name in mocks)) throw new Error(`Unexpected import ${name}`);
    return mocks[name];
  } });
  return exports;
}

function route(user, records, calls) {
  const client = {
    auth: { getUser: async () => ({ data: { user } }) },
    from(table) {
      const chain = {};
      for (const method of ['select', 'eq', 'order', 'limit', 'in', 'returns']) {
        chain[method] = (...args) => { calls.push({ table, method, args }); return chain; };
      }
      chain.then = resolve => Promise.resolve({ data: records[table] ?? [], error: null }).then(resolve);
      return chain;
    },
  };
  return load('../src/app/api/notifications/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => client },
  });
}
test('notifications API rejects anonymous requests without querying tables', async () => {
  const calls = [];
  assert.equal((await route(null, {}, calls).GET()).status, 401);
  assert.equal(calls.length, 0);
});
test('legacy enrichment is bounded, owner-scoped and does not infer refund amounts', async () => {
  const calls = [];
  const result = await route({ id: 'buyer' }, {
    notifications: [{ id: 'n', user_id: 'buyer', order_id: 'order', card_id: 'card', metadata: {}, type: 'order_refunded' }],
    orders: [{ id: 'order', buyer_id: 'buyer', seller_id: 'seller', card_id: 'card', total_paid: 999999 }],
    profiles: [{ id: 'seller', display_name: 'Seller Name' }],
    cards: [{ id: 'card', name: 'Card Name' }],
  }, calls).GET();
  const metadata = result.body.notifications[0].metadata;
  assert.equal(metadata.counterparty_name, 'Seller Name');
  assert.equal(metadata.amount, undefined);
  assert.equal(metadata.recipient_role, 'buyer');
  assert.ok(calls.some(call => call.table === 'notifications' && call.method === 'eq' && call.args[0] === 'user_id' && call.args[1] === 'buyer'));
  assert.ok(calls.some(call => call.method === 'limit' && call.args[0] === 20));
  assert.equal(calls.filter(call => call.table === 'profiles' && call.method === 'select').length, 1);
});
const { localizeSystemNotification: format } = load('../src/lib/localized-notifications.ts');
const sample = { id: 'n', orderId: 'abcdefgh-1234', type: 'order_refunded', title: 'raw', message: 'raw', metadata: {} };
for (const locale of ['vi', 'en', 'ja']) {
  const dictionary = load(`../src/lib/i18n/${locale}.ts`)[locale];
  const t = key => { assert.equal(typeof dictionary[key], 'string', key); return dictionary[key]; };
  test(`${locale}: distinguishes counterparty and order without inventing money`, () => {
    const result = format({ ...sample, metadata: { recipient_role: 'buyer', counterparty_name: 'Minh', card_name: 'Pikachu' } }, t);
    assert.equal(JSON.stringify(result.contextLines), JSON.stringify([
      '#ABCDEFGH',
      `${dictionary.notification_context_seller}: Minh`,
      `${dictionary.notification_context_card}: Pikachu`,
    ]));
    assert.ok(!result.context.includes(' · '));
    assert.ok(!result.message.includes('₫'));
  });
  test(`${locale}: recipient role and immutable delivered event`, () => {
    const result = format({ ...sample, type: 'shipping_update', metadata: { event: 'delivered', recipient_role: 'seller', counterparty_name: 'Buyer' } }, t);
    assert.equal(result.title, dictionary.notification_context_delivered);
    assert.equal(result.message, dictionary.notification_context_delivered_seller);
    assert.ok(result.contextLines.includes(`${dictionary.notification_context_buyer}: Buyer`));
  });
  test(`${locale}: verified refund and missing legacy context`, () => {
    assert.match(format({ ...sample, metadata: { event: 'wallet_refund', amount: 125000 } }, t).message, /125\.000 ₫/);
    assert.equal(JSON.stringify(format(sample, t).contextLines), JSON.stringify(['#ABCDEFGH']));
    for (const type of ['offer_expired', 'offer_payment_expired', 'offer_card_taken', 'unboxing_video_submitted']) {
      const result = format({ ...sample, type }, t);
      assert.notEqual(result.title, 'raw');
      assert.ok(!JSON.stringify(result).includes('undefined'));
    }
  });
}
