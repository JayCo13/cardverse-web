/**
 * What a buyer is charged and what a seller is paid, checked in isolation.
 *
 * These are the pure functions behind every shipping number on the site — the
 * distance tier, the shop table fall-through, the listing override, khai giá,
 * and the payout arithmetic that seller_payout_for performs in SQL. No network,
 * no database: run it after touching any of them.
 *
 *   npm run verify:shipping
 *
 * The payout case is a deliberate duplicate of the SQL. It is here because the
 * SQL version only runs when a migration is applied, and the rule it encodes —
 * a seller never goes below zero, and never keeps the surplus — is the one most
 * likely to be broken by a change made somewhere else.
 */

import assert from 'node:assert/strict';
import {
  PLATFORM_SHIPPING_FEE,
  listingShippingFee,
  parcelShippingFee,
  resolveShippingTier,
  shopShippingFee,
  type ShopFeeTable,
} from '../src/lib/shipping-fee.ts';
import {
  KHAI_GIA_FREE_ALLOWANCE,
  khaiGiaSurcharge,
} from '../src/lib/khai-gia.ts';
import { booksWithCarrier, carrierServesTier } from '../src/lib/shipping-carriers.ts';
import { listingShippingRange, parcelShippingRange, shopShippingRange } from '../src/lib/shipping-range.ts';

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn(); passed++; console.log('  ok  ' + name);
};

console.log('\n— khai giá, against the measured sweep —');
check('nothing is charged below the allowance', () => {
  for (const c of ['ghn', 'best', 'jnt', 'shopee', 'vnp']) assert.equal(khaiGiaSurcharge(c, 950_000), 0);
});
check('the free allowance is 1,000,000đ', () => assert.equal(KHAI_GIA_FREE_ALLOWANCE, 1_000_000));
check('GHN charges 0.5% of the FULL value from 1tr', () => assert.equal(khaiGiaSurcharge('ghn', 1_000_000), 5_000));
check('GHN has no ceiling — a 20tr card costs 100,000đ', () => assert.equal(khaiGiaSurcharge('ghn', 20_000_000), 100_000));
check('SPX is free at 2.9tr', () => assert.equal(khaiGiaSurcharge('shopee', 2_900_000), 0));
check('SPX steps to a flat 25,000đ at exactly 3tr', () => assert.equal(khaiGiaSurcharge('shopee', 3_000_000), 25_000));
check('and stays flat at 10tr', () => assert.equal(khaiGiaSurcharge('shopee', 10_000_000), 25_000));
check('VNPost never charges, even at 100tr', () => assert.equal(khaiGiaSurcharge('vnp', 100_000_000), 0));
check('BEST is 0.5% at exactly 10tr', () => assert.equal(khaiGiaSurcharge('best', 10_000_000), 50_000));
check('BEST doubles to 1% one đồng later', () => assert.equal(khaiGiaSurcharge('best', 10_000_001), 100_001));
check('BEST stays 1% at 100tr', () => assert.equal(khaiGiaSurcharge('best', 100_000_000), 1_000_000));
check('GHN does NOT double — still 0.5% at 100tr', () => assert.equal(khaiGiaSurcharge('ghn', 100_000_000), 500_000));
check('an unknown carrier is assumed to charge nothing', () => assert.equal(khaiGiaSurcharge('nope', 10_000_000), 0));
check('hand delivery has no khai giá', () => assert.equal(khaiGiaSurcharge('self', 10_000_000), 0));

console.log('\n— which carriers can serve which distance —');
check('hand delivery is same-province only', () => {
  assert.equal(carrierServesTier('self', 'intra'), true);
  assert.equal(carrierServesTier('self', 'inter'), false);
  assert.equal(carrierServesTier('self', 'region'), false);
});
check('couriers serve every distance', () => {
  for (const c of ['ghn', 'vnp', 'shopee', 'best', 'jnt']) {
    for (const t of ['intra', 'inter', 'region'] as const) assert.equal(carrierServesTier(c, t), true);
  }
});
check('an unknown carrier serves nothing', () => assert.equal(carrierServesTier('nope', 'intra'), false));

console.log('\n— hand delivery is not a price —');
check('meeting someone books no carrier', () => assert.equal(booksWithCarrier('self'), false));
check('every courier does', () => {
  for (const c of ['ghn', 'vnp', 'shopee', 'best', 'jnt']) assert.equal(booksWithCarrier(c), true);
});
check('an unknown code is assumed to cost money', () => assert.equal(booksWithCarrier('nope'), true));

console.log('\n— tier resolution —');
check('same province by name', () => assert.equal(
  resolveShippingTier({ provinceName: 'TP. Hồ Chí Minh' }, { provinceName: 'Thành phố Hồ Chí Minh' }), 'intra'));
check('mismatched ids do not beat matching names', () => assert.equal(
  resolveShippingTier({ provinceId: 240, provinceName: 'Tây Ninh' }, { provinceId: 80, provinceName: 'Tỉnh Tây Ninh' }), 'intra'));
check('same region', () => assert.equal(
  resolveShippingTier({ provinceName: 'Hồ Chí Minh' }, { provinceName: 'Cần Thơ' }), 'inter'));
check('across regions', () => assert.equal(
  resolveShippingTier({ provinceName: 'Hồ Chí Minh' }, { provinceName: 'Hà Nội' }), 'region'));

console.log('\n— shop table resolution —');
const set: ShopFeeTable = { ghn: { intra: 18_000, region: 27_000 } };
const quoted: ShopFeeTable = {
  ghn: { intra: 18_325, inter: 26_200, region: 26_200 },
  vnp: { intra: 15_385, inter: 18_010, region: 18_010 },
};
check("seller's own number wins", () => assert.equal(
  shopShippingFee({ set, quoted, carrier: 'ghn', tier: 'intra' }), 18_000));
