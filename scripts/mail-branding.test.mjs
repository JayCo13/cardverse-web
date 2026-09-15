import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const resendSender = 'CardVerseHub <support@cardversehub.com>';
const replyTo = 'cardversehub.vn@gmail.com';
const logo = 'https://cardversehub.com/assets/logo-verse.png';

// Execute real mail builders and transport without secrets or network access:
// the transport posts to the Resend API, captured by the fetch mock.
function harness(overrides = {}) {
  const env = { RESEND_API_KEY: 're_test_key', MAIL_REPLY_TO: replyTo,
    RESEND_FROM_EMAIL: 'CardVerse <noreply@cardversehub.com>', NEXT_PUBLIC_APP_URL: 'http://localhost:3000', ...overrides };
  const sent = [];
  const requests = [];
  let resendResponse = () => ({ ok: true, status: 200, json: async () => ({ id: 'resend-id' }) });
  const fetch = async (url, init) => {
    const message = JSON.parse(init.body);
    requests.push({ url, headers: init.headers, message });
    const response = resendResponse(message);
    if (response.ok) sent.push(message);
    return response;
  };
  const cache = new Map();
  function load(path, mocks = {}) {
    const url = new URL(path, root);
    const filename = fileURLToPath(url);
    if (cache.has(filename)) return cache.get(filename);
    const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
    });
    const mod = { exports: {} };
    runInNewContext(outputText, { module: mod, exports: mod.exports, process: { env },
      // Short delays (rate-limit pauses) run immediately; the transport's 10s abort timer is never fired.
      console, Response, Date, fetch, AbortController, setTimeout: (fn, ms) => (ms < 10_000 && fn(), 0), clearTimeout: () => {},
      Deno: { env: { get: (key) => env[key] }, serve: (handler) => { cache.set('handler', handler); } },
      require(name) {
        if (name in mocks) return mocks[name];
        if (name.startsWith('.')) return load(new URL(name.endsWith('.ts') ? name : `${name}.ts`, url).href);
        throw new Error(`Unexpected dependency: ${name}`);
      },
    }, { filename });
    cache.set(filename, mod.exports);
    return mod.exports;
  }
  return { env, sent, requests, load, cache, failResend(response) { resendResponse = () => response; } };
}

const transportPath = 'src/lib/mail-transport.ts';

test('Resend delivers from the verified domain, overrides caller From, replies to Gmail and adds plain text', async () => {
  const h = harness();
  const mail = h.load(transportPath);
  assert.equal(mail.getFromAddress(), resendSender);
  assert.equal(mail.getSenderEmail(), 'support@cardversehub.com');
  const transport = mail.createMailTransporter();
  const result = await transport.sendMail({ from: 'CardVerse <noreply@cardversehub.com>', to: 'buyer@example.test', subject: 'Reminder', html: '<p>Hello &amp; <a href="https://cardversehub.com">welcome</a></p>' });
  assert.equal(result.id, 'resend-id');
  assert.equal(h.requests[0].url, 'https://api.resend.com/emails');
  assert.equal(h.requests[0].headers.Authorization, 'Bearer re_test_key');
  const message = h.sent[0];
  assert.equal(message.from, resendSender);
  assert.deepEqual(message.to, ['buyer@example.test']);
  assert.equal(message.bcc, undefined);
  assert.equal(message.reply_to, replyTo);
  assert.equal(message.text, 'Hello & welcome (https://cardversehub.com)');
  assert.equal(await transport.sendMail({ from: resendSender, to: ' ', subject: 'Empty', html: '' }), null);
  assert.equal(h.sent.length, 1);
});

