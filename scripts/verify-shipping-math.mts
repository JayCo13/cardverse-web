/**
 * What a buyer is charged and what a seller is paid, checked in isolation.
 *
 * These are the pure functions behind every shipping number on the site — the
 * rounding of GoShip's quote, the listing override, which carriers a shop may
 * ship with, the seller's own charge at booking, and the payout arithmetic
 * that seller_payout_for performs in SQL. No network, no database: run it
 * after touching any of them.
 *
 *   npm run verify:shipping
 *
 * The payout case is a deliberate duplicate of the SQL. It is here because the
 * SQL version only runs when a migration is applied, and the rule it encodes —
 * a seller never goes below zero, and only pays for what they chose — is the
 * one most likely to be broken by a change made somewhere else.
 */

import assert from 'node:assert/strict';
import { isValidListingShippingFee, roundUp1000 } from '../src/lib/shipping-fee.ts';
import { khaiGiaSurcharge, compensationFor } from '../src/lib/khai-gia.ts';
import { booksWithCarrier, OFFERABLE_COURIERS } from '../src/lib/shipping-carriers.ts';
import { shipmentCarriers } from '../src/lib/shipment-carriers.ts';
import { heaviestPreset, parcelFor, parcelPresetOr, parseParcelOverrides, PARCEL_PRESETS } from '../src/lib/parcel.ts';

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn(); passed++; console.log('  ok  ' + name);
};

console.log('\n— what the buyer pays: GoShip, rounded up to the thousand —');
check('26,200 becomes 27,000', () => assert.equal(roundUp1000(26_200), 27_000));
check('15,385 becomes 16,000', () => assert.equal(roundUp1000(15_385), 16_000));
check('a round number stays', () => assert.equal(roundUp1000(22_000), 22_000));
check('nothing negative', () => assert.equal(roundUp1000(-5), 0));

console.log('\n— the listing override —');
check('null follows GoShip', () => assert.equal(isValidListingShippingFee(null), false));
check('0 is free shipping, a real answer', () => assert.equal(isValidListingShippingFee(0), true));
check('a flat 30,000đ is valid', () => assert.equal(isValidListingShippingFee(30_000), true));
check('the ceiling is 99,999đ', () => { assert.equal(isValidListingShippingFee(99_999), true); assert.equal(isValidListingShippingFee(100_000), false); });

console.log('\n— which carriers a shop may ship with —');
const offerable = OFFERABLE_COURIERS.map((c) => c.code);
check('GHN, SPX, J&T and BEST are offerable; VNPost and hand delivery are not', () => {
  assert.deepEqual([...offerable].sort(), ['best', 'ghn', 'jnt', 'shopee']);
});
check('no preference means every offerable courier', () => assert.deepEqual(shipmentCarriers([]).sort(), [...offerable].sort()));
check('a retired tick is dropped', () => assert.deepEqual(shipmentCarriers(['ghn', 'vnp']), ['ghn']));
check('only retired ticks means no preference', () => assert.equal(shipmentCarriers(['vnp']).length, offerable.length));
check('coverage trims what collects here', () => {
  assert.deepEqual(shipmentCarriers(['ghn', 'shopee', 'jnt'], { carriers: ['ghn', 'jnt'] }).sort(), ['ghn', 'jnt']);
});
check('coverage with no ticks is the collecting set', () => assert.deepEqual(shipmentCarriers([], { carriers: ['ghn'] }), ['ghn']));
check('hand delivery books nothing', () => assert.equal(booksWithCarrier('self'), false));

console.log('\n— the parcel —');
check('the default kind is card', () => assert.equal(parcelPresetOr(undefined), 'card'));
check('an old preset name falls to card', () => assert.equal(parcelPresetOr('raw'), 'card'));
check('a card does not grow with count beyond 50g each', () => assert.equal(parcelFor('card', 5).weight, PARCEL_PRESETS.card.weight + 200));
check('a box does not grow with count', () => assert.equal(parcelFor('box', 4).weight, PARCEL_PRESETS.box.weight));
check('the seller\'s saved numbers win', () => assert.equal(parcelFor('card', 1, { card: { weight: 90, width: 10, height: 1, length: 15 } }).weight, 90));
check('an invalid saved parcel is dropped, a valid one kept', () => {
  const parsed = parseParcelOverrides({ card: { weight: 0, width: 1, height: 1, length: 1 }, box: { weight: 800, width: 15, height: 10, length: 20 }, nope: {} });
  assert.deepEqual(Object.keys(parsed), ['box']);
});
check('several listings ship as the heaviest kind', () => assert.equal(heaviestPreset(['card', 'box', 'pack']), 'box'));

