// Forum Notification Email Sender
// Sends professional email notifications for forum interactions through
// Resend from the verified cardversehub.com domain (RESEND_API_KEY secret).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Sender must be an address on the domain verified in Resend
const MAIL_SENDER_EMAIL = Deno.env.get('MAIL_FROM_EMAIL')?.trim() || 'support@cardversehub.com';
const RESEND_TIMEOUT_MS = 10_000;

interface Notification {
    id: string;
    user_id: string;
    actor_id: string;
    type: 'post_like' | 'comment' | 'comment_reply';
    post_id: string;
    comment_id: string | null;
}

interface Profile {
    id: string;
    email: string;
    display_name: string | null;
}

interface Post {
    id: string;
    content: string;
    user_id: string;
}

// Generate professional HTML email
function generateEmailHtml(
    type: string,
    recipientName: string,
    actorName: string,
    postPreview: string,
    postId: string
): string {
    const baseUrl = 'https://cardversehub.com';
    const postUrl = `${baseUrl}/forum?post=${postId}`;

    let title = '';
    let message = '';
    let emoji = '';

    switch (type) {
        case 'post_like':
            title = 'Someone liked your post! ❤️';
            message = `<strong>${actorName}</strong> liked your post on CardVerseHub.`;
            emoji = '❤️';
            break;
        case 'comment':
            title = 'New comment on your post 💬';
            message = `<strong>${actorName}</strong> commented on your post.`;
            emoji = '💬';
            break;
        case 'comment_reply':
            title = 'Someone replied to your comment 💬';
            message = `<strong>${actorName}</strong> replied to your comment.`;
            emoji = '💬';
            break;
    }

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0a0a0a;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.5);">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 30px 40px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1);">
                            <img src="https://cardversehub.com/assets/logo-verse.png" alt="CardVerseHub" height="40" style="display: block; height: 40px; width: auto; border: 0; margin: 0 auto;">
                            <p style="margin: 5px 0 0; color: rgba(255,255,255,0.5); font-size: 12px; letter-spacing: 2px; text-transform: uppercase;">
                                Trading Card Community
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <!-- Emoji -->
                            <div style="text-align: center; font-size: 48px; margin-bottom: 20px;">
                                ${emoji}
                            </div>
                            
                            <!-- Title -->
                            <h2 style="margin: 0 0 20px; color: #ffffff; font-size: 24px; font-weight: 600; text-align: center;">
                                ${title}
                            </h2>
                            
                            <!-- Message -->
                            <p style="margin: 0 0 30px; color: rgba(255,255,255,0.8); font-size: 16px; line-height: 1.6; text-align: center;">
                                ${message}
                            </p>
                            
                            <!-- Post Preview -->
                            <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; margin-bottom: 30px; border: 1px solid rgba(255,255,255,0.1);">
                                <p style="margin: 0; color: rgba(255,255,255,0.6); font-size: 14px; line-height: 1.6;">
                                    "${postPreview.length > 150 ? postPreview.substring(0, 150) + '...' : postPreview}"
                                </p>
                            </div>
                            
                            <!-- CTA Button -->
                            <div style="text-align: center;">
                                <a href="${postUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%); color: #000000; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 8px; text-transform: uppercase; letter-spacing: 1px;">
                                    View Post
                                </a>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px; text-align: center; background: rgba(0,0,0,0.2); border-top: 1px solid rgba(255,255,255,0.1);">
                            <p style="margin: 0 0 10px; color: rgba(255,255,255,0.4); font-size: 12px;">
                                You received this email because you're a member of CardVerseHub.
                            </p>
                            <p style="margin: 0; color: rgba(255,255,255,0.3); font-size: 11px;">
                                © 2026 CardVerseHub. All rights reserved.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

// Send email via Resend
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    try {
        const resendApiKey = Deno.env.get('RESEND_API_KEY')?.trim();
        if (!resendApiKey) throw new Error('Configure the RESEND_API_KEY secret for forum email.');
        const replyTo = Deno.env.get('MAIL_REPLY_TO')?.trim();
        // Notifications are processed one after another and only marked sent
        // afterwards, so a stalled request must not eat the whole invocation.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
        try {
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: `CardVerseHub <${MAIL_SENDER_EMAIL}>`,
                    to: [to],
                    ...(replyTo ? { reply_to: replyTo } : {}),
                    subject,
                    text: 'Please view this email in an HTML-compatible client.',
                    html,
                }),
                signal: controller.signal,
            });
            if (!response.ok) {
                const body = await response.text().catch(() => '');
                throw new Error(`Resend ${response.status}: ${body}`);
            }
            return true;
        } finally {
            clearTimeout(timer);
        }
    } catch (error) {
        console.error('Email send error:', error);
        return false;
    }
}

// Process pending notifications
async function processPendingNotifications(): Promise<{ processed: number; sent: number }> {
    // Get pending notifications
    const { data: notifications, error } = await supabase
        .from('forum_notifications')
        .select('*')
        .eq('email_sent', false)
        .order('created_at', { ascending: true })
        .limit(50);

    if (error || !notifications) {
        console.error('Error fetching notifications:', error);
        return { processed: 0, sent: 0 };
    }

    let sentCount = 0;

    for (const notification of notifications as Notification[]) {
        try {
            // Get recipient profile
            const { data: recipient } = await supabase
                .from('profiles')
                .select('id, email, display_name')
                .eq('id', notification.user_id)
                .single();

            if (!recipient?.email) {
                console.log(`No email for user ${notification.user_id}, skipping`);
                continue;
            }

            // Get actor profile
            const { data: actor } = await supabase
                .from('profiles')
                .select('id, display_name')
                .eq('id', notification.actor_id)
                .single();

            const actorName = actor?.display_name || 'Someone';
            const recipientName = recipient.display_name || 'there';

            // Get post content
            const { data: post } = await supabase
                .from('forum_posts')
                .select('id, content')
                .eq('id', notification.post_id)
                .single();

            const postPreview = post?.content || 'View the post on CardVerseHub';

            // Generate subject based on type
            let subject = '';
            switch (notification.type) {
                case 'post_like':
                    subject = `❤️ ${actorName} liked your post on CardVerseHub`;
                    break;
                case 'comment':
                    subject = `💬 ${actorName} commented on your post`;
                    break;
                case 'comment_reply':
                    subject = `💬 ${actorName} replied to your comment`;
                    break;
            }

            // Generate email HTML
            const html = generateEmailHtml(
                notification.type,
                recipientName,
                actorName,
                postPreview,
                notification.post_id
            );

            // Send email
            const sent = await sendEmail(recipient.email, subject, html);

            if (sent) {
                // Mark as sent
                await supabase
                    .from('forum_notifications')
                    .update({
                        email_sent: true,
                        email_sent_at: new Date().toISOString()
                    })
                    .eq('id', notification.id);

                sentCount++;
                console.log(`✓ Sent ${notification.type} notification to ${recipient.email}`);
            }

            // Rate limit: wait 1 second between emails
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (err) {
            console.error(`Error processing notification ${notification.id}:`, err);
        }
    }

    return { processed: notifications.length, sent: sentCount };
}

// Main handler
Deno.serve(async (req) => {
    try {
        // Allow manual trigger or scheduled invocation
        const result = await processPendingNotifications();

        return new Response(
            JSON.stringify({
                success: true,
                message: `Processed ${result.processed} notifications, sent ${result.sent} emails`
            }),
            { headers: { 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('Handler error:', error);
        return new Response(
            JSON.stringify({ success: false, error: String(error) }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
});
