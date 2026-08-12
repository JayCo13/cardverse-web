import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

// GET: Get wallet balance
export async function GET() {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Self-healing escrow release: a seller checking their balance pays out
        // any of their delivered orders whose 72h confirmation window lapsed.
        await supabase.rpc('complete_delivered_orders' as never);

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

        // Withdrawal requests are returned alongside the ledger so the wallet
        // can show pending/rejected lifecycle entries without pretending money
        // has already left the account.
        const [{ data: transactions }, { data: withdrawals }, { data: fundStatement, error: statementError }] = await Promise.all([
            supabase
                .from('wallet_transactions')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(40),
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
                .limit(20),
            supabase.rpc('get_my_wallet_fund_statement' as never),
        ]);
        if (statementError) throw statementError;

        return NextResponse.json({
            wallet,
            transactions: transactions || [],
            withdrawals: withdrawals || [],
            fund_statement: fundStatement,
        });
    } catch (error: any) {
        console.error('Get wallet error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
