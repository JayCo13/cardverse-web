import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, mocks) {
  const code = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, console, process, require: key => {
    if (!(key in mocks)) throw new Error(`Unexpected import ${key}`);
    return mocks[key];
  } });
  return exports;
}
const { shipmentCarriers } = load('../src/lib/shipment-carriers.ts', {
  '@/lib/shipping-carriers': { OFFERABLE_COURIERS: [{ code: 'ghn' }, { code: 'shopee' }, { code: 'jnt' }] },
});
test('shop preferences exclude other and retired carriers; empty preferences retain defaults', () => {
  assert.equal(JSON.stringify(shipmentCarriers(['ghn', 'best'])), '["ghn"]');
  assert.equal(shipmentCarriers([]).length, 3);
  assert.equal(shipmentCarriers(['best']).length, 3);
});
function setup({ user = { id: 'seller' }, order = { status: 'paid', to_goship: null, goship_code: null }, valid = true, write = { id: 'order' } } = {}) {
  const calls = [];
  const chain = (table, service = false) => {
    const builder = {};
    for (const method of ['select', 'eq', 'is', 'update']) builder[method] = (...args) => { calls.push({ table, service, method, args }); return builder; };
    builder.maybeSingle = builder.single = async () => ({ data: service ? write : table === 'orders' ? order : { goship_pickup: { city: '970000' }, shipping_carriers: ['ghn'], shipping_fees: {} }, error: null });
    return builder;
  };
  const api = load('../src/app/api/shipping/preparation/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
    '@/lib/account-route': { accountRoute: fn => fn },
    '@/lib/supabase/server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) }, from: table => chain(table) }) },
    '@/lib/supabase/service': { createServiceSupabaseClient: () => ({ from: table => chain(table, true) }) },
    '@/lib/shipment-carriers': { shipmentCarriers },
    '@/lib/goship': Object.fromEntries(['goshipCities', 'goshipDistricts', 'goshipWards'].map(key => [key, async () => ({ ok: true, data: valid ? [{ id: '1' }] : [] })])),
  });
  const request = method => ({ method, nextUrl: new URL('http://local?orderId=79c60a39-bced-4f83-b0ff-15f9cc125a20'), json: async () => ({ city: '1', district: '1', ward: '1' }) });
  return { api, calls, request };
}
test('anonymous and other sellers cannot read preparation', async () => {
  for (const [options, expected] of [[{ user: null }, 401], [{ order: null }, 404]]) {
    const { api, request, calls } = setup(options);
    assert.equal((await api.GET(request('GET'))).status, expected);
    assert.ok(!calls.some(c => c.service));
  }
});
test('preparation uses seller scoped order and exposes saved shop configuration', async () => {
  const { api, request, calls } = setup();
  const result = await api.GET(request('GET'));
  assert.equal(result.body.data.pickup.city, '970000');
  assert.ok(calls.some(c => c.table === 'orders' && c.method === 'eq' && c.args[0] === 'seller_id' && c.args[1] === 'seller'));
});
test('destination update writes only carrier divisions, conditionally, without touching address book or money', async () => {
  const { api, request, calls } = setup();
  assert.equal((await api.PUT(request('PUT'))).status, 200);
  const writes = calls.filter(c => c.method === 'update');
  assert.equal(writes.length, 1);
  assert.equal(JSON.stringify(Object.keys(writes[0].args[0])), '["to_goship"]');
  for (const field of ['goship_code', 'to_goship']) assert.ok(calls.some(c => c.service && c.method === 'is' && c.args[0] === field));
});
test('invalid divisions, booked orders, existing destination and concurrent updates refuse writes', async () => {
  for (const [options, status] of [[{ valid: false }, 400], [{ order: { status: 'shipping' } }, 409], [{ order: { status: 'paid', to_goship: {} } }, 409], [{ write: null }, 409]]) {
    const { api, request } = setup(options);
    assert.equal((await api.PUT(request('PUT'))).status, status);
  }
});
