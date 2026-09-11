/**
 * Replay the sweep that produced src/lib/khai-gia.ts and print what disagrees.
 *
 * The khai giá model is measured, not documented, so it can go stale without
 * anything failing: a carrier that quietly changes its rate would simply leave
 * sellers short by a few thousand đồng an order. This is how you find out.
 *
 *   npm run verify:khaigia
 *
 * Read-only — it quotes rates, it never books. Two routes are swept because a
 * surcharge that turned out to depend on distance would break the one-model-per-
 * carrier assumption the whole design rests on.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// .env holds tokens containing characters a shell would try to interpret, so it
// is parsed here rather than sourced.
const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, '..', '.env'), 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq <= 0 || line.trimStart().startsWith('#')) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
}

const { goshipRates } = await import('../src/lib/goship.ts');
const { khaiGiaSurcharge } = await import('../src/lib/khai-gia.ts');

const PARCEL = { weight: 200, width: 15, height: 3, length: 20 };

const ROUTES = [
    { name: 'HCM → Hà Nội', from: { city: '700000', district: '700100' }, to: { city: '100000', district: '100300' } },
    { name: 'nội thành HCM', from: { city: '700000', district: '700100' }, to: { city: '700000', district: '700400' } },
];

/**
 * The values that found every edge the model encodes.
 *
 * The top half is not padding. The first version of this sweep stopped at
 * 10,000,000đ and therefore did not notice that BEST doubles its rate one đồng
 * later — a 100,000đ error on a 20,000,000đ card, in the seller's pocket. Any
 * carrier added here needs the whole range, not the cheap end of it.
 */
const VALUES = [
    0, 500_000, 950_000, 1_000_000, 2_000_000, 2_900_000, 3_000_000, 5_000_000,
    10_000_000, 10_000_001, 15_000_000, 20_000_000, 50_000_000, 100_000_000,
];

const quote = async (route: typeof ROUTES[number], declaredValue: number) => {
    const result = await goshipRates({ from: route.from, to: route.to, parcel: PARCEL, declaredValue });
    if (!result.ok) throw new Error(`${route.name} @ ${declaredValue}: ${result.reason}`);
    return new Map(result.rates.map((rate) => [rate.carrierCode, rate.totalFee]));
};

/**
 * How far off is still a rounding artefact rather than a changed price.
 *
 * J&T comes back one đồng above the model at some values and exactly on it at
 * others — 90 checks across two routes on 2026-09-10 found four such, all J&T,
 * all 1đ. That is J&T rounding its own arithmetic, not a rate this file has
 * wrong, and a đồng is absorbed by the surplus the platform already keeps. A
 * real rate change moves thousands, so it clears this easily.
 */
const ROUNDING_TOLERANCE = 100;

let mismatches = 0;
let material = 0;
let checks = 0;

for (const route of ROUTES) {
    console.log(`\n${route.name}`);
    const base = await quote(route, 0);

    for (const value of VALUES) {
        const actual = await quote(route, value);
        for (const [carrier, fee] of actual) {
            const postage = base.get(carrier);
            if (postage === undefined) continue;   // a carrier that only appears at some values
            const expected = postage + khaiGiaSurcharge(carrier, value);
            checks++;
            if (expected !== fee) {
                mismatches++;
                if (Math.abs(fee - expected) > ROUNDING_TOLERANCE) material++;
                console.log(
                    `  MISMATCH ${carrier.padEnd(7)} @ ${value.toLocaleString('vi-VN').padStart(10)}đ`
                    + `  model ${expected.toLocaleString('vi-VN').padStart(8)}đ`
                    + `  goship ${fee.toLocaleString('vi-VN').padStart(8)}đ`
                    + `  (off by ${(fee - expected).toLocaleString('vi-VN')}đ)`,
                );
            }
        }
    }
    console.log('  swept');
}

console.log(
    `\n${checks} checks, ${mismatches} mismatch${mismatches === 1 ? '' : 'es'}`
    + ` (${material} beyond ${ROUNDING_TOLERANCE}đ rounding)`,
);
process.exit(material === 0 ? 0 : 1);