test('Resend bcc-only fan-out addresses the sender and keeps recipients private; MAIL_* env overrides apply', async () => {
  const h = harness({ MAIL_FROM_EMAIL: 'Hello@CardVerseHub.com', MAIL_REPLY_TO: 'team@example.test' });
  const transport = h.load(transportPath).createMailTransporter();
  await transport.sendMail({ from: 'CardVerse <old@gmail.com>', bcc: 'one@example.test, two@example.test', subject: 'News', html: 'test' });
  assert.equal(h.sent[0].from, 'CardVerseHub <hello@cardversehub.com>');
  assert.deepEqual(h.sent[0].to, ['CardVerseHub <hello@cardversehub.com>']);
  assert.deepEqual(h.sent[0].bcc, ['one@example.test', 'two@example.test']);
  assert.equal(h.sent[0].reply_to, 'team@example.test');
});

test('Resend rejects senders outside cardversehub.com and surfaces API failures with the subject', async () => {
  const wrongDomain = harness({ MAIL_FROM_EMAIL: 'noreply@gmail.com' }).load(transportPath);
  assert.throws(() => wrongDomain.getFromAddress(), /MAIL_FROM_EMAIL/);
  await assert.rejects(wrongDomain.createMailTransporter().sendMail({ from: '', to: 'a@example.test', subject: 'x', html: 'x' }), /MAIL_FROM_EMAIL/);
  const h = harness();
  h.failResend({ ok: false, status: 403, json: async () => ({ statusCode: 403, name: 'validation_error', message: 'domain is not verified' }) });
  await assert.rejects(
    h.load(transportPath).createMailTransporter().sendMail({ from: resendSender, to: 'buyer@example.test', subject: 'Reminder', html: 'test' }),
    /Resend send failed to="buyer@example.test" bcc=0 subject="Reminder" :: 403 validation_error domain is not verified/,
  );
  assert.equal(h.sent.length, 0);
});

test('Resend recipient cap: 49 bcc fits with the sender slot, 50 bcc is refused before any request', async () => {
  const h = harness();
  const mail = h.load(transportPath);
  assert.equal(mail.MAX_BCC_PER_MESSAGE, 49);
  const transport = mail.createMailTransporter();
  const many = (n) => Array.from({ length: n }, (_, i) => `sub${i}@example.test`);
  await transport.sendMail({ from: resendSender, bcc: many(49), subject: 'News', html: 'x' });
  assert.equal(h.sent[0].to.length + h.sent[0].bcc.length, 50);
  await assert.rejects(transport.sendMail({ from: resendSender, bcc: many(50), subject: 'News', html: 'x' }), /51 recipients exceeds the 50 per-message cap/);
  await assert.rejects(transport.sendMail({ from: resendSender, to: many(2), bcc: many(49), subject: 'News', html: 'x' }), /exceeds/);
  assert.equal(h.requests.length, 1);
});

test('missing RESEND_API_KEY fails before any send', async () => {
  for (const key of [undefined, '', '  ']) {
    const h = harness({ RESEND_API_KEY: key });
    assert.throws(() => h.load(transportPath).createMailTransporter(), /RESEND_API_KEY/);
    assert.equal(h.requests.length, 0);
  }
});

function assertBranded(message, expectedSender = resendSender) {
  assert.equal(message.from, expectedSender);
  assert.ok(message.text.length > 0);
  assert.ok(message.html.includes(`src="${logo}"`));
  assert.ok(message.html.includes('alt="CardVerseHub"'));
  assert.doesNotMatch(message.html, /localhost:3001/);
}

