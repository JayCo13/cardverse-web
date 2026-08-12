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
    replayed?: boolean;
};

const ERROR_MESSAGES: Record<string, string> = {
    amount_too_low: `The minimum withdrawal amount is ${MIN_WITHDRAW.toLocaleString('en-US')} VND.`,
    not_a_seller: 'Only KYC-approved sellers can withdraw funds.',
    missing_bank: 'Verified bank account information is incomplete. Update your KYC profile.',
    insufficient_balance: 'Available wallet balance is insufficient.',
    insufficient_verified_balance: 'Verified balance is insufficient. Unverified funds remain locked.',
    kyc_or_bank_not_verified: 'KYC or the bank account has not been verified.',
    idempotency_key_required: 'A request idempotency key is required.',
    idempotency_conflict: 'The request key was already used with different details.',
    financial_maintenance_active: 'The wallet is unavailable during reconciliation. Please try again later.',
    wallet_not_found: 'Wallet not found.',
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

        const amount = Number((await request.json()).amount);
        if (!Number.isSafeInteger(amount) || amount < MIN_WITHDRAW) {
            return NextResponse.json(
                { error: ERROR_MESSAGES.amount_too_low, code: 'amount_too_low' },
                { status: 400 },
            );
        }

        const idempotencyKey = request.headers.get('idempotency-key');
        if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
            return NextResponse.json(
                { error: ERROR_MESSAGES.idempotency_key_required, code: 'idempotency_key_required' },
                { status: 400 },
            );
        }

        // The authenticated RPC derives the user from auth.uid(); the client
        // cannot select another wallet or submit a trusted balance/status.
        const { data, error } = await supabase.rpc('request_wallet_withdrawal' as never, {
            p_amount: amount,
            p_request_idempotency_key: idempotencyKey,
        } as never);

        if (error) throw error;

        const result = data as WithdrawalResult | null;
        if (!result?.ok) {
            const code = result?.error || 'withdrawal_failed';
            const status = code === 'not_a_seller' || code === 'kyc_or_bank_not_verified'
                ? 403
                : code === 'insufficient_balance' || code === 'insufficient_verified_balance' || code === 'idempotency_conflict'
                    ? 409
                    : 400;
            return NextResponse.json({
                error: ERROR_MESSAGES[code] || 'Unable to create the withdrawal request.',
                code,
                ...(typeof result?.available === 'number' ? { available: result.available } : {}),
            }, { status });
        }

        // The withdrawal table itself drives realtime admin badges. Email is
        // awaited as best-effort so a serverless response cannot terminate the
        // SMTP delivery early.
        if (result.withdrawal_id && !result.replayed) {
            const service = createServiceSupabaseClient();
            const [{ data: profileData }, { data: withdrawalData }, adminEmails] = await Promise.all([
                service.from('profiles').select('display_name, email').eq('id', user.id).maybeSingle(),
                service
                    .from('wallet_withdrawals')
                    .select('bank_name, bank_account_masked')
                    .eq('id', result.withdrawal_id)
                    .single(),
                getAdminNotificationEmails(),
            ]);
            const profile = profileData as { display_name?: string | null; email?: string | null } | null;
            const withdrawal = withdrawalData as { bank_name?: string | null; bank_account_masked?: string | null } | null;

            await sendWithdrawalSubmittedToAdmin({
                sellerName: profile?.display_name || profile?.email || user.email || 'Seller CardVerse',
                sellerEmail: profile?.email || user.email || '',
                amountRequested: result.amount_requested || amount,
                fee: result.fee || 0,
                amountNet: result.amount_net || amount,
                bankName: withdrawal?.bank_name || 'KYC bank',
                bankAccountNumber: withdrawal?.bank_account_masked || '••••',
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