check('an unset cell keeps following the quote', () => assert.equal(
  shopShippingFee({ set, quoted, carrier: 'ghn', tier: 'inter' }), 26_200));
check('a carrier with no table at all falls to the platform figure', () => assert.equal(
  shopShippingFee({ set, quoted, carrier: 'jnt', tier: 'inter' }), PLATFORM_SHIPPING_FEE));

console.log('\n— what a buyer is actually charged —');
const charge = (carrier: string, tier: 'intra' | 'inter' | 'region', value: number) =>
  shopShippingFee({ set, quoted, carrier, tier }) + khaiGiaSurcharge(carrier, value);
check('a cheap card pays postage only', () => assert.equal(charge('ghn', 'inter', 500_000), 26_200));
check('a 5tr card on GHN adds 25,000đ', () => assert.equal(charge('ghn', 'inter', 5_000_000), 51_200));
check('the same card on VNPost adds nothing', () => assert.equal(charge('vnp', 'inter', 5_000_000), 18_010));
check('a 20tr card on GHN is covered, not merely approximated', () => assert.equal(
  charge('ghn', 'inter', 20_000_000), 26_200 + 100_000));

console.log('\n— listing override —');
const shopCell = 18_325;   // postage for one GHN parcel, intra
check('a listing that says nothing follows the shop cell', () => assert.equal(
  listingShippingFee(null, shopCell), shopCell));
check('freeship on the listing stays free', () => assert.equal(
  listingShippingFee(0, shopCell), 0));
check('a listing number beats the shop cell', () => assert.equal(
  listingShippingFee(9_000, shopCell), 9_000));

console.log('\n— one parcel per seller —');
check('dearest listing in the parcel wins', () => assert.equal(
  parcelShippingFee([0, 30_000, null], shopCell), 30_000));
check('all free stays free', () => assert.equal(
  parcelShippingFee([0, 0, 0], shopCell), 0));
check('a missing card cannot make a parcel free', () => assert.equal(
  parcelShippingFee([undefined, undefined], shopCell), shopCell));
check('one unpriced listing pulls the parcel up to the shop cell', () => assert.equal(
  parcelShippingFee([0, null], shopCell), shopCell));

console.log('\n— what the grid shows before an address exists —');
const shopQuoted = {
  ghn: { intra: 18_325, inter: 26_200, region: 26_200 },
  vnp: { intra: 15_385, inter: 18_010, region: 18_010 },
};
check('a cheap card spans the cheapest and dearest cell', () => {
  const range = shopShippingRange({ quoted: shopQuoted, carriers: ['ghn', 'vnp'], declaredValue: 500_000 });
  assert.deepEqual(range, { min: 15_385, max: 26_200 });
});
check('a dear card carries khai giá into the span', () => {
  const range = shopShippingRange({ quoted: shopQuoted, carriers: ['ghn', 'vnp'], declaredValue: 5_000_000 });
  // VNPost charges nothing for value; GHN adds 0.5% of five million.
  assert.deepEqual(range, { min: 15_385, max: 26_200 + 25_000 });
});
check('hand delivery never widens the span down to zero', () => {
  const range = shopShippingRange({ quoted: shopQuoted, carriers: ['ghn', 'vnp', 'self'], declaredValue: 500_000 });
  assert.deepEqual(range, { min: 15_385, max: 26_200 });
});
check('a shop with nothing priced says nothing', () => assert.equal(
  shopShippingRange({ carriers: ['ghn'], declaredValue: 0 }), null));
check('a listing that set its own price has no span', () => assert.deepEqual(
  listingShippingRange({ listingFee: 30_000, quoted: shopQuoted, carriers: ['ghn'] }), { min: 30_000, max: 30_000 }));
check('freeship on the listing shows as zero, not as a span', () => assert.deepEqual(
  listingShippingRange({ listingFee: 0, quoted: shopQuoted, carriers: ['ghn'] }), { min: 0, max: 0 }));

console.log('\n— one parcel, several cards, still a span —');
check('a flat listing outranks the cheap end and not the dear one', () => {
  const range = parcelShippingRange({
    cards: [{ listingFee: 20_000, price: 100_000 }, { listingFee: null, price: 100_000 }],
    quoted: shopQuoted,
    carriers: ['ghn', 'vnp'],
  });
  // 20,000đ beats VNPost's 15,385đ but loses to GHN's 26,200đ.
  assert.deepEqual(range, { min: 20_000, max: 26_200 });
});
check('every card priced itself, so there is nothing to vary', () => assert.deepEqual(
  parcelShippingRange({ cards: [{ listingFee: 0 }, { listingFee: 30_000 }], quoted: shopQuoted, carriers: ['ghn'] }),
  { min: 30_000, max: 30_000 }));

console.log('\n— payout, the way seller_payout_for does it —');
const payout = (amount: number, collected: number, bill: number | null) =>
  Math.max(0, amount - Math.min(amount, Math.max(0, (bill ?? 0) - collected)));
check('freeship hands the whole carrier bill to the seller', () => assert.equal(
  payout(800_000, 0, 35_125), 764_875));
check('freeship on a cheap card bottoms out at zero, platform eats the rest', () => assert.equal(
  payout(30_000, 0, 36_070), 0));
check('a collected fee that covers the bill costs the seller nothing', () => assert.equal(
  payout(800_000, 25_000, 15_700), 800_000));
check('an unbooked order pays in full', () => assert.equal(
  payout(800_000, 0, null), 800_000));

console.log(`\n${passed} checks passed\n`);
