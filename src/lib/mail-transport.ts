import nodemailer from 'nodemailer';

// This Gmail account owns the sender logo used by CardVerseHub.
// Do not select Resend or use a domain alias: those are different senders.
export const MAIL_SENDER_EMAIL = 'cardversehubsupport@gmail.com';

export interface MailMessage {
  from: string;
  to?: string | string[];
  bcc?: string | string[];
  subject: string;
  html: string;
}

export interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>;
}

export function getFromAddress(): string {
  return `CardVerseHub <${MAIL_SENDER_EMAIL}>`;
}

export function createMailTransporter(): MailTransport {
  const user = process.env.SMTP_USER?.trim().toLowerCase();
  const password = process.env.SMTP_PASSWORD;
  const host = process.env.SMTP_HOST?.trim().toLowerCase() || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || '587');

  if (user !== MAIL_SENDER_EMAIL || !password?.trim()) {
    throw new Error('Configure SMTP_USER as cardversehubsupport@gmail.com and set SMTP_PASSWORD to its Gmail app password.');
  }
  if (host !== 'smtp.gmail.com' || ![465, 587].includes(port)) {
    throw new Error('CardVerseHub mail requires smtp.gmail.com on port 465 or 587.');
  }

  const smtp = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user: MAIL_SENDER_EMAIL, pass: password },
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 8_000,
  });

  return {
    async sendMail(message) {
      const hasRecipient = (value: string | string[] | undefined) =>
        (Array.isArray(value) ? value : (value || '').split(','))
          .some((address) => address.trim().length > 0);
      if (!hasRecipient(message.to) && !hasRecipient(message.bcc)) return null;

      // Enforce identity at the boundary too; keep BCC recipients private.
      return smtp.sendMail({ ...message, from: getFromAddress() });
    },
  };
}
