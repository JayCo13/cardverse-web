/**
 * Remove every withdrawal request of a test account.
 *
 * Pending requests hold money in `wallets.held_balance` and reserve
 * `wallet_fund_allocations`, so the rows are first rejected through the
 * official `perform_withdrawal_action` RPC (which releases the hold and keeps
 * `assert_wallet_fund_integrity` happy) and only then hard-deleted together
 * with the audit / action children that have `on delete restrict` FKs.
 *
 *   node scripts/purge-test-withdrawals.mjs quachnha33@gmail.com          # list only
 *   node scripts/purge-test-withdrawals.mjs quachnha33@gmail.com --apply  # actually delete
 *
 * Reads SUPABASE_SERVICE_ROLE_KEY from .env — it bypasses RLS, so do not run it
 * against an account you are not sure is a test account.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const apply = process.argv.includes('--apply');
const email = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!email) {
    console.error('Usage: node scripts/purge-test-withdrawals.mjs <email> [--apply]');
    process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

const { data: profile } = await db.from('profiles').select('id,email,display_name').eq('email', email).maybeSingle();
if (!profile) {
    console.error(`No profile for ${email}`);
    process.exit(1);
}
const { data: rows, error } = await db
    .from('wallet_withdrawals')
    .select('id,status,amount_requested,created_at')
    .eq('user_id', profile.id)
    .order('created_at');
if (error) throw error;
console.log(`${profile.display_name} <${profile.email}> — ${rows.length} withdrawal(s)`);
console.table(rows);
const { data: before } = await db.from('wallets').select('available_balance,held_balance').eq('user_id', profile.id).maybeSingle();
console.log('wallet before', before);

if (!apply) {
    console.log('\nDry run. Re-run with --apply to reject + delete.');
    process.exit(0);
}

// 1. Release the holds through the official action so wallet + allocations stay consistent.
for (const r of rows.filter((r) => r.status === 'pending' || r.status === 'processing')) {
    const { data, error } = await db.rpc('perform_withdrawal_action', {
        p_withdrawal_id: r.id,
        p_action: 'reject',
        p_idempotency_key: randomUUID(),
        p_actor_id: 'purge-test-withdrawals',
        p_actor_role: 'moderator',
        p_payload: { reason: `Dọn dữ liệu tài khoản test ${email}` },
    });
    console.log('reject', r.id, error ? `ERR ${error.message}` : data?.ok ? 'ok' : JSON.stringify(data));
}

// 2. Children with on-delete-restrict FKs, then the withdrawals themselves.
const ids = rows.map((r) => r.id);
for (const table of ['withdrawal_action_requests', 'withdrawal_audit_events', 'withdrawal_transfer_attempts', 'account_review_holds']) {
    const { data, error } = await db.from(table).delete().in('withdrawal_id', ids).select('id');
    console.log('delete', table, error ? `ERR ${error.message}` : data?.length ?? 0);
}
const { data: deleted, error: deleteError } = await db.from('wallet_withdrawals').delete().in('id', ids).select('id');
console.log('delete wallet_withdrawals', deleteError ? `ERR ${deleteError.message}` : deleted.length);

const { data: after } = await db.from('wallets').select('available_balance,held_balance').eq('user_id', profile.id).maybeSingle();
console.log('wallet after', after);
