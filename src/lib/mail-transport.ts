import nodemailer from 'nodemailer';
import { Resend } from 'resend';

/**
 * Mail transport.
 *
 * Gmail SMTP signs as gmail.com while the From header says cardversehub.com,
 * so receivers see an alignment failure and filter accordingly. Resend sends
 * from our own DKIM-signed domain, which is what actually keeps mail out of
 * spam — the library swap alone does nothing without the DNS records.
 *
 * The shape deliberately matches nodemailer's `sendMail`, so every existing
 * caller keeps working unchanged and removing RESEND_API_KEY rolls the whole
 * thing back to SMTP.
 */

export interface MailMessage {
    from: string;
    /** Optional: admin fan-outs address everyone via bcc. */
    to?: string | string[];
    bcc?: string | string[];
    subject: string;
    html: string;
}

export interface MailTransport {
    sendMail(message: MailMessage): Promise<unknown>;
}

/** Accepts nodemailer's comma-separated strings as well as arrays. */
function toAddressList(value: string | string[] | undefined): string[] {
    if (!value) return [];
    const list = Array.isArray(value) ? value : value.split(',');
    return list.map((address) => address.trim()).filter(Boolean);
}

function resendTransport(apiKey: string): MailTransport {
    const client = new Resend(apiKey);

    return {
        async sendMail(message: MailMessage) {
            const to = toAddressList(message.to);
            const bcc = toAddressList(message.bcc);
            if (to.length === 0 && bcc.length === 0) return null;

            const { data, error } = await client.emails.send({
                from: message.from,
                // Resend rejects an empty `to`; when a message is bcc-only
                // (admin fan-out) the sender address stands in as recipient,
                // which is what the SMTP path did too.
                to: to.length > 0 ? to : [message.from],
                ...(bcc.length > 0 ? { bcc } : {}),
                subject: message.subject,
                html: message.html,
            });

            // Resend reports failures in the payload rather than throwing, so
            // surface them or callers would log every send as a success.
            if (error) throw new Error(`Resend: ${error.name} — ${error.message}`);
            return data;
        },
    };
}

function smtpTransport(): MailTransport {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
        },
        // Nodemailer waits two minutes by default. A serverless function is
        // killed long before that, and outbound SMTP is exactly the kind of
        // connection that hangs rather than refuses — so fail inside the
        // request's own budget and let the caller report a real error.
        connectionTimeout: 5_000,
        greetingTimeout: 5_000,
        socketTimeout: 8_000,
    }) as unknown as MailTransport;
}

export function createMailTransporter(): MailTransport {
    const apiKey = process.env.RESEND_API_KEY;
    return apiKey ? resendTransport(apiKey) : smtpTransport();
}

/**
 * Sender address. With Resend this must be on a domain verified in the
 * dashboard, otherwise every send is rejected.
 */
export function getFromAddress() {
    return (
        process.env.RESEND_FROM_EMAIL ||
        process.env.SMTP_FROM_EMAIL ||
        process.env.SMTP_USER ||
        'CardVerseHub <noreply@cardversehub.com>'
    );
}
