import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import {
    sendKYCApproved,
    sendKYCSubmittedToUser,
    sendKYCSubmittedToAdmin,
} from '@/lib/mail';
import { findKycDuplicates } from '@/lib/kyc-duplicate';
import { getAdminNotificationEmails } from '@/lib/admin-recipients';
import { checkNameConsistency, evaluateIdentity, type KycIdentity } from '@/lib/kyc';
import { verifyBankAccount, checkBankAccountHolder } from '@/lib/bank-verification';
import { isBankLookupConfigured } from '@/lib/vietqr';
import type { SupportedLocale } from '@/lib/request-localization';

type KycSessionRow = {
    id: string;
    user_id: string;
    provider: string;
    status: string;
    verified_full_name: string | null;
    verified_dob: string | null;
    verified_document_type: string | null;
    document_number_hash: string | null;
    liveness_score: number | null;
    face_match_score: number | null;
    nfc_verified: boolean;
    warnings: unknown;
    consumed_at: string | null;
    locale: string;
};

function toSupportedLocale(locale: string): SupportedLocale {
    if (locale === 'en-US' || locale === 'ja-JP') return locale;
    return 'vi-VN';
}

async function notifySubmission(userEmail: string, fullName: string, locale: SupportedLocale) {
    const adminEmails = await getAdminNotificationEmails();
    const deliveries: Promise<void>[] = [sendKYCSubmittedToAdmin(fullName, userEmail, adminEmails)];
    if (userEmail) deliveries.push(sendKYCSubmittedToUser(userEmail, fullName, locale));
    await Promise.allSettled(deliveries);
}

/** Rebuild the provider-agnostic identity view from the stored session row. */
function identityFromSession(session: KycSessionRow): KycIdentity {
    return {
        fullName: session.verified_full_name,
        dateOfBirth: session.verified_dob,
        documentNumber: null, // never stored in plaintext — only the keyed hash
        documentType: session.verified_document_type,
        issuingState: null,
        livenessScore: session.liveness_score,
        faceMatchScore: session.face_match_score,
        nfcVerified: session.nfc_verified,
        warnings: Array.isArray(session.warnings) ? session.warnings : [],
    };
}

