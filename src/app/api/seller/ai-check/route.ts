import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';
import { findKycDuplicates } from '@/lib/kyc-duplicate';
import { normalizeVietnameseName } from '@/lib/kyc-verification';

// ─── Rate Limiter (in-memory, per IP) ───
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 5; // max 5 attempts per window
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const IS_DEV = process.env.NODE_ENV !== 'production';

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; retryAfterSec: number } {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);

    if (!entry || now > entry.resetAt) {
        rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return { allowed: true, remaining: RATE_LIMIT_MAX - 1, retryAfterSec: 0 };
    }

    if (entry.count >= RATE_LIMIT_MAX) {
        const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
        return { allowed: false, remaining: 0, retryAfterSec };
    }

    entry.count++;
    return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count, retryAfterSec: 0 };
}

type ParsedGroqResult = Record<string, any>;

function buildFailureResponse(
    error: string,
    status: number,
    failureType: 'unreadable' | 'wrong_side' | 'low_confidence' | 'network',
    step: 'cccd_front' | 'cccd_back' | 'bank' | 'system',
    debug?: Record<string, unknown>
) {
    return NextResponse.json(
        {
            error,
            failure_type: failureType,
            step,
            ...(IS_DEV ? debug : {}),
        },
        { status }
    );
}

// AI-powered KYC verification: Cross-check CCCD front+back + Bank screenshot
export async function POST(request: NextRequest) {
    const routeStart = Date.now();
    try {
        const authClient = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await authClient.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Rate limit check
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
        const rateCheck = checkRateLimit(ip);
        if (!rateCheck.allowed) {
            return NextResponse.json({
                error: `Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ${rateCheck.retryAfterSec} giây.`,
            }, { status: 429 });
        }

        const { request_id, cccd_front_image_url, cccd_back_image_url, bank_image_url, user_full_name } = await request.json();
        const requestId = request_id || `server-${Date.now()}`;
        console.log(`[KYC API][${requestId}] Request received`);
        if (!cccd_front_image_url) return NextResponse.json({ error: 'Missing CCCD front image' }, { status: 400 });
        if (!cccd_back_image_url) return NextResponse.json({ error: 'Missing CCCD back image' }, { status: 400 });
        if (!bank_image_url) return NextResponse.json({ error: 'Missing Bank screenshot' }, { status: 400 });
        if (!user_full_name) return NextResponse.json({ error: 'Missing full name' }, { status: 400 });

        const groqApiKey = process.env.GROQ_API_KEY;
        if (!groqApiKey) return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 500 });

        // ─── STEP 1: Validate CCCD front ───
        const cccdFrontPrompt = `You are a Vietnamese ID card (CCCD/CMND) analyzer. Look at this image carefully.

Determine if this is the FRONT side of a Vietnamese Citizen Identity Card (Căn Cước Công Dân).
The FRONT side contains: a portrait photo, full name (Họ và tên), date of birth (Ngày sinh), gender, nationality, place of origin, place of residence, expiry date, and the 12-digit ID number.
IMPORTANT: The uploaded image might be rotated sideways or upside down (90, 180, or 270 degrees). Please mentally rotate it to read the text. A rotated ID card is perfectly VALID and you must NOT reject it just because it is not perfectly upright.

Extract the following and return ONLY a valid JSON object:
1. "is_front_side": true if this is clearly the FRONT side of a CCCD, false if it's the back side or not a CCCD at all
2. "full_name": The full name on the card (Họ và tên) if visible, or "" if not the front side
3. "id_number": The 12-digit ID number if visible, or "" if not readable
4. "date_of_birth": Date of birth in DD/MM/YYYY format if visible, or ""
5. "is_valid_id": true if this appears to be a real Vietnamese CCCD/CMND front side, false otherwise
6. "issue": MUST be in Vietnamese. A brief description of the problem if is_front_side is false (e.g., "Đây là mặt sau CCCD, không phải mặt trước", "Đây không phải căn cước công dân", "Ảnh quá mờ, không đọc được")

Example: {"is_front_side":true,"full_name":"NGUYEN VAN ANH","id_number":"079123456789","date_of_birth":"15/03/1995","is_valid_id":true,"issue":""}`;

        // ─── STEP 2: Validate CCCD back ───
        const cccdBackPrompt = `You are a Vietnamese ID card (CCCD/CMND) analyzer. Look at this image carefully.

Determine if this is the BACK side of a Vietnamese Citizen Identity Card (Căn Cước Công Dân).
The BACK side contains: a QR code or MRZ code, the date of issue (Ngày cấp), and possibly a chip. It does NOT have a portrait photo or the person's name.
IMPORTANT: The uploaded image might be rotated sideways or upside down (90, 180, or 270 degrees). Please mentally rotate it to read the text. A rotated ID card is perfectly VALID and you must NOT reject it just because it is not perfectly upright.

Extract the following and return ONLY a valid JSON object:
1. "is_back_side": true if this is clearly the BACK side of a CCCD, false if it's the front side or not a CCCD at all
2. "has_qr_or_mrz": true if a QR code or MRZ code is visible
3. "is_valid_back": true if this appears to be a real CCCD back side
4. "issue": MUST be in Vietnamese. A brief description of the problem if is_back_side is false (e.g., "Đây là mặt trước CCCD, không phải mặt sau", "Đây không phải căn cước công dân", "Ảnh quá mờ")

Example: {"is_back_side":true,"has_qr_or_mrz":true,"is_valid_back":true,"issue":""}`;

        // ─── STEP 3: Analyze Bank screenshot ───
        const bankPrompt = `You are analyzing a screenshot from a Vietnamese banking/e-wallet app. This is typically a "My QR" or "QR Code" or account info screen.

IMPORTANT: The image may contain:
- A QR code (very common in "My QR" screens)
- Account holder name (Tên chủ tài khoản / Tên tài khoản / Họ và tên) - usually in UPPERCASE Vietnamese
- Account number (Số tài khoản / STK)
- Bank logo or bank name text

This is a VALID screenshot if it shows ANY of: QR code screen from a bank app, account info page, transfer screen, or any interface from a Vietnamese banking/e-wallet app (MB Bank, Vietcombank, Techcombank, BIDV, Agribank, VPBank, ACB, Sacombank, TPBank, VIB, SHB, HDBank, OCB, MSB, SeABank, Momo, ZaloPay, ViettelMoney, etc.)

Look VERY carefully at ALL text in the image. The account name and number may appear near/below the QR code, or in smaller text.

Extract the following and return ONLY a valid JSON object:
1. "account_holder_name": The full name of the account holder. Look carefully near QR codes, headers, or anywhere on screen. Usually UPPERCASE.
2. "account_number": The account/card number. May appear below QR code or in account details.
3. "bank_name": The bank or e-wallet name. Look for logos, text headers, or app interface clues.
4. "is_valid_screenshot": true if this is from a real banking/e-wallet app (even if some fields are hard to read). Set false ONLY if the image is clearly NOT from any financial app.

Example: {"account_holder_name":"NGUYEN VAN ANH","account_number":"0123456789012","bank_name":"MB Bank","is_valid_screenshot":true}`;

        // Run all 3 AI calls in parallel (with retry)
        const makeGroqCall = async (prompt: string, imageUrl: string, label: string) => {
            const startedAt = Date.now();
            console.log(`[KYC API][${requestId}] ${label} started`);
            const doFetch = () => fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: imageUrl } }
                        ]
                    }],
                    max_tokens: 500,
                    temperature: 0,
                }),
            });

            let resp = await doFetch();
            // Retry once on 5xx or network error
            if (!resp.ok && resp.status >= 500) {
                console.warn(`Groq ${label} returned ${resp.status}, retrying in 2s...`);
                await new Promise(r => setTimeout(r, 2000));
                resp = await doFetch();
            }
            if (!resp.ok) {
                const errBody = await resp.text().catch(() => '');
                throw new Error(`Groq ${label}: HTTP ${resp.status} - ${errBody.slice(0, 200)}`);
            }
            console.log(`[KYC API][${requestId}] ${label} completed in ${Date.now() - startedAt}ms`);
            return resp.json();
        };

        const makeBackFallbackCall = async (imageUrl: string) => {
            const fallbackPrompt = `You are doing a strict SECOND PASS for the BACK side of a Vietnamese CCCD/CMND.

The image may be rotated 90, 180, or 270 degrees. Mentally rotate it if needed.
Do NOT classify it as front side unless you clearly see a portrait photo and the person's full name.

For a valid BACK side, look for any of these clues:
- QR code
- MRZ lines
- issue date
- chip / back-side layout
- no portrait photo

Return ONLY valid JSON:
{"is_back_side":true,"has_qr_or_mrz":true,"is_valid_back":true,"issue":"","confidence":"high"}
or
{"is_back_side":false,"has_qr_or_mrz":false,"is_valid_back":false,"issue":"MUST be in Vietnamese","confidence":"low"}`;

            return makeGroqCall(fallbackPrompt, imageUrl, 'CCCD-Back-Fallback');
        };

        const groqBatchStart = Date.now();
        const [frontData, backData, bankData] = await Promise.all([
            makeGroqCall(cccdFrontPrompt, cccd_front_image_url, 'CCCD-Front'),
            makeGroqCall(cccdBackPrompt, cccd_back_image_url, 'CCCD-Back'),
            makeGroqCall(bankPrompt, bank_image_url, 'Bank'),
        ]);
        console.log(`[KYC API][${requestId}] All Groq calls completed in ${Date.now() - groqBatchStart}ms`);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parseAIResponse = (data: any): any => {
            let content = data.choices?.[0]?.message?.content || '';
            content = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) content = jsonMatch[0];
            return JSON.parse(content);
        };

        // Parse results
        let frontResult: ParsedGroqResult, backResult: ParsedGroqResult, bankResult: ParsedGroqResult;
        const issues: string[] = [];

        try {
            frontResult = parseAIResponse(frontData);
        } catch {
            return buildFailureResponse(
                'Không thể đọc được ảnh CCCD mặt trước. Vui lòng chụp lại rõ hơn.',
                400,
                'unreadable',
                'cccd_front',
                {
                    debug_front_image_url: cccd_front_image_url,
                }
            );
        }

        try {
            backResult = parseAIResponse(backData);
        } catch {
            return buildFailureResponse(
                'Không thể đọc được ảnh CCCD mặt sau. Vui lòng chụp lại rõ hơn.',
                400,
                'unreadable',
                'cccd_back',
                {
                    debug_back_image_url: cccd_back_image_url,
                }
            );
        }

        try {
            bankResult = parseAIResponse(bankData);
        } catch {
            return buildFailureResponse(
                'Không thể đọc được ảnh ngân hàng. Vui lòng chụp lại rõ hơn.',
                400,
                'unreadable',
                'bank',
                {
                    debug_bank_image_url: bank_image_url,
                }
            );
        }

        if ((!backResult.is_back_side || !backResult.is_valid_back) && !backResult.has_qr_or_mrz) {
            try {
                const fallbackData = await makeBackFallbackCall(cccd_back_image_url);
                const fallbackResult = parseAIResponse(fallbackData);
                if (fallbackResult.is_back_side || fallbackResult.has_qr_or_mrz) {
                    backResult = {
                        ...backResult,
                        ...fallbackResult,
                        is_back_side: Boolean(fallbackResult.is_back_side),
                        is_valid_back: Boolean(fallbackResult.is_valid_back || fallbackResult.has_qr_or_mrz),
                    };
                }
            } catch (fallbackError) {
                console.warn(`[KYC API][${requestId}] CCCD-Back fallback failed`, fallbackError);
            }
        }

        // ─── Validate CCCD pair ───
        if (!frontResult.is_front_side) {
            issues.push(`Ảnh CCCD mặt trước: ${frontResult.issue || 'Không phải mặt trước CCCD'}`);
        }
        if (!backResult.is_back_side) {
            issues.push(`Ảnh CCCD mặt sau: ${backResult.issue || 'Không phải mặt sau CCCD'}`);
        }
        if (!frontResult.is_valid_id && frontResult.is_front_side) {
            issues.push('Ảnh CCCD mặt trước không hợp lệ hoặc bị mờ');
        }
        if (!backResult.is_valid_back && backResult.is_back_side) {
            issues.push('Ảnh CCCD mặt sau không hợp lệ hoặc bị mờ');
        }
        if (!bankResult.is_valid_screenshot) {
            issues.push('Ảnh chụp ngân hàng không hợp lệ hoặc không phải app ngân hàng');
        }

        // ─── Cross-check names: CCCD vs Bank vs User input ───
        const cccdName = frontResult.full_name || '';
        const bankName = bankResult.account_holder_name || '';
        const normalizedCCCD = normalizeVietnameseName(cccdName);
        const normalizedBank = normalizeVietnameseName(bankName);
        const normalizedUser = normalizeVietnameseName(user_full_name);

        const isCccdBankMatch = normalizedCCCD === normalizedBank;
        const isCccdUserMatch = normalizedCCCD === normalizedUser;
        const isBankUserMatch = normalizedBank === normalizedUser;

        if (isCccdBankMatch && !isCccdUserMatch && cccdName) {
            // CCCD and Bank match each other, but user entered wrong name
            issues.push(`Tên bạn nhập "${user_full_name}" không khớp với CCCD và Ngân hàng. Tên đúng: "${cccdName}"`);
        } else if (!isCccdBankMatch && cccdName && bankName) {
            // CCCD and Bank names don't match each other
            issues.push(`Tên trên CCCD "${cccdName}" không khớp với tên ngân hàng "${bankName}"`);
            if (!isCccdUserMatch) {
                issues.push(`Tên bạn nhập "${user_full_name}" cũng không khớp với CCCD`);
            }
        } else if (!isCccdUserMatch && cccdName) {
            issues.push(`Tên bạn nhập "${user_full_name}" không khớp với tên trên CCCD "${cccdName}"`);
        }

        // Calculate confidence
        let confidence = 0;
        if (frontResult.is_front_side && frontResult.is_valid_id) confidence += 0.35;
        if (backResult.is_back_side && backResult.is_valid_back) confidence += 0.2;
        if (bankResult.is_valid_screenshot) confidence += 0.25;
        if (isCccdBankMatch) confidence += 0.1;
        if (isCccdUserMatch) confidence += 0.1;

        const payload = {
            // CCCD data
            cccd_name: cccdName,
            cccd_id_number: frontResult.id_number || null,
            cccd_dob: frontResult.date_of_birth || null,
            is_valid_cccd: frontResult.is_front_side && frontResult.is_valid_id,
            // CCCD back validation
            is_valid_cccd_back: backResult.is_back_side && backResult.is_valid_back,
            // Bank data
            bank_account_name: bankName,
            bank_account_number: bankResult.account_number || '',
            bank_name_detected: bankResult.bank_name || null,
            is_valid_bank: bankResult.is_valid_screenshot || false,
            // Match results
            is_name_match: isCccdBankMatch && isCccdUserMatch,
            is_cccd_bank_match: isCccdBankMatch,
            is_cccd_user_match: isCccdUserMatch,
            confidence: Math.round(confidence * 100) / 100,
            // Issues
            issues: issues.length > 0 ? issues : null,
            failure_type: issues.length > 0
                ? (!frontResult.is_front_side || !backResult.is_back_side ? 'wrong_side' : confidence < 0.7 ? 'low_confidence' : 'unreadable')
                : null,
        };

        const { data: scan, error: insertError } = await authClient
            .from('kyc_verification_scans')
            .insert({
                user_id: user.id,
                cccd_name: payload.cccd_name,
                cccd_id_number: payload.cccd_id_number,
                cccd_dob: payload.cccd_dob,
                is_valid_cccd: payload.is_valid_cccd,
                is_valid_cccd_back: payload.is_valid_cccd_back,
                bank_account_name_ai: payload.bank_account_name,
                bank_account_number_ai: payload.bank_account_number,
                bank_name_detected: payload.bank_name_detected,
                is_valid_bank: payload.is_valid_bank,
                ai_name_match: payload.is_name_match,
                is_cccd_bank_match: payload.is_cccd_bank_match,
                is_cccd_user_match: payload.is_cccd_user_match,
                confidence: payload.confidence,
                issues: payload.issues,
                raw_front_response: frontResult,
                raw_back_response: backResult,
                raw_bank_response: bankResult,
            } as never)
            .select('id')
            .single() as { data: { id: string } | null; error: { message?: string } | null };

        if (insertError || !scan) {
            throw new Error(insertError?.message || 'Failed to persist KYC scan');
        }

        // Cross-account duplicate check (ban-evasion / shared CCCD or bank account).
        // Uses the service client so RLS doesn't hide other users' verifications.
        let duplicate = { cccdDuplicate: false, bankDuplicate: false, matchedCount: 0, notes: null as string | null };
        try {
            duplicate = await findKycDuplicates(createServiceSupabaseClient(), {
                userId: user.id,
                cccdIdNumber: payload.cccd_id_number,
                bankAccountNumber: payload.bank_account_number,
            });
            if (duplicate.cccdDuplicate || duplicate.bankDuplicate) {
                console.warn(`[KYC API][${requestId}] Duplicate detected for user ${user.id}: ${duplicate.notes}`);
            }
        } catch (dupErr) {
            console.error(`[KYC API][${requestId}] Duplicate check failed:`, dupErr);
        }

        console.log(`[KYC API][${requestId}] Total API time ${Date.now() - routeStart}ms`);

        return NextResponse.json({
            ...payload,
            scan_id: scan.id,
            duplicate,
            ...(IS_DEV ? {
                debug_front_image_url: cccd_front_image_url,
                debug_back_image_url: cccd_back_image_url,
                debug_bank_image_url: bank_image_url,
                debug_front_result: frontResult,
                debug_back_result: backResult,
                debug_bank_result: bankResult,
            } : {}),
        });

    } catch (error: any) {
        console.error(`AI KYC check error after ${Date.now() - routeStart}ms:`, error);
        const msg = error.message || 'Internal server error';
        // Provide user-friendly error messages
        if (msg.includes('HTTP 429') || msg.includes('rate_limit')) {
            return buildFailureResponse('Groq API đang quá tải. Vui lòng đợi 30 giây rồi thử lại.', 429, 'network', 'system');
        }
        if (msg.includes('HTTP 413') || msg.includes('too large')) {
            return buildFailureResponse('Ảnh quá nặng. Vui lòng chọn ảnh nhỏ hơn hoặc chụp lại.', 400, 'unreadable', 'system');
        }
        if (msg.includes('HTTP 5') || msg.includes('fetch failed')) {
            return buildFailureResponse('Hệ thống của chúng tôi đang gián đoạn tạm thời. Vui lòng thử lại sau vài giây.', 502, 'network', 'system');
        }
        return buildFailureResponse(`Lỗi xác minh: ${msg.slice(0, 150)}`, 500, 'network', 'system');
    }
}
