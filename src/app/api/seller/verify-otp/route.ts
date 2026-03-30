import { NextRequest, NextResponse } from 'next/server';

// Shared OTP store — import from send-otp would be ideal but Next.js API routes
// don't share module state reliably. Using a global for serverless compatibility.
// In production, use Redis or a database.

// Access the same in-memory store via globalThis
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
        const { phone, otp } = await request.json();

        if (!phone || !otp) {
            return NextResponse.json({ error: 'Thiếu số điện thoại hoặc mã OTP' }, { status: 400 });
        }

        const store = getOtpStore();
        const entry = store.get(phone);

        if (!entry) {
            return NextResponse.json({ error: 'Chưa gửi mã OTP cho số này. Vui lòng gửi lại.' }, { status: 400 });
        }

        // Check expiry
        if (Date.now() > entry.expiresAt) {
            store.delete(phone);
            return NextResponse.json({ error: 'Mã OTP đã hết hạn. Vui lòng gửi lại.' }, { status: 400 });
        }

        // Check max attempts (5)
        if (entry.attempts >= 5) {
            store.delete(phone);
            return NextResponse.json({ error: 'Quá nhiều lần thử. Vui lòng gửi lại mã mới.' }, { status: 429 });
        }

        // Increment attempts
        entry.attempts += 1;

        // Verify OTP
        if (entry.code !== otp) {
            return NextResponse.json({
                error: `Mã OTP không đúng. Còn ${5 - entry.attempts} lần thử.`,
                remaining: 5 - entry.attempts,
            }, { status: 400 });
        }

        // Success — remove from store
        store.delete(phone);

        return NextResponse.json({ success: true, verified: true });

    } catch (error: any) {
        console.error('Verify OTP error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