/**
 * POST: submit seller verification.
 *
 * Identity itself is no longer established here — it comes from an approved
 * provider session written by the webhook under the service role. This handler
 * binds that identity to payout details, then either auto-approves or files the
 * submission for manual review.
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const {
            full_name,
            bank_name,
            bank_bin,
            bank_account_number,
            bank_account_name,
            bank_screenshot_url,
            phone_number,
            kyc_session_id,
        } = body;

        if (!full_name || !bank_name || !bank_account_number || !bank_account_name || !phone_number || !kyc_session_id) {
            return NextResponse.json({ error: 'Vui lòng điền đầy đủ thông tin.' }, { status: 400 });
        }

        if (isBankLookupConfigured() && !/^\d{6}$/.test(String(bank_bin || ''))) {
            return NextResponse.json({ error: 'Vui lòng chọn ngân hàng từ danh sách.' }, { status: 400 });
        }

        if (!/^0[3-9]\d{8}$/.test(phone_number)) {
            return NextResponse.json({ error: 'Số điện thoại không đúng định dạng Việt Nam.' }, { status: 400 });
        }

        // All trust decisions read through the service client. The user has no
        // write access to either table, so nothing here can be self-asserted.
        const service = createServiceSupabaseClient();

        const { data: session } = await service
            .from('kyc_sessions')
            .select(
                'id, user_id, provider, status, verified_full_name, verified_dob, verified_document_type, ' +
                'document_number_hash, liveness_score, face_match_score, nfc_verified, warnings, consumed_at, locale'
            )
            .eq('id', kyc_session_id)
            .eq('user_id', user.id)
            .maybeSingle() as { data: KycSessionRow | null };

        if (!session) {
            return NextResponse.json({ error: 'Không tìm thấy phiên xác minh danh tính.' }, { status: 400 });
        }
        if (session.status !== 'Approved') {
            return NextResponse.json(
                { error: 'Phiên xác minh danh tính chưa được duyệt. Vui lòng hoàn tất bước xác minh.' },
                { status: 400 }
            );
        }
        if (session.consumed_at) {
            return NextResponse.json(
                { error: 'Phiên xác minh này đã được sử dụng. Vui lòng tạo phiên mới.' },
                { status: 400 }
            );
        }

        const identity = identityFromSession(session);

        // Everything that could send this to manual review, collected together.
        const reviewFlags: string[] = [
            ...evaluateIdentity(identity, undefined, {
                hasDocumentNumberHash: !!session.document_number_hash,
            }),
            ...checkNameConsistency({
                verifiedName: session.verified_full_name,
                submittedName: full_name,
                bankAccountName: bank_account_name,
            }).flags,
        ];

        // Authoritative bank check. The form already ran a preview lookup, but
        // that ran on the client's behalf — this is the one that counts.
        let verifiedAccountName: string | null = null;
        let bankVerifiedAt: string | null = null;

        if (isBankLookupConfigured()) {
            const lookup = await verifyBankAccount(service, {
                userId: user.id,
                bin: String(bank_bin),
                accountNumber: String(bank_account_number),
            });
            const bankCheck = checkBankAccountHolder({
                lookup,
                identityName: session.verified_full_name,
            });

            verifiedAccountName = bankCheck.verifiedAccountName;
            if (bankCheck.matches) bankVerifiedAt = new Date().toISOString();
            reviewFlags.push(...bankCheck.flags);
        } else {
            // Deliberately not silent: without a lookup the payout account is
            // self-asserted, and an admin needs to know that.
            reviewFlags.push('Chưa bật tra cứu ngân hàng — tên chủ tài khoản chưa được đối chiếu tự động.');
        }

        let isDuplicate = false;
        let duplicateNotes: string | null = null;
        try {
            const dup = await findKycDuplicates(service, {
                userId: user.id,
                documentNumberHash: session.document_number_hash,
                bankAccountNumber: bank_account_number,
            });
            isDuplicate = dup.cccdDuplicate || dup.bankDuplicate;
            duplicateNotes = dup.notes;
            if (dup.notes) reviewFlags.push(dup.notes);
        } catch (dupErr) {
            console.error('[KYC] Duplicate check failed on submit:', dupErr);
            reviewFlags.push('Không kiểm tra được trùng lặp — cần soát thủ công.');
        }

        const { data: existing } = await service
            .from('seller_verifications')
            .select('id, status')
            .eq('user_id', user.id)
            .maybeSingle() as { data: { id: string; status: string } | null };

        if (existing?.status === 'approved') {
            return NextResponse.json({ error: 'Already verified' }, { status: 400 });
        }
        if (existing?.status === 'pending') {
            return NextResponse.json({ error: 'Verification is pending review' }, { status: 400 });
        }

        // Kill switch. Auto-approval grants seller rights and fixes the payout
        // account with no human in the loop, so a rollout can hold everything
        // for review until the provider config is proven in production.
        // Set KYC_AUTO_APPROVE=false to force manual review.
        const autoApproveEnabled = process.env.KYC_AUTO_APPROVE !== 'false';
        if (!autoApproveEnabled) {
            reviewFlags.push('Tự động duyệt đang tắt (KYC_AUTO_APPROVE=false) — mọi hồ sơ đều chờ admin.');
        }

        // Clean identity + matching names + no duplicate => no human needed.
        const autoApproved = autoApproveEnabled && reviewFlags.length === 0;
        const verificationPayload = {
            full_name,
            bank_name,
            bank_bin: bank_bin ? String(bank_bin) : null,
            bank_account_number,
            // Store what the network said when we have it: this is the name a
            // payout will actually land on.
            bank_account_name: verifiedAccountName || bank_account_name,
            bank_account_name_verified: verifiedAccountName,
            bank_verified_at: bankVerifiedAt,
            bank_screenshot_url: bank_screenshot_url || null,
            phone_number,
            ai_name_match: reviewFlags.length === 0,
            is_duplicate: isDuplicate,
            duplicate_notes: duplicateNotes,
            review_flags: reviewFlags.length > 0 ? reviewFlags : null,
        };

        // Lock + consume the provider session, write the verification and grant
        // seller rights (when clean) in one transaction. A double-submit can no
        // longer redeem the same identity twice or leave a half-written result.
        const { error: finalizeError } = await service.rpc('finalize_seller_verification' as never, {
            p_user_id: user.id,
            p_session_id: session.id,
            p_verification: verificationPayload,
            p_auto_approved: autoApproved,
        } as never);
        if (finalizeError) throw finalizeError;

        const userEmail = user.email || '';
        const locale = toSupportedLocale(session.locale);

        if (autoApproved) {
            // Awaited: on serverless the function freezes once the response is
            // returned, which would cut an in-flight SMTP send.
            if (userEmail) await sendKYCApproved(userEmail, full_name, locale);

            return NextResponse.json({
                success: true,
                status: 'approved',
                auto_approved: true,
                message: 'Verification approved',
            });
        }

        await notifySubmission(userEmail, full_name, locale);

        return NextResponse.json({
            success: true,
            status: 'pending',
            auto_approved: false,
            review_flags: reviewFlags,
            message: 'Verification submitted for review',
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        console.error('Seller verify error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

// GET: check verification status
export async function GET() {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data, error } = await supabase
            .from('seller_verifications')
            .select(
                'id, status, rejection_reason, created_at, updated_at, ' +
                'bank_name, bank_account_number, bank_account_name, ' +
                'bank_account_name_verified, bank_verified_at'
            )
            .eq('user_id', user.id)
            .single() as { data: Record<string, unknown> | null; error: { code?: string; message?: string } | null };

        if (error && error.code !== 'PGRST116') throw error;

        if (!data) return NextResponse.json({ verification: null });

        const accountNumber = typeof data.bank_account_number === 'string'
            ? data.bank_account_number
            : '';

        // Never return the full payout destination from a GET endpoint. The
        // withdrawal RPC snapshots it server-side when a request is created.
        return NextResponse.json({
            verification: {
                id: data.id,
                status: data.status,
                rejection_reason: data.rejection_reason,
                created_at: data.created_at,
                updated_at: data.updated_at,
                bank_name: data.bank_name,
                bank_account_masked: accountNumber.length > 4
                    ? `••••${accountNumber.slice(-4)}`
                    : '••••',
                bank_account_name: data.bank_account_name,
                bank_verified: (
                    typeof data.bank_verified_at === 'string' &&
                    typeof data.bank_account_name_verified === 'string' &&
                    data.bank_account_name_verified.trim().length > 0
                ),
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        console.error('Get verification error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
