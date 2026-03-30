import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Generate Stringee JWT token for REST API
function generateStringeeToken(): string {
    const apiKeySid = process.env.STRINGEE_API_KEY_SID!;
    const apiKeySecret = process.env.STRINGEE_API_KEY_SECRET!;

    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600; // 1 hour

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', cty: 'stringee-api;v=1' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        jti: `${apiKeySid}-${now}-${crypto.randomUUID()}`,
        iss: apiKeySid,
        exp,
        rest_api: true,
    })).toString('base64url');

    const signature = crypto
        .createHmac('sha256', apiKeySecret)
        .update(`${header}.${payload}`)
        .digest('base64url');

    return `${header}.${payload}.${signature}`;
}

// Shared OTP store via globalThis (for serverless compatibility)
declare global {
    // eslint-disable-next-line no-var
    var otpStore: Map<string, { code: string; expiresAt: number; attempts: number }> | undefined;
}

function getOtpStore() {
    if (!globalThis.otpStore) {
        globalThis.otpStore = new Map();
    }
    return globalThis.otpStore;
}

export async function POST(request: NextRequest) {
    try {
        const { phone } = await request.json();

        if (!phone || !/^0[3-9]\d{8}$/.test(phone)) {
            return NextResponse.json({ error: 'Số điện thoại không hợp lệ' }, { status: 400 });
        }

        if (!process.env.STRINGEE_API_KEY_SID || !process.env.STRINGEE_API_KEY_SECRET) {
            return NextResponse.json({ error: 'Stringee chưa được cấu hình' }, { status: 500 });
        }

        const store = getOtpStore();
        const existing = store.get(phone);
        if (existing && existing.expiresAt - 240000 > Date.now()) {
            // Less than 60 seconds since last OTP (300s expiry - 240s = 60s since creation)
            return NextResponse.json({ error: 'Vui lòng đợi 60 giây trước khi gửi lại' }, { status: 429 });
        }

        // Generate 6-digit OTP
        const otp = crypto.randomInt(100000, 999999).toString();

        // Store OTP with 5-minute expiry
        store.set(phone, {
            code: otp,
            expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
            attempts: 0,
        });

        // Send SMS via Stringee
        const token = generateStringeeToken();

        // Format phone: 0912345678 → 84912345678
        const internationalPhone = '84' + phone.substring(1);

        const smsResponse = await fetch('https://api.stringee.com/v1/sms', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-STRINGEE-AUTH': token,
            },
            body: JSON.stringify({
                sms: [{
                    from: process.env.STRINGEE_SMS_FROM || 'CardVerseHub',
                    to: internationalPhone,
                    text: `[CardVerseHub] Ma OTP cua ban la: ${otp}. Ma co hieu luc trong 5 phut. Khong chia se cho bat ky ai.`,
                }]
            }),
        });

        const smsData = await smsResponse.json();

        if (!smsResponse.ok || smsData.r !== 0) {
            console.error('Stringee SMS error:', smsData);
            // Still return success in dev if Stringee fails (OTP is stored)
            if (process.env.NODE_ENV === 'development') {
                console.log(`[DEV] OTP for ${phone}: ${otp}`);
                return NextResponse.json({ success: true, message: 'OTP đã gửi (dev mode)' });
            }
            return NextResponse.json({ error: 'Không thể gửi SMS. Vui lòng thử lại.' }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: 'OTP đã gửi' });

    } catch (error: any) {
        console.error('Send OTP error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
