import { createServiceSupabaseClient } from '@/lib/supabase/service';

// Resolve the real admin audience from Supabase Auth. The SMTP account is a
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
                if (admin.app_metadata?.role === 'admin' && admin.email) {
                    recipients.set(admin.email.toLowerCase(), admin.email);
                }
            }

            if (data.users.length < perPage) break;
        }

        const configuredRecipients = [
            ...(process.env.MODERATOR_EMAIL || '').split(','),
            ...(process.env.ADMIN_NOTIFICATION_EMAILS || '').split(','),
        ];

        // In local setups SMTP_USER and MODERATOR_EMAIL are commonly the same
        // mailbox. This fallback prevents silent mail loss when only the admin
        // app has MODERATOR_EMAIL configured.
        if (!process.env.MODERATOR_EMAIL && process.env.SMTP_USER) {
            configuredRecipients.push(process.env.SMTP_USER);
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
