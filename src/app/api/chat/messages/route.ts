import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

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

// Normalize separators (space, dot, dash, parentheses) then look for a
// Vietnamese phone shape: +84/84/0 followed by 8-10 digits, or any bare
// run of 9-12 digits (unlikely to be a price typed inside a chat).
const hasPhoneNumber = (body: string) => {
    const normalized = body.replace(/[\s.\-()]/g, '');
    return /(?:\+?84|0)\d{8,10}/.test(normalized) || /\d{9,12}/.test(normalized);
};

const detectBlocked = (body: string): { code: string } | null => {
    if (LINK_REGEX.test(body)) {
        return { code: 'blocked_external_link' };
    }
    if (hasPhoneNumber(body)) {
        return { code: 'blocked_phone_number' };
    }
    return null;
};

const findFlaggedTerms = (body: string) => {
    const normalized = body.toLowerCase();
    return SAFETY_TERMS.filter(term => normalized.includes(term));
};

// Read the text printed/handwritten inside an image so the same anti-scam rules
// (no phone numbers, no off-platform contacts) apply to pictures. Uses the same
// Groq vision model the KYC flow relies on. Best-effort: a failure returns ''
// so a transient OCR outage never blocks legitimate image sending.
const ocrImage = async (imageUrl: string): Promise<string> => {
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) return '';
    try {
        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${groqApiKey}`,
            },
            body: JSON.stringify({
                model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'Extract ALL text visible in this image exactly as written — including phone numbers, links, usernames/handles, Zalo/Telegram/Facebook references and any handwriting. Output only the raw extracted text, no commentary. If there is no text, output nothing.',
                        },
                        { type: 'image_url', image_url: { url: imageUrl } },
                    ],
                }],
                max_tokens: 500,
                temperature: 0,
            }),
        });
        if (!resp.ok) return '';
        const data = await resp.json();
        return String(data?.choices?.[0]?.message?.content || '');
    } catch {
        return '';
    }
};

const preview = (body: string) => body.trim().replace(/\s+/g, ' ').slice(0, 160);

const isOwnedCloudinaryImage = (value: string) => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    if (!cloudName) return false;
    try {
        const url = new URL(value);
        const parts = url.pathname.split('/').filter(Boolean);
        return url.protocol === 'https:'
            && url.hostname === 'res.cloudinary.com'
            && parts[0] === cloudName
            && parts[1] === 'image'
            && parts[2] === 'upload';
    } catch {
        return false;
    }
};

export async function GET(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');
    // Cursor for loading older history: pass the created_at of the oldest
    // message currently displayed.
    const before = searchParams.get('before');

    if (!conversationId) {
        return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
    }

    const PAGE_SIZE = 80;

    // Newest-first + reverse: ascending+limit returned the OLDEST 80, so a
    // long conversation opened without its most recent messages.
    let query = supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

    if (before) {
        query = query.lt('created_at', before);
    }

    const { data, error } = await query;

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const page = data || [];
    return NextResponse.json({
        messages: [...page].reverse(),
        hasMore: page.length === PAGE_SIZE,
    });
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

    if (!['user', 'system', 'offer_auto', 'safety_warning', 'image'].includes(messageType)) {
        return NextResponse.json({ error: 'Invalid message type' }, { status: 400 });
    }

    const imageUrl = messageType === 'image' && typeof metadata?.imageUrl === 'string'
        ? metadata.imageUrl
        : null;

    if (!conversationId) {
        return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
    }
    if (messageType === 'image') {
        // Only accept images we just uploaded to our own Cloudinary account.
        if (!imageUrl || !isOwnedCloudinaryImage(imageUrl)) {
            return NextResponse.json({ error: 'A valid image is required' }, { status: 400 });
        }
    } else if (!messageBody) {
        return NextResponse.json({ error: 'conversationId and body are required' }, { status: 400 });
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

    // Only user-typed messages and user-sent images are screened. App-generated
    // messages (offer_auto, system) are trusted and may legitimately contain
    // numbers/links.
    let flaggedTerms: string[] = [];
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
        flaggedTerms = findFlaggedTerms(messageBody);
    } else if (messageType === 'image' && imageUrl) {
        // OCR the image, then screen the extracted text (plus any caption).
        const ocrText = await ocrImage(imageUrl);
        const screenText = `${messageBody} ${ocrText}`.trim();
        // Phone numbers in an image are a deliberate off-platform contact attempt
        // → hard block. Printed URLs (e.g. a card back's "topps.com") are common
        // on legitimate card photos, so a detected link is only a soft warning.
        if (hasPhoneNumber(screenText)) {
            return NextResponse.json(
                {
                    error: 'Ảnh chứa số điện thoại bị chặn.',
                    code: 'blocked_phone_number',
                },
                { status: 422 },
            );
        }
        flaggedTerms = findFlaggedTerms(screenText);
        if (LINK_REGEX.test(screenText)) {
            flaggedTerms = [...new Set([...flaggedTerms, 'link'])];
        }
    }

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
    const previewText = messageType === 'image'
        ? (messageBody ? preview(messageBody) : '📷 Hình ảnh')
        : preview(messageBody);

    const offerIdFromMetadata = typeof metadata?.offerId === 'string'
        ? metadata.offerId
        : typeof metadata?.offer_id === 'string'
            ? metadata.offer_id
            : null;

    await supabase
        .from('conversations')
        .update({
            last_message_id: (message as any).id,
            last_message_preview: previewText,
            last_message_at: (message as any).created_at,
            [readColumn]: now,
            updated_at: now,
            ...(messageType === 'offer_auto' && offerIdFromMetadata ? { offer_id: offerIdFromMetadata } : {}),
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
    await createServiceSupabaseClient().from('notifications').insert({
        user_id: recipientId,
        type: 'message_received',
        title: 'Tin nhắn mới',
        message: previewText,
        card_id: conversationRow.card_id,
        offer_id: conversationRow.offer_id,
        conversation_id: conversationId,
        read: false,
    } as never);

    return NextResponse.json({ message, flaggedTerms });
}
