import { createHash, createHmac } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminNotificationEmails } from '@/lib/admin-recipients';
import { sendContactSubmissionConfirmation, sendContactSubmittedToAdmin } from '@/lib/mail';
import { getRequestLocale } from '@/lib/request-localization';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ContactPayload = {
    name?: unknown;
    email?: unknown;
    subject?: unknown;
    message?: unknown;
};

function normalizedText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
}

function getRequestIp(request: NextRequest) {
    return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || request.headers.get('x-real-ip')
        || 'unknown';
}

function hashIp(ip: string) {
    // The salt is server-only. SUPABASE_SERVICE_ROLE_KEY is a stable fallback
    // for deployments that have not configured CONTACT_RATE_LIMIT_SECRET yet.
    const secret = process.env.CONTACT_RATE_LIMIT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error('Contact rate-limit secret is not configured');
    return createHmac('sha256', secret).update(ip).digest('hex');
}

export async function POST(request: NextRequest) {
    const locale = getRequestLocale(request);
    let payload: ContactPayload;

    try {
        payload = await request.json();
    } catch {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    const name = normalizedText(payload.name);
    const email = normalizedText(payload.email).toLowerCase();
    const subject = normalizedText(payload.subject);
    const message = normalizedText(payload.message);

    if (
        name.length < 2 || name.length > 100
        || /[\r\n]/.test(name)
        || !EMAIL_PATTERN.test(email) || email.length > 254
        || subject.length < 3 || subject.length > 160
        || /[\r\n]/.test(subject)
        || message.length < 10 || message.length > 4000
    ) {
        return NextResponse.json({ error: 'validation_failed' }, { status: 400 });
    }

    try {
        let userId: string | null = null;
        try {
            const supabase = await createServerSupabaseClient();
            const { data: { user } } = await supabase.auth.getUser();
            userId = user?.id || null;
        } catch {
            // Contact remains available to guests even when their auth cookie
            // cannot be refreshed.
        }

        const contact = { name, email, subject, message };
        const service = createServiceSupabaseClient();
        const { data, error } = await service.rpc('create_contact_request' as never, {
            p_user_id: userId,
            p_name: name,
            p_email: email,
            p_subject: subject,
            p_message: message,
            p_email_hash: hash(email),
            p_ip_hash: hashIp(getRequestIp(request)),
        } as never);

        if (error) throw error;

        const result = data as { ok?: boolean; reason?: string; id?: string } | null;
        if (!result?.ok) {
            if (result?.reason === 'rate_limited') {
                return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
            }
            throw new Error('Contact request was not created');
        }

        // Persistence is the success condition. Mail transport failures must not
        // lose a support ticket or make the user submit it again.
        const adminRecipients = await getAdminNotificationEmails();
        await Promise.allSettled([
            sendContactSubmissionConfirmation(email, contact, locale),
            sendContactSubmittedToAdmin(contact, adminRecipients),
        ]);

        return NextResponse.json({ id: result.id }, { status: 201 });
    } catch (error) {
        console.error('[Contact] Failed to create contact request:', error);
        return NextResponse.json({ error: 'contact_unavailable' }, { status: 500 });
    }
}
