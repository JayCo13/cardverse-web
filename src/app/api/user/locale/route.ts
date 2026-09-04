import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

/**
 * Record the language a signed-in person chose, stamped by the server clock.
 *
 * Two devices disagreeing about the language is normal — someone switches to
 * Japanese on their phone, then opens the laptop that still remembers English —
 * and the newer choice has to win. Ordering them by each device's own clock does
 * not work: a machine running ten minutes fast writes a timestamp from the
 * future and keeps winning forever, pinning the account to a language its owner
 * has since abandoned and mailing them in it.
 *
 * So the timestamp is issued here, where there is exactly one clock, and the
 * browser never gets to assert when it chose.
 */

const SUPPORTED = new Set(['en-US', 'vi-VN', 'ja-JP']);

export async function POST(request: NextRequest) {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let locale: unknown;
    try {
        ({ locale } = await request.json());
    } catch {
        return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    if (typeof locale !== 'string' || !SUPPORTED.has(locale)) {
        return NextResponse.json({ error: 'Unsupported locale' }, { status: 400 });
    }

    const localeUpdatedAt = new Date().toISOString();
    const service = createServiceSupabaseClient();

    // Merge, never replace. `updateUserById` takes the whole `user_metadata`
    // object, so passing only the locale keys would drop `full_name` — which is
    // what every transactional email greets the person by.
    const { data: current } = await service.auth.admin.getUserById(user.id);
    const existing = (current.user?.user_metadata || {}) as Record<string, unknown>;

    const { error } = await service.auth.admin.updateUserById(user.id, {
        user_metadata: { ...existing, locale, locale_updated_at: localeUpdatedAt },
    });
    if (error) {
        console.error('[Locale] Unable to persist language preference:', error);
        return NextResponse.json({ error: 'Unable to save preference' }, { status: 500 });
    }

    // `userId` lets the browser tag its stored preference with its owner, so a
    // shared computer does not carry one person's language into the next
    // person's account.
    return NextResponse.json({ locale, localeUpdatedAt, userId: user.id });
}
