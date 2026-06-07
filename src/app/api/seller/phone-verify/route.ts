import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createPhoneVerificationToken } from '@/lib/kyc-verification';
import { verifyFirebasePhoneIdToken } from '@/lib/firebase-server';

export async function POST(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { firebase_id_token } = await request.json();
        if (!firebase_id_token) {
            return NextResponse.json({ error: 'Missing Firebase ID token' }, { status: 400 });
        }

        const verifiedPhoneNumber = await verifyFirebasePhoneIdToken(firebase_id_token);
        const phoneVerificationToken = createPhoneVerificationToken(user.id, verifiedPhoneNumber);

        return NextResponse.json({
            verified_phone_number: verifiedPhoneNumber,
            phone_verification_token: phoneVerificationToken,
        });
    } catch (error: any) {
        console.error('Phone verification error:', error);
        return NextResponse.json({ error: error.message || 'Phone verification failed' }, { status: 500 });
    }
}
