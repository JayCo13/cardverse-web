import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const conversationId = String(body.conversationId || body.conversation_id || '');

    if (!conversationId) {
        return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
    }

    const { data: conversation, error } = await supabase
        .from('conversations')
        .select('id, buyer_id, seller_id')
        .eq('id', conversationId)
        .single();

    if (error || !conversation) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const row = conversation as any;
    if (row.buyer_id !== user.id && row.seller_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const readColumn = row.buyer_id === user.id ? 'buyer_last_read_at' : 'seller_last_read_at';
    const readAt = new Date().toISOString();

    const { error: updateError } = await supabase
        .from('conversations')
        .update({ [readColumn]: readAt, updated_at: readAt } as never)
        .eq('id', conversationId);

    if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, readAt });
}
