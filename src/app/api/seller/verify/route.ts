import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sendKYCSubmittedToUser, sendKYCSubmittedToAdmin } from '@/lib/mail';
import { normalizeVietnameseName } from '@/lib/kyc-verification';

// POST: Submit KYC verification request
export async function POST(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const {
            full_name, id_card_front_url, id_card_back_url,
            bank_name, bank_account_number, bank_account_name,
            bank_screenshot_url, phone_number,
            scan_id,
        } = body;

        // Validate required fields
        if (!full_name || !id_card_front_url || !id_card_back_url || !bank_name || !bank_account_number || !bank_account_name || !bank_screenshot_url || !phone_number || !scan_id) {
            return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
        }

        if (!/^0[3-9]\d{8}$/.test(phone_number)) {
            return NextResponse.json({ error: 'Số điện thoại không đúng định dạng Việt Nam.' }, { status: 400 });
        }

        const { data: scan, error: scanError } = await supabase
            .from('kyc_verification_scans')
            .select('*')
            .eq('id', scan_id)
            .eq('user_id', user.id)
            .is('used_at', null)
            .single() as {
                data: {
                    id: string;
                    cccd_name: string | null;
                    bank_account_name_ai: string | null;
                    bank_account_number_ai: string | null;
                    confidence: number;
                    ai_name_match: boolean;
                    is_valid_cccd: boolean;
                    is_valid_cccd_back: boolean;
                    is_valid_bank: boolean;
                    expires_at: string;
                } | null;
                error: { message?: string } | null;
            };

        if (scanError || !scan) {
            return NextResponse.json({ error: 'Không tìm thấy phiên quét KYC hợp lệ.' }, { status: 400 });
        }
        if (new Date(scan.expires_at).getTime() < Date.now()) {
            return NextResponse.json({ error: 'Phiên quét KYC đã hết hạn. Vui lòng quét lại.' }, { status: 400 });
        }
        if (!scan.is_valid_cccd || !scan.is_valid_cccd_back || !scan.is_valid_bank || Number(scan.confidence) < 0.7) {
            return NextResponse.json({ error: 'Kết quả quét KYC chưa đạt yêu cầu. Vui lòng quét lại.' }, { status: 400 });
        }

        const normalizedFullName = normalizeVietnameseName(full_name);
        const normalizedScanName = normalizeVietnameseName(scan.cccd_name || '');
        const normalizedBankAccountName = normalizeVietnameseName(bank_account_name);
        if (!normalizedScanName || normalizedFullName !== normalizedScanName || normalizedBankAccountName !== normalizedScanName) {
            return NextResponse.json({ error: 'Tên người dùng, CCCD và tên chủ tài khoản phải trùng khớp.' }, { status: 400 });
        }

        // Check if already has a verification
        const { data: existing } = await supabase
            .from('seller_verifications')
            .select('id, status')
            .eq('user_id', user.id)
            .single() as { data: { id: string; status: string } | null };

        if (existing) {
            if (existing.status === 'approved') {
                return NextResponse.json({ error: 'Already verified' }, { status: 400 });
            }
            if (existing.status === 'pending') {
                return NextResponse.json({ error: 'Verification is pending review' }, { status: 400 });
            }
            // If rejected, allow resubmission by updating
            const { error: updateError } = await supabase
                .from('seller_verifications')
                .update({
                    full_name, id_card_front_url, id_card_back_url,
                    bank_name, bank_account_number, bank_account_name,
                    bank_screenshot_url, phone_number,
                    ai_cccd_name: scan.cccd_name,
                    ai_bank_name: scan.bank_account_name_ai,
                    ai_bank_number: scan.bank_account_number_ai,
                    ai_confidence: scan.confidence,
                    ai_name_match: scan.ai_name_match,
                    ai_scan_id: scan.id,
                    status: 'pending',
                    rejection_reason: null,
                    reviewed_by: null,
                    reviewed_at: null,
                    updated_at: new Date().toISOString(),
                } as never)
                .eq('id', existing.id);

            if (updateError) throw updateError;

            await supabase
                .from('kyc_verification_scans')
                .update({ used_at: new Date().toISOString() } as never)
                .eq('id', scan.id);

            // Send email notifications (async, don't block response)
            const userEmail = user.email || '';
            sendKYCSubmittedToUser(userEmail, full_name);
            sendKYCSubmittedToAdmin(full_name, userEmail);

            return NextResponse.json({ success: true, message: 'Verification resubmitted' });
        }

        // Create new verification request
        const { error: insertError } = await supabase
            .from('seller_verifications')
            .insert({
                user_id: user.id,
                full_name, id_card_front_url, id_card_back_url,
                bank_name, bank_account_number, bank_account_name,
                bank_screenshot_url, phone_number,
                ai_cccd_name: scan.cccd_name,
                ai_bank_name: scan.bank_account_name_ai,
                ai_bank_number: scan.bank_account_number_ai,
                ai_confidence: scan.confidence,
                ai_name_match: scan.ai_name_match,
                ai_scan_id: scan.id,
                status: 'pending',
            } as never);

        if (insertError) throw insertError;

        await supabase
            .from('kyc_verification_scans')
            .update({ used_at: new Date().toISOString() } as never)
            .eq('id', scan.id);

        // Send email notifications (async, don't block response)
        const userEmail = user.email || '';
        sendKYCSubmittedToUser(userEmail, full_name);
        sendKYCSubmittedToAdmin(full_name, userEmail);

        return NextResponse.json({ success: true, message: 'Verification submitted' });
    } catch (error: any) {
        console.error('Seller verify error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}

// GET: Check verification status
export async function GET() {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data, error } = await supabase
            .from('seller_verifications')
            .select('*')
            .eq('user_id', user.id)
            .single() as { data: Record<string, unknown> | null; error: { code?: string; message?: string } | null };

        if (error && error.code !== 'PGRST116') throw error;

        return NextResponse.json({ verification: data || null });
    } catch (error: any) {
        console.error('Get verification error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
