import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getServiceClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

export async function POST(request: Request) {
    try {
        const { subscriptionId, userId } = await request.json();

        if (!subscriptionId || !userId) {
            return NextResponse.json({ error: 'Missing subscriptionId or userId' }, { status: 400 });
        }

        const supabase = getServiceClient();

        // Fetch current credits to ensure atomicity
        const { data: sub, error: fetchError } = await supabase
            .from('user_subscriptions')
            .select('id, scan_credits_remaining, user_id')
            .eq('id', subscriptionId)
            .eq('user_id', userId)
            .eq('status', 'active')
            .single();

        if (fetchError || !sub) {
            return NextResponse.json({ error: 'Subscription not found or inactive' }, { status: 404 });
        }

        const currentCredits = sub.scan_credits_remaining ?? 0;
        if (currentCredits <= 0) {
            return NextResponse.json({ error: 'No credits remaining' }, { status: 403 });
        }

        const newCredits = currentCredits - 1;

        const { error: updateError } = await supabase
            .from('user_subscriptions')
            .update({ scan_credits_remaining: newCredits })
            .eq('id', subscriptionId)
            .eq('scan_credits_remaining', currentCredits); // Optimistic lock

        if (updateError) {
            console.error('[decrement-credit] Update error:', updateError);
            return NextResponse.json({ error: 'Failed to decrement credit' }, { status: 500 });
        }

        return NextResponse.json({ creditsRemaining: newCredits });
    } catch (error: any) {
        console.error('[decrement-credit] Error:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
