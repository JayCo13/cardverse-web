import 'server-only';

import type { SupportedLocale } from '@/lib/request-localization';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

const matchLocale = (value: unknown): SupportedLocale | null => {
    if (typeof value !== 'string') return null;
    const tag = value.toLowerCase();
    if (tag.startsWith('vi')) return 'vi-VN';
    if (tag.startsWith('ja')) return 'ja-JP';
    if (tag.startsWith('en')) return 'en-US';
    return null;
};

/**
 * The recipient's own language wins over the sender's.
 *
 * `fallback` is the locale of the request that triggered the mail, which belongs
 * to the *other* party in an offer — the buyer's browser deciding what language
 * the seller reads. Use it only when the recipient's account says nothing.
 */
const resolveLocale = (candidates: unknown[], fallback: SupportedLocale): SupportedLocale => {
    for (const candidate of candidates) {
        const matched = matchLocale(candidate);
        if (matched) return matched;
    }
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
        locale: resolveLocale([metadata?.locale, metadata?.language], fallbackLocale),
    };
}
