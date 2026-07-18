import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { getAdminNotificationEmails } from '@/lib/admin-recipients';
import { sendWithdrawalSubmittedToAdmin } from '@/lib/mail';

const MIN_WITHDRAW = 50000;

type WithdrawalResult = {
    ok?: boolean;
    error?: string;
    available?: number;
    withdrawal_id?: string;
    status?: string;
    amount_requested?: number;
    fee?: number;
    amount_net?: number;
    available_balance?: number;
    held_balance?: number;
};

const ERROR_MESSAGES: Record<string, string> = {
    amount_too_low: `Số tiền rút tối thiểu là ${MIN_WITHDRAW.toLocaleString('vi-VN')}đ.`,
    not_a_seller: 'Chỉ người bán đã được duyệt KYC mới có thể rút tiền.',
    missing_bank: 'Thiếu thông tin tài khoản ngân hàng KYC. Vui lòng cập nhật hồ sơ KYC.',
    insufficient_balance: 'Số dư khả dụng không đủ để rút.',
    wallet_not_found: 'Không tìm thấy ví.',
};

// Reserve a seller's funds while an admin reviews the payout. The atomic RPC
// moves available -> held and snapshots the approved KYC bank account; no
// negative wallet transaction is recorded until the admin confirms transfer.
export async function POST(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const amount = Math.floor(Number((await request.json()).amount));
        if (!Number.isFinite(amount) || amount < MIN_WITHDRAW) {
            return NextResponse.json(
                { error: ERROR_MESSAGES.amount_too_low, code: 'amount_too_low' },
                { status: 400 },
            );
        }

        const service = createServiceSupabaseClient();
        const { data, error } = await service.rpc('request_wallet_withdrawal' as never, {
            p_user_id: user.id,
            p_amount: amount,
        } as never);

        if (error) throw error;

        const result = data as WithdrawalResult | null;
        if (!result?.ok) {
            const code = result?.error || 'withdrawal_failed';
            const status = code === 'not_a_seller' ? 403 : code === 'insufficient_balance' ? 409 : 400;
            return NextResponse.json({
                error: ERROR_MESSAGES[code] || 'Không thể tạo yêu cầu rút tiền.',
                code,
                ...(typeof result?.available === 'number' ? { available: result.available } : {}),
            }, { status });
        }

        // The withdrawal table itself drives realtime admin badges. Email is
        // awaited as best-effort so a serverless response cannot terminate the
        // SMTP delivery early.
        if (result.withdrawal_id) {
            const [{ data: profile }, { data: withdrawal }, adminEmails] = await Promise.all([
                service.from('profiles').select('display_name, email').eq('id', user.id).maybeSingle(),
                service
                    .from('wallet_withdrawals')
                    .select('bank_name, bank_account_number')
                    .eq('id', result.withdrawal_id)
                    .single(),
                getAdminNotificationEmails(),
            ]);

            await sendWithdrawalSubmittedToAdmin({
                sellerName: profile?.display_name || profile?.email || user.email || 'Seller CardVerse',
                sellerEmail: profile?.email || user.email || '',
                amountRequested: result.amount_requested || amount,
                fee: result.fee || 0,
                amountNet: result.amount_net || amount,
                bankName: withdrawal?.bank_name || 'Ngân hàng KYC',
                bankAccountNumber: withdrawal?.bank_account_number || '',
                adminEmails,
            });
        }

        return NextResponse.json({
            success: true,
            withdrawal_id: result.withdrawal_id,
            status: result.status,
            amount_requested: result.amount_requested,
            fee: result.fee,
            amount_net: result.amount_net,
            available_balance: result.available_balance,
            held_balance: result.held_balance,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        console.error('Wallet withdraw error:', error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
