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
  DEFAULT_SHOP_TIER_FEES,
  PLATFORM_SHIPPING_FEE,
  SHOP_TIER_FEE_MAX,
  SHOP_TIER_FEE_MIN,
  isValidShopTierFee,
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
// One cell moved off the default, one cell left alone, and — the case that
// matters for money — one cell stored below the floor by an older save.
const set: ShopFeeTable = { ghn: { intra: 30_000, region: 11_000 } };
check("seller's own number wins", () => assert.equal(
  shopShippingFee({ set, carrier: 'ghn', tier: 'intra' }), 30_000));
check('an unset cell is the default for its distance', () => assert.equal(
  shopShippingFee({ set, carrier: 'ghn', tier: 'inter' }), DEFAULT_SHOP_TIER_FEES.inter));
check('a cell stored below the floor is not charged', () => assert.equal(
  shopShippingFee({ set, carrier: 'ghn', tier: 'region' }), DEFAULT_SHOP_TIER_FEES.region));
check('a carrier with no table at all is the default too', () => assert.equal(
  shopShippingFee({ set, carrier: 'jnt', tier: 'inter' }), DEFAULT_SHOP_TIER_FEES.inter));
check('the band is 20k to 50k', () => {
  assert.equal(isValidShopTierFee(SHOP_TIER_FEE_MIN - 1), false);
  assert.equal(isValidShopTierFee(SHOP_TIER_FEE_MIN), true);
  assert.equal(isValidShopTierFee(SHOP_TIER_FEE_MAX), true);
  assert.equal(isValidShopTierFee(SHOP_TIER_FEE_MAX + 1), false);
  assert.equal(isValidShopTierFee(0), false);
});
check('every default sits inside the band', () => {
  Object.values(DEFAULT_SHOP_TIER_FEES).forEach((fee) => assert.equal(isValidShopTierFee(fee), true));
});

console.log('\n— what a buyer is actually charged —');
const charge = (carrier: string, tier: 'intra' | 'inter' | 'region', value: number) =>
  shopShippingFee({ set, carrier, tier }) + khaiGiaSurcharge(carrier, value);
check('a cheap card pays postage only', () => assert.equal(charge('ghn', 'inter', 500_000), 22_000));
check('a 5tr card on GHN adds 25,000đ', () => assert.equal(charge('ghn', 'inter', 5_000_000), 47_000));
check('SPX steps once and stays there', () => assert.equal(charge('shopee', 'inter', 5_000_000), 22_000 + 25_000));
check('a 20tr card on GHN is covered, not merely approximated', () => assert.equal(
  charge('ghn', 'inter', 20_000_000), 22_000 + 100_000));

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

console.log('\n— what the grid shows before a delivery address exists —');
// One shop that moved two cells, with a third stored below the floor and a
// retired carrier still ticked. Neither of the last two may reach a buyer.
const shopSet: ShopFeeTable = {
  ghn: { region: 40_000 },
  shopee: { intra: 11_000 },
  vnp: { intra: 15_385, inter: 18_010, region: 18_010 },
};
const D = DEFAULT_SHOP_TIER_FEES;

check('a shop that set nothing spans the defaults', () => {
  const range = shopShippingRange({ carriers: ['ghn', 'shopee'], declaredValue: 500_000 });
  assert.deepEqual(range, { min: D.intra, max: D.region });
});
check('a raised cell becomes the dear end', () => {
  const range = shopShippingRange({ set: shopSet, carriers: ['ghn', 'shopee'], declaredValue: 500_000 });
  assert.deepEqual(range, { min: D.intra, max: 40_000 });
});
check('a cell below the floor never reaches the grid', () => {
  const range = shopShippingRange({ set: shopSet, carriers: ['shopee'], declaredValue: 500_000 });
  // The stored 11,000đ is ignored; the cheap end is the intra default.
  assert.deepEqual(range, { min: D.intra, max: D.region });
});
check('a retired carrier is never quoted, however the shop saved it', () => {
  const withRetired = shopShippingRange({ set: shopSet, carriers: ['ghn', 'shopee', 'vnp'], declaredValue: 500_000 });
  const without = shopShippingRange({ set: shopSet, carriers: ['ghn', 'shopee'], declaredValue: 500_000 });
  // VNPost's 15,385đ is the cheapest cell stored and must not appear.
  assert.deepEqual(withRetired, without);
});
check('a dear card carries khai giá into the span', () => {
  const range = shopShippingRange({ carriers: ['ghn'], declaredValue: 5_000_000 });
  // GHN adds 0.5% of five million to every cell, so the whole span moves.
  assert.deepEqual(range, { min: D.intra + 25_000, max: D.region + 25_000 });
});
check('a retired hand-delivery tick never widens the span down to zero', () => {
  const range = shopShippingRange({ carriers: ['ghn', 'self'], declaredValue: 500_000 });
  assert.deepEqual(range, { min: D.intra, max: D.region });
});
check('a shop left with nothing offerable falls back to every courier', () => {
  // Everything this shop ticked has since been retired, which is no preference
  // rather than no shipping — the same reading the checkout resolver takes.
  const range = shopShippingRange({ carriers: ['self', 'vnp'], declaredValue: 0 });
  assert.deepEqual(range, shopShippingRange({ carriers: [], declaredValue: 0 }));
});
check('a listing that set its own price has no span', () => assert.deepEqual(
  listingShippingRange({ listingFee: 30_000, carriers: ['ghn'] }), { min: 30_000, max: 30_000 }));
check('freeship on the listing shows as zero, not as a span', () => assert.deepEqual(
  listingShippingRange({ listingFee: 0, carriers: ['ghn'] }), { min: 0, max: 0 }));

console.log('\n— one parcel, several cards, still a span —');
check('a flat listing outranks the cheap end and not the dear one', () => {
  const range = parcelShippingRange({
    cards: [{ listingFee: 21_000, price: 100_000 }, { listingFee: null, price: 100_000 }],
    carriers: ['ghn'],
  });
  // 21,000đ beats the intra default and loses to the region one.
  assert.deepEqual(range, { min: 21_000, max: D.region });
});
check('every card priced itself, so there is nothing to vary', () => assert.deepEqual(
  parcelShippingRange({ cards: [{ listingFee: 0 }, { listingFee: 30_000 }], carriers: ['ghn'] }),
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
