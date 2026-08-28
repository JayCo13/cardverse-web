/**
 * Reset seller verification state for one or more accounts, so the same CCCD
 * can be used to test the auto-approval flow again.
 *
 * The hard block is doing its job: one document, one seller account. Testing
 * repeatedly with a single real CCCD therefore needs the previous binding
 * cleared first.
 *
 *   node scripts/reset-seller-kyc.mjs a@x.com b@x.com          # list only
 *   node scripts/reset-seller-kyc.mjs a@x.com b@x.com --apply  # actually delete
 *
 * Lists first, deletes only with --apply. Reads SUPABASE_SERVICE_ROLE_KEY from
 * .env — it bypasses RLS, so do not run it against anything you are not sure of.
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
    console.error('Usage: node scripts/reset-seller-kyc.mjs <email> [more emails] [--apply]');
    process.exit(1);
}

const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

const mask = (v) => (typeof v === 'string' && v.length > 4 ? `••••${v.slice(-4)}` : v ?? '—');
const short = (v) => (typeof v === 'string' ? `${v.slice(0, 10)}…` : '—');

// auth.users is not queryable through PostgREST; page through the admin API.
const wanted = new Set(emails.map((e) => e.toLowerCase()));
const found = new Map();
for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) {
        if (u.email && wanted.has(u.email.toLowerCase())) found.set(u.id, u.email);
    }
    if (data.users.length < 1000) break;
}

for (const e of wanted) {
    if (![...found.values()].some((v) => v.toLowerCase() === e)) {
        console.log(`!  no account found for ${e}`);
    }
}
const userIds = [...found.keys()];
if (userIds.length === 0) process.exit(0);

console.log(`\nAccounts (${userIds.length}):`);
for (const [id, email] of found) console.log(`   ${email}  ${id}`);

const { data: verifications } = await db
    .from('seller_verifications')
    .select('*')
    .in('user_id', userIds);

console.log(`\nseller_verifications (${verifications?.length || 0}):`);
for (const v of verifications || []) {
    console.log(`   ${found.get(v.user_id)}  status=${v.status}  auto=${v.auto_approved}`
        + `  doc=${short(v.document_number_hash)}  bank=${mask(v.bank_account_number)}`);
}

// The rows that would actually block a re-test: same document or bank account
// held by an account that is NOT in the reset list.
const hashes = [...new Set((verifications || []).map((v) => v.document_number_hash).filter(Boolean))];
const banks = [...new Set((verifications || []).map((v) => v.bank_account_number).filter(Boolean))];
let foreign = [];
if (hashes.length || banks.length) {
    const filters = [];
    if (hashes.length) filters.push(`document_number_hash.in.(${hashes.join(',')})`);
    if (banks.length) filters.push(`bank_account_number.in.(${banks.join(',')})`);
    const { data } = await db
        .from('seller_verifications')
        .select('user_id, status, document_number_hash, bank_account_number')
        .or(filters.join(','))
        .in('status', ['approved', 'pending']);
    foreign = (data || []).filter((r) => !found.has(r.user_id));
}
if (foreign.length) {
    console.log(`\n!! Same document/bank held by OTHER accounts (${foreign.length}) — these will keep blocking:`);
    for (const r of foreign) {
        console.log(`   user_id=${r.user_id}  status=${r.status}`
            + `  doc=${short(r.document_number_hash)}  bank=${mask(r.bank_account_number)}`);
    }
    console.log('   Add their email to this command, or reject them in the admin panel.');
}

const { data: sessions } = await db
    .from('kyc_sessions').select('*').in('user_id', userIds);
console.log(`\nkyc_sessions (${sessions?.length || 0}):`);
for (const s of sessions || []) {
    console.log(`   ${found.get(s.user_id)}  ${s.status}  consumed=${s.consumed_at ? 'yes' : 'no'}`);
}

const { data: blocks } = await db
    .from('seller_verification_blocks').select('*').in('user_id', userIds);
console.log(`\nseller_verification_blocks (${blocks?.length || 0}):`);
for (const b of blocks || []) console.log(`   ${found.get(b.user_id)}  ${b.matched_axis}  ${b.created_at}`);

if (!apply) {
    console.log('\nDry run. Nothing was changed. Re-run with --apply to delete the rows above.');
    process.exit(0);
}

// Deleting production rows is irreversible, and these accounts sit next to real
// wallet balances and in-flight orders. Dump what we are about to remove first.
// Gitignored: these dumps contain bank account numbers and phone numbers.
mkdirSync(new URL('../.kyc-backups/', import.meta.url), { recursive: true });
const backupPath = new URL(`../.kyc-backups/reset-${Date.now()}.json`, import.meta.url);
writeFileSync(backupPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    accounts: Object.fromEntries(found),
    seller_verifications: verifications || [],
    kyc_sessions: sessions || [],
    seller_verification_blocks: blocks || [],
}, null, 2));
console.log(`\nBackup written: ${backupPath.pathname}`);

console.log('\nApplying…');
for (const [table, label] of [
    ['seller_verification_blocks', 'blocks'],
    ['seller_verifications', 'verifications'],
    ['kyc_sessions', 'sessions'],
]) {
    const { error } = await db.from(table).delete().in('user_id', userIds);
    // The blocks table only exists once 20260828000200 has been applied; running
    // this before the migration is a normal thing to do, not a failure.
    if (error?.code === 'PGRST205' || /Could not find the table/.test(error?.message || '')) {
        console.log(`   skipped ${label} (table not created yet)`);
        continue;
    }
    if (error) { console.error(`   FAILED ${label}:`, error.message); process.exit(1); }
    console.log(`   deleted ${label}`);
}
const { error: pErr } = await db
    .from('profiles').update({ seller_verified: false }).in('id', userIds);
if (pErr) { console.error('   FAILED profiles:', pErr.message); process.exit(1); }
console.log('   cleared profiles.seller_verified');
console.log('\nDone. These accounts can run the seller flow from scratch.');
