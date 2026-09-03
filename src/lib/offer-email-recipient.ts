import 'server-only';

import type { SupportedLocale } from '@/lib/request-localization';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

const normalizeLocale = (value: unknown, fallback: SupportedLocale): SupportedLocale => {
    if (value === 'vi' || value === 'vi-VN') return 'vi-VN';
    if (value === 'ja' || value === 'ja-JP') return 'ja-JP';
    if (value === 'en' || value === 'en-US') return 'en-US';
    return fallback;
};

export async function getOfferEmailRecipient(userId: string, fallbackLocale: SupportedLocale) {
    const service = createServiceSupabaseClient();
    const [profileResult, authResult] = await Promise.all([
        service.from('profiles').select('email, display_name').eq('id', userId).maybeSingle(),
        service.auth.admin.getUserById(userId),
    ]);
    const profile = profileResult.data as { email?: string | null; display_name?: string | null } | null;
    const authUser = authResult.data.user;
    const email = profile?.email || authUser?.email || '';
    const metadata = authUser?.user_metadata as Record<string, unknown> | undefined;
    const name = profile?.display_name
        || (typeof metadata?.full_name === 'string' ? metadata.full_name : '')
        || (typeof metadata?.name === 'string' ? metadata.name : '')
        || email.split('@')[0]
        || 'CardVerseHub';

    return {
        email,
        name,
        locale: normalizeLocale(metadata?.locale ?? metadata?.language, fallbackLocale),
    };
}
