/**
 * The half of the offer lifecycle that has to send email.
 *
 * pg_cron runs `cron_expire_stale_offers()` every ten minutes and closes the
 * offers that can no longer be paid — that part must be right whether or not
 * anything is deployed. It cannot do this part: reminding a buyer four hours
 * before their payment window shuts means SMTP, which Postgres does not speak.
 *
 * Splitting them matters more than it looks. `run_offer_payment_lifecycle`
 * CLAIMS a reminder by stamping `payment_reminder_sent_at`, so whoever calls it
 * has taken responsibility for posting the mail; a scheduler that called it and
 * threw the rows away would burn every reminder silently. Hence: pg_cron calls
 * the expiry function, this calls the route, and neither can consume the
 * other's work.
 *
 * It also closes the loop on the missed-payment penalty. That penalty only
 * lands on a buyer who was actually warned, so with no reminders going out, no
 * buyer could ever be penalised for ignoring a deadline.
 *
 * Needs `CRON_SECRET` set in the Netlify site environment — the route fails
 * closed without it, because it runs on the service role and relists cards.
 */
export default async () => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[Offers] CRON_SECRET is not set; skipping payment reminders");
    return new Response("CRON_SECRET missing", { status: 500 });
  }

  // `URL` is the site's own address, injected by Netlify at runtime.
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) {
    console.error("[Offers] no site URL in the environment; skipping payment reminders");
    return new Response("site URL missing", { status: 500 });
  }

  const response = await fetch(`${base}/api/cron/offer-payment-lifecycle`, {
    method: "POST",
    headers: { "x-cron-secret": secret },
  });
  const body = await response.text();

  if (!response.ok) {
    console.error(`[Offers] payment lifecycle returned ${response.status}: ${body}`);
    return new Response(body, { status: 502 });
  }

  console.log(`[Offers] payment lifecycle: ${body}`);
  return new Response(body, { status: 200 });
};

/**
 * Quarter-hourly. The reminder fires when a deadline is four hours out, so the
 * interval only decides how far into that window the mail lands; anything under
 * an hour is invisible to the buyer, and the pass is a no-op when nothing is due.
 */
export const config = { schedule: "*/15 * * * *" };