test('all 15 web email builders use the branded identity and public logo, including all offer locales', async () => {
  const h = harness();
  const mail = h.load('src/lib/mail.ts');
  const email = 'buyer@example.test';
  const admins = ['admin@example.test'];
  const order = { orderId: '12345678-0000', cardName: 'Rio Ngumoha', amount: 19900000, shippingFee: 0, totalPaid: 19900000 };
  const contact = { name: 'Buyer', email, subject: 'Support', message: 'Help' };
  const offer = { recipientName: 'Buyer', cardName: 'Rio Ngumoha', cardId: 'card-id', offerId: 'offer-id', offerPrice: 19900000, listingPrice: 20000000 };
  const cases = [
    ['sendKYCIdentityApproved', [email, 'Buyer', 'vi-VN']],
    ['sendKYCSubmittedToUser', [email, 'Buyer']],
    ['sendOrderBookedEmail', [email, { orderId: order.orderId, cardName: order.cardName, carrierName: 'GHN', trackingNumber: 'TRACK', trackingUrl: null }]],
    ['sendKYCSubmittedToAdmin', ['Buyer', email, admins]],
    ['sendKycManualReviewToAdmin', [{ fullName: 'Buyer', userEmail: email, providerSessionId: 'session', warnings: [], adminEmails: admins }]],
    ['sendOfferPaymentReminder', [{ to: email, cardName: order.cardName, offerId: 'offer-id', price: order.amount, deadline: null }]],
    ['sendWithdrawalSubmittedToAdmin', [{ sellerName: 'Seller', sellerEmail: email, amountRequested: 100000, fee: 0, amountNet: 100000, bankName: 'Bank', bankAccountNumber: '123', adminEmails: admins }]],
    ['sendKYCApproved', [email, 'Buyer']],
    ['sendKYCRejected', [email, 'Buyer', 'Reason']],
    ['sendOrderPlacedToBuyer', [email, order]],
    ['sendOrderPlacedToSeller', [email, order]],
    ['sendContactSubmissionConfirmation', [email, contact, 'vi-VN']],
    ['sendContactSubmittedToAdmin', [contact, admins]],
    ...['vi-VN', 'en-US', 'ja-JP'].flatMap(locale => [
      ['sendOfferReceivedEmail', [email, offer, locale]], ['sendOfferAcceptedEmail', [email, offer, locale]],
    ]),
  ];
  assert.equal(new Set(cases.map(([name]) => name)).size, 15);
  const adminFanOuts = new Set(['sendKYCSubmittedToAdmin', 'sendKycManualReviewToAdmin', 'sendWithdrawalSubmittedToAdmin', 'sendContactSubmittedToAdmin']);
  for (const [name, args] of cases) {
    const before = h.sent.length;
    await mail[name](...args);
    assert.equal(h.sent.length, before + 1, name);
    const message = h.sent.at(-1);
    assertBranded(message);
    assert.equal(message.reply_to, replyTo, name);
    if (adminFanOuts.has(name)) {
      // Admin alerts address the team directly: "to self + bcc" reads as spam.
      assert.deepEqual(message.to, admins, name);
      assert.equal(message.bcc, undefined, name);
      assert.doesNotMatch(message.subject, /^[^\p{L}\p{N}]/u, name);
    }
  }
});

test('Forum handler sends each event through Resend with the branded template', async () => {
  const h = harness();
  const updates = [];
  const notifications = ['post_like', 'comment', 'comment_reply'].map((type, id) => ({ id, type, user_id: 'buyer', actor_id: 'actor', post_id: 'post' }));
  const supabase = { from(table) {
    let user;
    const query = {
      select() { return query; }, eq(key, value) { if (key === 'id') user = value; return query; },
      order() { return query; }, limit() { return Promise.resolve({ data: notifications }); },
      single() { return Promise.resolve({ data: table === 'profiles' ? { email: 'buyer@example.test', display_name: user } : { content: 'A post' } }); },
      update(value) { updates.push(value); return query; },
    };
    return query;
  } };
  h.load('supabase/functions/send-forum-notification/index.ts', {
    'https://esm.sh/@supabase/supabase-js@2.39.3': { createClient: () => supabase },
  });
  const response = await h.cache.get('handler')(new Request('https://example.test'));
  assert.equal(response.status, 200);
  assert.equal(h.sent.length, 3);
  assert.equal(updates.length, 3);
  for (const message of h.sent) {
    assertBranded(message);
    assert.ok(message.html.includes('https://cardversehub.com/forum?post='));
    assert.doesNotMatch(message.html, /CardVerse\b|cardverse\.app/);
  }
});
