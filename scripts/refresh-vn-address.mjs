#!/usr/bin/env node
/**
 * Refresh the vendored Vietnamese administrative dataset.
 *
 *   npm run data:address
 *
 * Why the data lives in the repo instead of behind a call at request time:
 * the address dropdowns used to read GHN, and when GHN's token stopped
 * matching its gateway the whole checkout address step went down with it.
 * Provincial boundaries change roughly once a generation, so paying for a
 * network round trip — and a third party's uptime — on every page that asks
 * for a province was buying nothing.
 *
 * Source: provinces.open-api.vn, **v2**. v1 still serves the pre-2025 list of
 * 63 provinces with districts under them. v2 is the structure that exists now:
 * 34 provinces and 3,321 wards, with the district tier gone (Nghị quyết
 * 202/2025/QH15 from 12/6/2025, districts abolished 1/7/2025).
 *
 * The script refuses to write anything that does not match those official
 * counts, so a half-served response can never quietly replace good data.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://provinces.open-api.vn/api/v2';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');

/** What the reorganisation produced. A mismatch means the source is wrong, not us. */
const EXPECTED_PROVINCES = 34;
const EXPECTED_WARDS = 3321;

async function getJson(path) {
  const res = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

const provinces = await getJson('/');
const wards = await getJson('/w/');

if (!Array.isArray(provinces) || provinces.length !== EXPECTED_PROVINCES) {
  throw new Error(`Expected ${EXPECTED_PROVINCES} provinces, got ${provinces?.length}`);
}
if (!Array.isArray(wards) || wards.length !== EXPECTED_WARDS) {
  throw new Error(`Expected ${EXPECTED_WARDS} wards, got ${wards?.length}`);
}

// Only the fields the app renders or stores. `codename` and `phone_code` are
// dropped: nothing reads them, and they are a third of the payload.
const slimProvinces = provinces
  .map((p) => ({ code: p.code, name: p.name, division_type: p.division_type }))
  .sort((a, b) => a.name.localeCompare(b.name, 'vi'));

// Grouped by province so the route is a lookup rather than a scan of 3,321 rows,
// and so a client only ever downloads the one province it asked about.
const wardsByProvince = {};
for (const w of wards) {
  (wardsByProvince[w.province_code] ||= []).push({
    code: w.code,
    name: w.name,
    division_type: w.division_type,
  });
}
for (const list of Object.values(wardsByProvince)) {
  list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

const orphans = Object.keys(wardsByProvince)
  .filter((code) => !slimProvinces.some((p) => String(p.code) === code));
if (orphans.length) throw new Error(`Wards under unknown provinces: ${orphans.join(', ')}`);

const missing = slimProvinces.filter((p) => !wardsByProvince[p.code]);
if (missing.length) throw new Error(`Provinces with no wards: ${missing.map((p) => p.name).join(', ')}`);

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'vn-provinces.json'), `${JSON.stringify(slimProvinces, null, 0)}\n`, 'utf8');
await writeFile(join(OUT, 'vn-wards.json'), `${JSON.stringify(wardsByProvince, null, 0)}\n`, 'utf8');

console.log(`provinces: ${slimProvinces.length}`);
console.log(`wards:     ${wards.length} across ${Object.keys(wardsByProvince).length} provinces`);
console.log(`written to src/data/`);
