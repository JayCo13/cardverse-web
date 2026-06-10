import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

const WITHDRAW_FEE_RATE = 0.05; // 5% platform fee, deducted from the amount.
const MIN_WITHDRAW = 50000;     // 50,000đ minimum per withdrawal.

// POST: seller requests a withdrawal. The wallet is debited immediately and a
// pending wallet_withdrawals row is created for an admin to pay out manually.
// The destination bank account is taken from the seller's KYC record, never the
// client — a withdrawal can only go to the KYC-registered account.
export async function POST(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Must be an approved seller (KYC) to withdraw.
        const { data: verification } = await supabase
            .from('seller_verifications')
            .select('status, bank_name, bank_account_number, bank_account_name')
            .eq('user_id', user.id)
            .single();

        const kyc = verification as {
            status: string;
            bank_name: string;
            bank_account_number: string;
            bank_account_name: string;
        } | null;

        if (!kyc || kyc.status !== 'approved') {
            return NextResponse.json(
                { error: 'Chỉ người bán đã được duyệt KYC mới có thể rút tiền.', code: 'not_a_seller' },
                { status: 403 },
            );
        }

        if (!kyc.bank_name || !kyc.bank_account_number || !kyc.bank_account_name) {
            return NextResponse.json(
                { error: 'Thiếu thông tin tài khoản ngân hàng KYC. Vui lòng cập nhật hồ sơ KYC.', code: 'missing_bank' },
                { status: 400 },
            );
        }

        const amount = Math.floor(Number((await request.json()).amount));
        if (!Number.isFinite(amount) || amount < MIN_WITHDRAW) {
            return NextResponse.json(
                { error: `Số tiền rút tối thiểu là ${MIN_WITHDRAW.toLocaleString('vi-VN')}đ.`, code: 'amount_too_low' },
                { status: 400 },
            );
        }

        // Use the service-role client for all money mutations so the debit and
        // the request row are server-trusted (not bypassable via PostgREST).
        const service = createServiceSupabaseClient();

        const { data: wallet, error: walletError } = await service
            .from('wallets')
            .select('id, available_balance, total_withdrawn')
            .eq('user_id', user.id)
            .single();

        const walletRow = wallet as { id: string; available_balance: number; total_withdrawn: number } | null;

        if (walletError || !walletRow) {
            return NextResponse.json({ error: 'Không tìm thấy ví.' }, { status: 400 });
        }

        if (walletRow.available_balance < amount) {
            return NextResponse.json(
                { error: 'Số dư khả dụng không đủ để rút.', code: 'insufficient_balance', available: walletRow.available_balance },
                { status: 400 },
            );
        }

        const fee = Math.round(amount * WITHDRAW_FEE_RATE);
        const amountNet = amount - fee;
        const newBalance = walletRow.available_balance - amount;

        // Debit the wallet (guard on the balance we just read to avoid a race).
        const { data: debited, error: debitError } = await service
            .from('wallets')
            .update({
                available_balance: newBalance,
                total_withdrawn: (walletRow.total_withdrawn || 0) + amount,
                updated_at: new Date().toISOString(),
            } as never)
            .eq('user_id', user.id)
            .eq('available_balance', walletRow.available_balance)
            .select('id')
            .maybeSingle();

        if (debitError || !debited) {
            return NextResponse.json(
                { error: 'Số dư vừa thay đổi, vui lòng thử lại.', code: 'balance_changed' },
                { status: 409 },
            );
        }

        // Record the ledger entries: net withdrawal + the platform fee.
        await service.from('wallet_transactions').insert([
            {
                wallet_id: walletRow.id,
                user_id: user.id,
                type: 'withdrawal',
                amount: -amountNet,
                balance_after: newBalance,
                description: `Rút tiền về ${kyc.bank_name} ****${kyc.bank_account_number.slice(-4)}`,
            },
            {
                wallet_id: walletRow.id,
                user_id: user.id,
                type: 'platform_fee',
                amount: -fee,
                balance_after: newBalance,
                description: 'Phí rút tiền 5%',
            },
        ] as never);

        // Create the withdrawal request with the KYC bank snapshot.
        const { data: withdrawal, error: withdrawalError } = await service
            .from('wallet_withdrawals')
            .insert({
                user_id: user.id,
                amount_requested: amount,
                fee,
                amount_net: amountNet,
                bank_name: kyc.bank_name,
                bank_account_number: kyc.bank_account_number,
                bank_account_name: kyc.bank_account_name,
                status: 'pending',
            } as never)
            .select('id')
            .single();

        if (withdrawalError || !withdrawal) {
            // Roll the wallet back if we couldn't record the request.
            await service
                .from('wallets')
                .update({
                    available_balance: walletRow.available_balance,
                    total_withdrawn: walletRow.total_withdrawn || 0,
                    updated_at: new Date().toISOString(),
                } as never)
                .eq('user_id', user.id);
            throw (withdrawalError || new Error('Could not create withdrawal request'));
        }

        return NextResponse.json({
            success: true,
            withdrawal_id: (withdrawal as { id: string }).id,
            amount_requested: amount,
            fee,
            amount_net: amountNet,
        });
    } catch (error: any) {
        console.error('Wallet withdraw error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
