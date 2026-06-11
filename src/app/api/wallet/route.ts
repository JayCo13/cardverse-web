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
            const { data: newWallet, error: createError } = await createServiceSupabaseClient()
                .from('wallets')
                .insert({ user_id: user.id } as never)
                .select()
                .single();

            if (createError) throw createError;
            wallet = newWallet;
        } else if (error) {
            throw error;
        }

        // Get recent transactions
        const { data: transactions } = await supabase
            .from('wallet_transactions')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(20);

        return NextResponse.json({ wallet, transactions: transactions || [] });
    } catch (error: any) {
        console.error('Get wallet error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
