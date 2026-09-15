// All mail is delivered by Resend from the verified cardversehub.com domain
// (DKIM signed by our own domain, which is what keeps it out of spam).
// RESEND_API_KEY is required; MAIL_FROM_EMAIL picks the sender on that domain
// and MAIL_REPLY_TO is where replies land.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10_000;
const MAIL_DOMAIN = 'cardversehub.com';
const DEFAULT_SENDER = `support@${MAIL_DOMAIN}`;

// Resend caps one message at 50 addresses across to + cc + bcc. A bcc-only
// fan-out spends one slot on the sender (see sendMail), so bulk callers must
// batch bcc at 49 or the whole message is rejected.
export const MAX_RECIPIENTS_PER_MESSAGE = 50;
export const MAX_BCC_PER_MESSAGE = MAX_RECIPIENTS_PER_MESSAGE - 1;

export interface MailMessage {
  from: string;
  to?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  subject: string;
  html: string;
  /** Plain-text alternative; generated from `html` when omitted. */
  text?: string;
}

export interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>;
}

function getApiKey(): string {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error('Configure RESEND_API_KEY to send CardVerseHub email.');
  return key;
}

// Resend only accepts senders on a verified domain, so anything outside
// cardversehub.com is rejected here rather than on every send.
export function getSenderEmail(): string {
  const configured = process.env.MAIL_FROM_EMAIL?.trim().toLowerCase() || DEFAULT_SENDER;
  if (!new RegExp(`^[a-z0-9._%+-]+@${MAIL_DOMAIN.replace('.', '\\.')}$`).test(configured)) {
    throw new Error(`Configure MAIL_FROM_EMAIL as an address on ${MAIL_DOMAIN}.`);
  }
  return configured;
}

export function getFromAddress(): string {
  return `CardVerseHub <${getSenderEmail()}>`;
}

function getReplyTo(message: MailMessage): string | undefined {
  return message.replyTo?.trim() || process.env.MAIL_REPLY_TO?.trim() || undefined;
}

function toAddressList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : value.split(',');
  return list.map((address) => address.trim()).filter(Boolean);
}

// Multipart text+html scores better with spam filters than html alone; the
// builders only produce html, so the alternative is derived at the boundary.
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&middot;/g, '·')
    .replace(/&copy;/g, '©')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function describeRecipients(message: MailMessage): string {
  const to = toAddressList(message.to).join(',');
  const bccCount = toAddressList(message.bcc).length;
  return `to="${to}" bcc=${bccCount} subject="${message.subject}"`;
}

export function createMailTransporter(): MailTransport {
  const apiKey = getApiKey();

  return {
    async sendMail(message) {
      const to = toAddressList(message.to);
      const bcc = toAddressList(message.bcc);
      if (to.length === 0 && bcc.length === 0) return null;

      // Enforce identity at the boundary; keep BCC recipients private.
      const from = getFromAddress();
      const replyTo = getReplyTo(message);
      // Resend rejects an empty `to`; a bcc-only fan-out addresses the
      // sender itself so the real recipients stay private.
      const toList = to.length > 0 ? to : [from];
      if (toList.length + bcc.length > MAX_RECIPIENTS_PER_MESSAGE) {
        throw new Error(
          `[Mail] Resend send refused ${describeRecipients(message)} :: ${toList.length + bcc.length} recipients exceeds the ${MAX_RECIPIENTS_PER_MESSAGE} per-message cap`,
        );
      }
      const payload = {
        from,
        to: toList,
        ...(bcc.length > 0 ? { bcc } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject: message.subject,
        html: message.html,
        text: message.text?.trim() || htmlToText(message.html),
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
      try {
        const response = await fetch(RESEND_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => ({}))) as
          { id?: string; statusCode?: number; name?: string; message?: string; error?: { name?: string; message?: string } };
        const error = !response.ok ? body : body.error;
        if (error) {
          const detail = [response.status, error.name, error.message].filter(Boolean).join(' ');
          throw new Error(`[Mail] Resend send failed ${describeRecipients(message)} :: ${detail}`);
        }
        return { id: body.id };
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('[Mail]')) throw error;
        const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : String(error);
        throw new Error(`[Mail] Resend send failed ${describeRecipients(message)} :: ${reason}`);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
