import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const SAFETY_TERMS = [
    'facebook',
    'fb',
    'zalo',
    'phone',
    'sdt',
    'số điện thoại',
    'so dien thoai',
    'bank',
    'ngân hàng',
    'ngan hang',
    'chuyển khoản ngoài',
    'chuyen khoan ngoai',
    'telegram',
    'whatsapp',
];

const SAFETY_WARNING =
    '⚠️ CardVerse phát hiện nội dung có thể đưa giao dịch ra ngoài nền tảng. Để tránh scam, hãy trao đổi và thanh toán trực tiếp trên CardVerse.';

// Hard-block patterns: external links and phone numbers are not allowed at all,
// because the whole anti-scam model relies on keeping the deal on CardVerse.
const LINK_REGEX = /(https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+\.(com|vn|net|org|io|me|info|shop|store|co|xyz|app)\b/i;

const detectBlocked = (body: string): { code: string } | null => {
    if (LINK_REGEX.test(body)) {
        return { code: 'blocked_external_link' };
    }
    // Normalize separators (space, dot, dash, parentheses) then look for a
    // Vietnamese phone shape: +84/84/0 followed by 8-10 digits, or any bare
    // run of 9-12 digits (unlikely to be a price typed inside a chat).
    const normalized = body.replace(/[\s.\-()]/g, '');
    if (/(?:\+?84|0)\d{8,10}/.test(normalized) || /\d{9,12}/.test(normalized)) {
        return { code: 'blocked_phone_number' };
    }
    return null;
};

const findFlaggedTerms = (body: string) => {
    const normalized = body.toLowerCase();
    return SAFETY_TERMS.filter(term => normalized.includes(term));
};

const preview = (body: string) => body.trim().replace(/\s+/g, ' ').slice(0, 160);

export async function GET(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');

    if (!conversationId) {
        return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
    }

    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(80);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ messages: data || [] });
}

export async function POST(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const conversationId = String(body.conversationId || body.conversation_id || '');
    const messageBody = String(body.body || '').trim();
    const messageType = body.messageType || body.message_type || 'user';
    const metadata = body.metadata || {};

    if (!conversationId || !messageBody) {
        return NextResponse.json({ error: 'conversationId and body are required' }, { status: 400 });
    }

    if (!['user', 'system', 'offer_auto', 'safety_warning'].includes(messageType)) {
        return NextResponse.json({ error: 'Invalid message type' }, { status: 400 });
    }

    const { data: conversation, error: conversationError } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single();

    if (conversationError || !conversation) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const conversationRow = conversation as any;
    if (conversationRow.buyer_id !== user.id && conversationRow.seller_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only user-typed messages are screened. App-generated messages (offer_auto,
    // system) are trusted and may legitimately contain numbers/links.
    if (messageType === 'user') {
        const blocked = detectBlocked(messageBody);
        if (blocked) {
            return NextResponse.json(
                {
                    error: 'Tin nhắn chứa số điện thoại hoặc liên kết bị chặn.',
                    code: blocked.code,
                },
                { status: 422 },
            );
        }
    }

    const flaggedTerms = messageType === 'user' ? findFlaggedTerms(messageBody) : [];

    const { data: message, error: insertError } = await supabase
        .from('messages')
        .insert({
            conversation_id: conversationId,
            sender_id: user.id,
            body: messageBody,
            message_type: messageType,
            metadata,
            flagged_terms: flaggedTerms,
        } as never)
        .select()
        .single();

    if (insertError || !message) {
        return NextResponse.json({ error: insertError?.message || 'Could not send message' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const readColumn = conversationRow.buyer_id === user.id ? 'buyer_last_read_at' : 'seller_last_read_at';

    await supabase
        .from('conversations')
        .update({
            last_message_id: (message as any).id,
            last_message_preview: preview(messageBody),
            last_message_at: (message as any).created_at,
            [readColumn]: now,
            updated_at: now,
        } as never)
        .eq('id', conversationId);

    if (flaggedTerms.length > 0) {
        await supabase.from('messages').insert({
            conversation_id: conversationId,
            sender_id: user.id,
            body: SAFETY_WARNING,
            message_type: 'safety_warning',
            metadata: { flaggedTerms },
            flagged_terms: flaggedTerms,
        } as never);
    }

    const recipientId = conversationRow.buyer_id === user.id ? conversationRow.seller_id : conversationRow.buyer_id;
    await supabase.from('notifications').insert({
        user_id: recipientId,
        type: 'message_received',
        title: 'Tin nhắn mới',
        message: preview(messageBody),
        card_id: conversationRow.card_id,
        offer_id: conversationRow.offer_id,
        conversation_id: conversationId,
        read: false,
    } as never);

    return NextResponse.json({ message, flaggedTerms });
}