console.log('\n— khai giá, the seller\'s own choice —');
check('nothing is charged below 1tr', () => {
  for (const c of ['ghn', 'best', 'jnt', 'shopee', 'vnp']) assert.equal(khaiGiaSurcharge(c, 950_000), 0);
});
check('GHN charges 0.5% of the FULL value from 1tr', () => assert.equal(khaiGiaSurcharge('ghn', 1_000_000), 5_000));
check('SPX steps to a flat 25,000đ at exactly 3tr', () => assert.equal(khaiGiaSurcharge('shopee', 3_000_000), 25_000));
check('BEST doubles to 1% one đồng past 10tr', () => assert.equal(khaiGiaSurcharge('best', 10_000_001), 100_001));
check('a 3tr card declared with GHN: 3tr with an invoice, 4× postage otherwise', () => {
  const c = compensationFor('ghn', 3_000_000, 26_200)!;
  assert.equal(c.invoice, 3_000_000); assert.equal(c.transaction, null); assert.equal(c.noProof, 104_800); assert.equal(c.undeclared, 104_800);
});
check('SPX accepts a bank receipt as proof up to 20tr', () => {
  const c = compensationFor('shopee', 25_000_000, 22_000)!;
  assert.equal(c.invoice, 20_000_000); assert.equal(c.transaction, 20_000_000); assert.equal(c.noProof, 2_000_000);
});
check('J&T pays 1tr at most on a bank receipt, 500k on nothing', () => {
  const c = compensationFor('jnt', 3_000_000, 36_070)!;
  assert.equal(c.invoice, 3_000_000); assert.equal(c.transaction, 1_000_000); assert.equal(c.noProof, 500_000);
});
check('BEST pays up to 1tr undeclared, 10tr declared with an invoice', () => {
  const c = compensationFor('best', 12_000_000, 23_850)!;
  assert.equal(c.invoice, 10_000_000); assert.equal(c.transaction, null); assert.equal(c.undeclared, 1_000_000);
});
check('an unknown carrier has no policy', () => assert.equal(compensationFor('vtp', 1, 1), null));

console.log('\n— what comes off the seller at booking —');
// Mirrors /api/shipping/book: the declaration is the gap between the quote at
// the declared value and the same parcel at 0; the upgrade is the gap between
// that and the parcel the buyer paid for; a self-priced listing owes postage
// over the fee it set.
const sellerCharge = (i: { declared: number; base: number; original: number | null; listingOverride: boolean; buyerPaid: number }) => {
  const khaiGia = Math.max(0, i.declared - i.base);
  const upgrade = i.original !== null ? Math.max(0, i.base - i.original) : 0;
  const listing = i.listingOverride ? Math.max(0, i.base - upgrade - i.buyerPaid) : 0;
  return khaiGia + upgrade + listing;
};
check('nothing declared, same parcel: the seller pays nothing', () =>
  assert.equal(sellerCharge({ declared: 26_500, base: 26_500, original: null, listingOverride: false, buyerPaid: 27_000 }), 0));
check('postage drift on the buyer\'s carrier is not the seller\'s', () =>
  assert.equal(sellerCharge({ declared: 27_400, base: 27_400, original: null, listingOverride: false, buyerPaid: 27_000 }), 0));
check('declaring 3tr with GHN costs the seller exactly the surcharge', () =>
  assert.equal(sellerCharge({ declared: 41_200, base: 26_200, original: null, listingOverride: false, buyerPaid: 27_000 }), 15_000));
check('a bigger parcel costs its own difference', () =>
  assert.equal(sellerCharge({ declared: 31_000, base: 31_000, original: 26_200, listingOverride: false, buyerPaid: 27_000 }), 4_800));
check('free shipping: the seller owes GoShip\'s postage', () =>
  assert.equal(sellerCharge({ declared: 26_200, base: 26_200, original: null, listingOverride: true, buyerPaid: 0 }), 26_200));
check('a flat 30,000đ listing above the postage owes nothing', () =>
  assert.equal(sellerCharge({ declared: 26_200, base: 26_200, original: null, listingOverride: true, buyerPaid: 30_000 }), 0));

console.log('\n— seller payout (mirrors seller_payout_for) —');
const payout = (o: { amount: number; charge: number | null; goshipFee: number | null; shippingFee: number }) =>
  Math.max(0, o.amount - Math.min(o.amount,
    o.charge !== null ? o.charge : Math.max(0, (o.goshipFee ?? 0) - o.shippingFee)));
check('900k with nothing declared pays 900k', () => assert.equal(payout({ amount: 900_000, charge: 0, goshipFee: 26_200, shippingFee: 27_000 }), 900_000));
check('900k with a 30k declaration pays 870k', () => assert.equal(payout({ amount: 900_000, charge: 30_000, goshipFee: 56_200, shippingFee: 27_000 }), 870_000));
check('a legacy order nets GoShip over the fee collected', () => assert.equal(payout({ amount: 800_000, charge: null, goshipFee: 35_125, shippingFee: 25_000 }), 789_875));
check('never below zero', () => assert.equal(payout({ amount: 10_000, charge: 40_000, goshipFee: null, shippingFee: 0 }), 0));

console.log(`\n${passed} checks passed.\n`);
