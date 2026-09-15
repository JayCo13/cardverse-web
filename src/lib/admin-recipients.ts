import { createServiceSupabaseClient } from '@/lib/supabase/service';

/** Auth roles that should receive operational review mail. */
const NOTIFIED_ROLES = new Set(['admin', 'moderator']);

// Resolve the real admin audience from Supabase Auth. MAIL_REPLY_TO is a
// safe local fallback for the environment-backed moderator when
// MODERATOR_EMAIL has not also been copied to the web deployment.
export async function getAdminNotificationEmails(): Promise<string[]> {
    try {
        const service = createServiceSupabaseClient();
        const recipients = new Map<string, string>();
        const perPage = 1000;

        for (let page = 1; ; page += 1) {
            const { data, error } = await service.auth.admin.listUsers({ page, perPage });
            if (error) throw error;

            for (const admin of data.users) {
                // Moderators review the same queue; leaving them out meant a
                // mod could only be reached by also listing their address in
                // MODERATOR_EMAIL, which nothing enforced.
                if (NOTIFIED_ROLES.has(String(admin.app_metadata?.role)) && admin.email) {
                    recipients.set(admin.email.toLowerCase(), admin.email);
                }
            }

            if (data.users.length < perPage) break;
        }

        const configuredRecipients = [
            ...(process.env.MODERATOR_EMAIL || '').split(','),
            ...(process.env.ADMIN_NOTIFICATION_EMAILS || '').split(','),
        ];

        // Without MODERATOR_EMAIL, fall back to the reply-to mailbox the team
        // already reads so admin alerts are not silently dropped.
        if (!process.env.MODERATOR_EMAIL && process.env.MAIL_REPLY_TO) {
            configuredRecipients.push(process.env.MAIL_REPLY_TO);
        }

        for (const configuredEmail of configuredRecipients) {
            const email = configuredEmail.trim();
            if (email) recipients.set(email.toLowerCase(), email);
        }

        return [...recipients.values()];
    } catch (error) {
        console.error('[Admin notifications] Failed to load recipient emails:', error);
        return [];
    }
}
