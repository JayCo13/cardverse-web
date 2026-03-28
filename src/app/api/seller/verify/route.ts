import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sendKYCSubmittedToUser, sendKYCSubmittedToAdmin } from '@/lib/mail';

// POST: Submit KYC verification request
export async function POST(request: NextRequest) {
    try {
        const supabase = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { full_name, id_card_front_url, id_card_back_url, selfie_url, bank_name, bank_account_number, bank_account_name } = body;

        // Validate required fields
        if (!full_name || !id_card_front_url || !id_card_back_url || !selfie_url || !bank_name || !bank_account_number || !bank_account_name) {
            return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
        }

        // Check if already has a verification
        const { data: existing } = await supabase
            .from('seller_verifications')
            .select('id, status')
            .eq('user_id', user.id)
            .single();

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
                    full_name, id_card_front_url, id_card_back_url, selfie_url,
                    bank_name, bank_account_number, bank_account_name,
                    status: 'pending',
                    rejection_reason: null,
                    reviewed_by: null,
                    reviewed_at: null,
                    updated_at: new Date().toISOString(),
                } as never)
                .eq('id', existing.id);

            if (updateError) throw updateError;

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
                full_name, id_card_front_url, id_card_back_url, selfie_url,
                bank_name, bank_account_number, bank_account_name,
                status: 'pending',
            } as never);

        if (insertError) throw insertError;

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
            .single();

        if (error && error.code !== 'PGRST116') throw error;

        return NextResponse.json({ verification: data || null });
    } catch (error: any) {
        console.error('Get verification error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
