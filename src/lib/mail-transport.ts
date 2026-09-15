import nodemailer from 'nodemailer';

// Each app configures its own Gmail sender through SMTP_USER.
function getSenderEmail(): string {
  const user = process.env.SMTP_USER?.trim().toLowerCase();
  if (!user || !/^[a-z0-9._%+-]+@gmail\.com$/.test(user)) {
    throw new Error('Configure SMTP_USER as the Gmail account used to send web email.');
  }
  return user;
}

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
  return `CardVerseHub <${getSenderEmail()}>`;
}

export function createMailTransporter(): MailTransport {
  const user = getSenderEmail();
  const password = process.env.SMTP_PASSWORD;
  const host = process.env.SMTP_HOST?.trim().toLowerCase() || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || '587');

  if (!password?.trim()) {
    throw new Error('Configure SMTP_PASSWORD as the Gmail app password for SMTP_USER.');
  }
  if (host !== 'smtp.gmail.com' || ![465, 587].includes(port)) {
    throw new Error('CardVerseHub mail requires smtp.gmail.com on port 465 or 587.');
  }

  const smtp = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass: password },
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
      return smtp.sendMail({ ...message, from: `CardVerseHub <${user}>` });
    },
  };
}
