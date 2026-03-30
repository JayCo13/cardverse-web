import { NextRequest, NextResponse } from 'next/server';

// ─── Rate Limiter (in-memory, per IP) ───
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 5; // max 5 attempts per window
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

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

// AI-powered KYC verification: Cross-check CCCD front+back + Bank screenshot
export async function POST(request: NextRequest) {
    try {
        // Rate limit check
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
        const rateCheck = checkRateLimit(ip);
        if (!rateCheck.allowed) {
            return NextResponse.json({
                error: `Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ${rateCheck.retryAfterSec} giây.`,
            }, { status: 429 });
        }

        const { cccd_front_image, cccd_back_image, bank_image, user_full_name } = await request.json();
        if (!cccd_front_image) return NextResponse.json({ error: 'Missing CCCD front image' }, { status: 400 });
        if (!cccd_back_image) return NextResponse.json({ error: 'Missing CCCD back image' }, { status: 400 });
        if (!bank_image) return NextResponse.json({ error: 'Missing Bank screenshot' }, { status: 400 });
        if (!user_full_name) return NextResponse.json({ error: 'Missing full name' }, { status: 400 });

        const groqApiKey = process.env.GROQ_API_KEY;
        if (!groqApiKey) return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 500 });

        // ─── STEP 1: Validate CCCD front ───
        const cccdFrontPrompt = `You are a Vietnamese ID card (CCCD/CMND) analyzer. Look at this image carefully.

Determine if this is the FRONT side of a Vietnamese Citizen Identity Card (Căn Cước Công Dân).
The FRONT side contains: a portrait photo, full name (Họ và tên), date of birth (Ngày sinh), gender, nationality, place of origin, place of residence, expiry date, and the 12-digit ID number.

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
        const makeGroqCall = async (prompt: string, imageBase64: string, label: string) => {
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
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
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
            return resp.json();
        };

        const [frontData, backData, bankData] = await Promise.all([
            makeGroqCall(cccdFrontPrompt, cccd_front_image, 'CCCD-Front'),
            makeGroqCall(cccdBackPrompt, cccd_back_image, 'CCCD-Back'),
            makeGroqCall(bankPrompt, bank_image, 'Bank'),
        ]);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parseAIResponse = (data: any): any => {
            let content = data.choices?.[0]?.message?.content || '';
            content = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) content = jsonMatch[0];
            return JSON.parse(content);
        };

        // Parse results
        let frontResult, backResult, bankResult;
        const issues: string[] = [];

        try {
            frontResult = parseAIResponse(frontData);
        } catch {
            return NextResponse.json({ error: 'Không thể đọc được ảnh CCCD mặt trước. Vui lòng chụp lại rõ hơn.', step: 'cccd_front' }, { status: 400 });
        }

        try {
            backResult = parseAIResponse(backData);
        } catch {
            return NextResponse.json({ error: 'Không thể đọc được ảnh CCCD mặt sau. Vui lòng chụp lại rõ hơn.', step: 'cccd_back' }, { status: 400 });
        }

        try {
            bankResult = parseAIResponse(bankData);
        } catch {
            return NextResponse.json({ error: 'Không thể đọc được ảnh ngân hàng. Vui lòng chụp lại rõ hơn.', step: 'bank' }, { status: 400 });
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
        const normalizeName = (name: string): string => {
            return name
                .toUpperCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^A-Z\s]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        };

        const cccdName = frontResult.full_name || '';
        const bankName = bankResult.account_holder_name || '';
        const normalizedCCCD = normalizeName(cccdName);
        const normalizedBank = normalizeName(bankName);
        const normalizedUser = normalizeName(user_full_name);

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
        if (frontResult.is_front_side && frontResult.is_valid_id) confidence += 0.2;
        if (backResult.is_back_side && backResult.is_valid_back) confidence += 0.1;
        if (bankResult.is_valid_screenshot) confidence += 0.2;
        if (isCccdBankMatch) confidence += 0.25;
        if (isCccdUserMatch) confidence += 0.25;

        return NextResponse.json({
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
        });

    } catch (error: any) {
        console.error('AI KYC check error:', error);
        const msg = error.message || 'Internal server error';
        // Provide user-friendly error messages
        if (msg.includes('HTTP 429') || msg.includes('rate_limit')) {
            return NextResponse.json({ error: 'Groq API đang quá tải. Vui lòng đợi 30 giây rồi thử lại.' }, { status: 429 });
        }
        if (msg.includes('HTTP 413') || msg.includes('too large')) {
            return NextResponse.json({ error: 'Ảnh quá nặng. Vui lòng chọn ảnh nhỏ hơn hoặc chụp lại.' }, { status: 400 });
        }
        if (msg.includes('HTTP 5') || msg.includes('fetch failed')) {
            return NextResponse.json({ error: 'Hệ thống AI đang gián đoạn tạm thời. Vui lòng thử lại sau vài giây.' }, { status: 502 });
        }
        return NextResponse.json({ error: `Lỗi xác minh: ${msg.slice(0, 150)}` }, { status: 500 });
    }
}
