import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const sender = 'CardVerseHub <cardversehubsupport@gmail.com>';
const logo = 'https://cardversehub.com/assets/logo-verse.png';

// Execute real mail builders and transport without secrets or network access.
function harness(overrides = {}) {
  const env = { SMTP_USER: 'cardversehubsupport@gmail.com', SMTP_PASSWORD: 'test-password',
    RESEND_API_KEY: 'stale-key', RESEND_FROM_EMAIL: 'CardVerse <noreply@cardversehub.com>',
    SMTP_FROM_EMAIL: 'CardVerse <broken@gmail.com@gmail.com>', NEXT_PUBLIC_APP_URL: 'http://localhost:3000', ...overrides };
  const sent = [];
  const configs = [];
  const nodemailer = { createTransport(config) {
    configs.push(config);
    return { async sendMail(message) { sent.push(message); return { messageId: 'test' }; } };
  } };
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
      console, Response, Date, setTimeout: (fn) => fn(),
      Deno: { env: { get: (key) => env[key] }, serve: (handler) => { cache.set('handler', handler); } },
      require(name) {
        if (name in mocks) return mocks[name];
        if (name === 'nodemailer' || name.startsWith('npm:nodemailer@')) return nodemailer;
        if (name.startsWith('.')) return load(new URL(name.endsWith('.ts') ? name : `${name}.ts`, url).href);
        throw new Error(`Unexpected dependency: ${name}`);
      },
    }, { filename });
    cache.set(filename, mod.exports);
    return mod.exports;
  }
  return { env, sent, configs, load, cache };
}

const transportPath = 'src/lib/mail-transport.ts';

test('legacy Resend/from settings and caller From cannot override Gmail identity; BCC stays private', async () => {
  const h = harness();
  const mail = h.load(transportPath);
  assert.equal(mail.getFromAddress(), sender);
  const transport = mail.createMailTransporter();
  await transport.sendMail({ from: 'CardVerse <noreply@cardversehub.com>', bcc: ['one@example.test', 'two@example.test'], subject: 'Reminder', html: 'test' });
  assert.equal(h.sent[0].from, sender);
  assert.equal(h.sent[0].to, undefined);
  assert.deepEqual(h.sent[0].bcc, ['one@example.test', 'two@example.test']);
  assert.equal(h.configs[0].host, 'smtp.gmail.com');
  assert.equal(h.configs[0].auth.user, 'cardversehubsupport@gmail.com');
  assert.equal(h.configs[0].requireTLS, true);
  assert.equal(await transport.sendMail({ from: sender, to: ' ', subject: 'Empty', html: '' }), null);
  assert.equal(h.sent.length, 1);
});

test('missing credentials, malformed/wrong account and non-Gmail SMTP fail without provider fallback', () => {
  for (const overrides of [
    { SMTP_USER: undefined }, { SMTP_USER: 'noreply@cardversehub.com' },
    { SMTP_USER: 'cardversehubsupport@gmail.com@gmail.com' }, { SMTP_PASSWORD: '' },
    { SMTP_HOST: 'other.example.test' }, { SMTP_PORT: '587garbage' },
  ]) {
    const h = harness(overrides);
    assert.throws(() => h.load(transportPath).createMailTransporter(), /Configure|requires/);
    assert.equal(h.configs.length, 0);
  }
  const h = harness({ SMTP_PORT: '465' });
  h.load(transportPath).createMailTransporter();
  assert.equal(h.configs[0].secure, true);
});

function assertBranded(message) {
  assert.equal(message.from, sender);
  assert.ok(message.html.includes(`src="${logo}"`));
  assert.ok(message.html.includes('alt="CardVerseHub"'));
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
    ['sendOrderShippedEmail', [email, { cardName: order.cardName, carrierName: 'GHN', trackingNumber: 'TRACK', trackingUrl: null }]],
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
  for (const [name, args] of cases) {
    const before = h.sent.length;
    await mail[name](...args);
    assert.equal(h.sent.length, before + 1, name);
    assertBranded(h.sent.at(-1));
  }
});

test('Forum handler sends each event through the same Gmail identity and branded template', async () => {
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
