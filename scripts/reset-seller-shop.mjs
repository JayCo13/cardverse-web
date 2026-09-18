/**
 * Reset a seller's shop setup so the onboarding can be recorded from scratch:
 * the pickup address ("Địa chỉ gửi hàng") and the shop shipping setup
 * ("Vận chuyển của shop": carriers, coverage probe, parcel overrides).
 *
 * Run scripts/reset-seller-kyc.mjs first (or alongside) to clear identity/KYC.
 *
 *   node scripts/reset-seller-shop.mjs a@x.com b@x.com          # list only
 *   node scripts/reset-seller-shop.mjs a@x.com b@x.com --apply  # actually clear
 *
 * Reads SUPABASE_SERVICE_ROLE_KEY from .env — bypasses RLS, so only run it
 * against accounts you are sure are test accounts.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const apply = process.argv.includes('--apply');
const emails = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (emails.length === 0) {
    console.error('Usage: node scripts/reset-seller-shop.mjs <email> [more emails] [--apply]');
    process.exit(1);
}

const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
);

// Everything the pickup-address route and the shop-shipping route write.
const SHOP_COLUMNS = [
    'goship_pickup',
    'address_province_id', 'address_province_name',
    'address_district_id', 'address_district_name',
    'address_ward_code', 'address_detail',
    'shipping_carriers', 'carrier_coverage', 'parcel_overrides',
];

const { data: profiles, error } = await db
    .from('profiles')
    .select(['id', 'email', 'display_name', ...SHOP_COLUMNS].join(','))
    .in('email', emails);
if (error) throw error;
for (const e of emails) {
    if (!profiles.some((p) => p.email?.toLowerCase() === e.toLowerCase())) console.log(`!  no profile for ${e}`);
}
if (!profiles.length) process.exit(0);

for (const p of profiles) {
    console.log(`\n${p.display_name} <${p.email}>  ${p.id}`);
    console.log(`   pickup:   ${p.goship_pickup ? `${p.goship_pickup.street ?? ''} (${p.address_province_name ?? '?'})` : '—'}`);
    console.log(`   carriers: ${Array.isArray(p.shipping_carriers) && p.shipping_carriers.length ? p.shipping_carriers.join(', ') : '—'}`);
    console.log(`   coverage: ${p.carrier_coverage ? 'probed' : '—'}   parcel overrides: ${p.parcel_overrides && Object.keys(p.parcel_overrides).length ? 'yes' : '—'}`);
}

if (!apply) {
    console.log('\nDry run. Nothing was changed. Re-run with --apply to clear the fields above.');
    process.exit(0);
}

mkdirSync(new URL('../.kyc-backups/', import.meta.url), { recursive: true });
const backupPath = new URL(`../.kyc-backups/shop-reset-${Date.now()}.json`, import.meta.url);
writeFileSync(backupPath, JSON.stringify({ generatedAt: new Date().toISOString(), profiles }, null, 2));
console.log(`\nBackup written: ${backupPath.pathname}`);

const cleared = Object.fromEntries(SHOP_COLUMNS.map((c) => [c, null]));
cleared.shipping_carriers = [];
cleared.parcel_overrides = {}; // not null default '{}'
const { error: uErr } = await db.from('profiles').update(cleared).in('id', profiles.map((p) => p.id));
if (uErr) { console.error('FAILED:', uErr.message); process.exit(1); }
console.log(`Cleared pickup address + shop shipping on ${profiles.length} profile(s).`);
