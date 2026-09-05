import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import type { Tables } from '@/lib/supabase/database.types';

// GET: Get wallet balance
export async function GET(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const balanceOnly = request.nextUrl.searchParams.get('view') === 'balance';
        // Keep the legacy maintenance fallback until the scheduled worker is verified.
        if (!balanceOnly && process.env.MARKETPLACE_MAINTENANCE_WORKER_READY !== 'true') {
            await supabase.rpc('complete_delivered_orders' as never);
        }

        // Get or create wallet (reads go through the session client — RLS
        // allows owners to SELECT their own row; writes are service-only).
        let { data: wallet, error } = await supabase
            .from('wallets')
            .select('*')
            .eq('user_id', user.id)
            .single();

        if (error && error.code === 'PGRST116') {
            // No wallet exists (pre-trigger account) — create one. Wallet
            // writes are RLS-locked, so this insert needs the service client.
            const service = createServiceSupabaseClient();
            const { error: createError } = await service.rpc('ensure_wallet_for_user' as never, {
                p_user_id: user.id,
            } as never);

            if (createError) throw createError;
            const { data: newWallet, error: reloadError } = await supabase
                .from('wallets')
                .select('*')
                .eq('user_id', user.id)
                .single();
            if (reloadError) throw reloadError;
            wallet = newWallet;
        } else if (error) {
            throw error;
        }

        if (balanceOnly) {
            return NextResponse.json({ wallet }, { headers: { 'Cache-Control': 'private, no-store' } });
        }

        // Withdrawal requests are returned alongside the ledger so the wallet
        // can show pending/rejected lifecycle entries without pretending money
        // has already left the account.
        const [{ data: transactions }, { data: withdrawals }, { data: fundStatement, error: statementError }] = await Promise.all([
            supabase
                .from('wallet_transactions')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(100),
            supabase
                .from('wallet_withdrawals')
                .select(`
                    id, amount_requested, fee, amount_net, currency, status,
                    funding_state, bank_name, bank_account_masked,
                    rejection_reason, recovery_required, recovery_reason,
                    created_at, processed_at
                `)
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(50),
            supabase.rpc('get_my_wallet_fund_statement' as never),
        ]);
        if (statementError) throw statementError;

        const allTransactions = (transactions || []) as Tables<'wallet_transactions'>[];
        const enrichedWithdrawals = (withdrawals || []).map((w: any) => {
            const match = allTransactions.find((t) =>
                t.reference_id === w.id &&
                ['withdrawal_hold', 'withdrawal', 'withdrawal_net_outflow'].includes(t.type)
            );
            if (match && typeof match.balance_after === 'number') {
                const after = Number(match.balance_after);
                const before = after + Number(w.amount_requested);
                return { ...w, balance_before: before, balance_after: after };
            }

            const wTime = new Date(w.created_at).getTime();
            const prior = allTransactions
                .filter((t) => new Date(t.created_at).getTime() <= wTime && !['withdrawal_hold', 'withdrawal_hold_release'].includes(t.type))
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

            if (prior && typeof prior.balance_after === 'number') {
                const before = Number(prior.balance_after);
                const after = Math.max(0, before - Number(w.amount_requested));
                return { ...w, balance_before: before, balance_after: after };
            }

            const next = allTransactions
                .filter((t) => new Date(t.created_at).getTime() > wTime && !['withdrawal_hold', 'withdrawal_hold_release'].includes(t.type))
                .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];

            if (next && typeof next.balance_after === 'number') {
                const after = Number(next.balance_after) - Number(next.amount);
                const before = after + Number(w.amount_requested);
                return { ...w, balance_before: before, balance_after: after };
            }

            return w;
        });

        return NextResponse.json({
            wallet,
            transactions: allTransactions,
            withdrawals: enrichedWithdrawals,
            fund_statement: fundStatement,
        });
    } catch (error: any) {
        console.error('Get wallet error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
