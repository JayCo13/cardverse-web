import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { verifyBankAccount, checkBankAccountHolder } from '@/lib/bank-verification';

type KycSessionRow = { verified_full_name: string | null; status: string };

/**
 * Preview lookup for the seller form: shows the user the real account holder
 * before they submit, instead of letting them discover a mismatch afterwards.
 *
 * This is a convenience endpoint only. /api/seller/verify performs its own
 * lookup and its own comparison — nothing decided here is carried over on the
 * client's word.
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const bin = typeof body?.bin === 'string' ? body.bin.trim() : '';
        const accountNumber = typeof body?.account_number === 'string' ? body.account_number.trim() : '';

        if (!bin || !accountNumber) {
            return NextResponse.json({ error: 'Thiếu mã ngân hàng hoặc số tài khoản.' }, { status: 400 });
        }

        const service = createServiceSupabaseClient();
        const lookup = await verifyBankAccount(service, { userId: user.id, bin, accountNumber });

        if (lookup.status === 'unavailable') {
            // Say which it is. "Temporarily disrupted" is wrong — and unhelpful —
            // when the lookup is simply not on our plan, because then waiting
            // and retrying will never work.
            const message =
                lookup.reason === 'rate_limited'
                    ? 'Bạn đã tra cứu quá nhiều lần. Vui lòng thử lại sau 1 giờ.'
                    : lookup.reason === 'not_configured' || lookup.reason === 'plan_required' || lookup.reason === 'unauthorized'
                        ? 'Tra cứu tự động chưa được bật. Vui lòng nhập tên chủ tài khoản đúng như trên giấy tờ — admin sẽ đối chiếu khi duyệt.'
                        : 'Dịch vụ tra cứu ngân hàng đang gián đoạn. Bạn vẫn có thể gửi hồ sơ, admin sẽ kiểm tra thủ công.';

            return NextResponse.json(
                { status: 'unavailable', error: message, reason: lookup.reason },
                { status: lookup.reason === 'rate_limited' ? 429 : 503 }
            );
        }

        if (lookup.status === 'not_found') {
            return NextResponse.json({ status: 'not_found', error: lookup.message }, { status: 400 });
        }

        // Tell the user up front whether this account will pass the check, using
        // the identity already established for them.
        const { data: session } = await service
            .from('kyc_sessions')
            .select('verified_full_name, status')
            .eq('user_id', user.id)
            .eq('status', 'Approved')
            .is('consumed_at', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle() as { data: KycSessionRow | null };

        const check = checkBankAccountHolder({
            lookup,
            identityName: session?.verified_full_name ?? null,
        });

        return NextResponse.json({
            status: 'ok',
            account_name: lookup.accountName,
            matches_identity: check.matches,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        console.error('Bank lookup error:', message);
        return NextResponse.json({ error: 'Không thể tra cứu tài khoản.' }, { status: 500 });
    }
}
