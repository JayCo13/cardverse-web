import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);

function loadCarrierNotifications(sent) {
  const filename = new URL('src/lib/carrier-notifications.ts', root);
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename.pathname,
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    console,
    require(name) {
      if (name === '@/lib/shipping-carriers') {
        return { getCarrier: () => ({ name: 'GHN' }), getTrackingUrl: () => 'https://tracking.test' };
      }
      if (name === '@/lib/mail') {
        return {
          sendOrderDeliveredEmail: async (to, params) => sent.push({ kind: 'buyer-delivered', to, params }),
          sendOrderDeliveredToSellerEmail: async (to, params) => sent.push({ kind: 'seller-delivered', to, params }),
          sendOrderInTransitEmail: async (to, params) => sent.push({ kind: 'buyer-moving', to, params }),
        };
      }
      throw new Error(`Unexpected import: ${name}`);
    },
  }, { filename: filename.pathname });
  return exports;
}

function serviceWith({ buyerEmail = 'buyer@example.test', sellerEmail = 'seller@example.test' } = {}) {
  const order = {
    buyer_id: 'buyer', seller_id: 'seller', card_id: 'card', shipping_provider: 'ghn',
    tracking_number: 'TRACK', auto_complete_at: '2026-09-19T10:00:00.000Z',
  };
  return {
    from(table) {
      let id;
      const query = {
        select() { return query; },
        eq(_column, value) { id = value; return query; },
        async single() {
          if (table === 'orders') return { data: order };
          if (table === 'cards') return { data: { name: 'Test card' } };
          if (table === 'profiles') {
            return { data: { email: id === 'buyer' ? buyerEmail : sellerEmail } };
          }
          throw new Error(`Unexpected table: ${table}`);
        },
      };
      return query;
    },
  };
}

test('first Delivered transition emails buyer and seller with the same deadline', async () => {
  const sent = [];
  const { notifyCarrierStatusChange } = loadCarrierNotifications(sent);
  await notifyCarrierStatusChange(serviceWith(), {
    order_id: 'order-id', status: 'Delivered', from_status: 'OutForDelivery',
  });
  assert.deepEqual(sent.map(item => [item.kind, item.to]), [
    ['buyer-delivered', 'buyer@example.test'],
    ['seller-delivered', 'seller@example.test'],
  ]);
  assert.equal(sent[0].params.autoCompleteAt, sent[1].params.autoCompleteAt);
});

test('a missing buyer email does not suppress the seller delivery email', async () => {
  const sent = [];
  const { notifyCarrierStatusChange } = loadCarrierNotifications(sent);
  await notifyCarrierStatusChange(serviceWith({ buyerEmail: '' }), {
    order_id: 'order-id', status: 'Delivered', from_status: 'InTransit',
  });
  assert.deepEqual(sent.map(item => item.kind), ['seller-delivered']);
});

test('an RPC replay result without a transition status sends no mail', async () => {
  const sent = [];
  const { notifyCarrierStatusChange } = loadCarrierNotifications(sent);
  await notifyCarrierStatusChange(serviceWith(), { order_id: 'order-id' });
  assert.equal(sent.length, 0);
});

test('delivery migration creates both bells only inside the first Delivered transition', () => {
  const sql = readFileSync(new URL('supabase/migrations/20260916000300_goship_delivery_notifications.sql', root), 'utf8');
  assert.match(sql, /if p_status = 'Delivered' and v_order\.status in \('paid', 'shipping'\) then/);
  assert.equal((sql.match(/'shipping_update'/g) || []).length, 2);
  assert.match(sql, /if v_order\.carrier_status = p_status then[\s\S]*?'replayed'/);
});

test('order detail copy promises auto-payout only for carrier-confirmed delivery', () => {
  const page = readFileSync(new URL('src/app/orders/[id]/page.tsx', root), 'utf8');
  assert.match(page, /order\?\.status === 'delivered'/);
  assert.match(page, /order\?\.carrier_status === 'Delivered'/);
  assert.match(page, /order\?\.ghn_status === 'delivered'/);
  assert.match(page, /deliveryConfirmed\s*\? tx\([\s\S]*?tự hoàn tất[\s\S]*?: tx\([\s\S]*?quản trị viên kiểm tra/);
});
