import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
    try {
        const authClient = await createServerSupabaseClient();
        const { data: { user }, error: authError } = await authClient.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: verification, error: verificationError } = await authClient
            .from('seller_verifications')
            .select('status')
            .eq('user_id', user.id)
            .eq('status', 'approved')
            .single();

        if (verificationError || !verification) {
            return NextResponse.json({ error: 'Seller verification required' }, { status: 403 });
        }

        const body = await request.json();
        const cardData = {
            ...body,
            seller_id: user.id,
        };

        const { data: card, error: insertError } = await authClient
            .from('cards')
            .insert(cardData as never)
            .select('id')
            .single() as { data: { id: string } | null; error: { message?: string } | null };

        if (insertError || !card) {
            return NextResponse.json({ error: insertError?.message || 'Failed to create listing' }, { status: 400 });
        }

        return NextResponse.json({ success: true, cardId: card.id });
    } catch (error: any) {
        console.error('Create listing error:', error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
