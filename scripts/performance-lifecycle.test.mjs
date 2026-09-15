import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function load(path, dependencies = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, Date, ...globals, require(name) {
    assert.ok(name in dependencies, `Unmocked ${name}`);
    return dependencies[name];
  } });
  return exports;
}
function cacheHarness() {
  const requests = [];
  const cache = load('src/lib/account-summary.ts', {}, { fetch: () => new Promise(resolve => requests.push(resolve)) });
  return { cache, requests, finish(index, count) { requests[index]({ ok: true, json: async () => ({ cartCount: count }) }); } };
}
test('account change rejects the previous response and shares the new account read', async () => {
  const h = cacheHarness();
  const old = h.cache.getAccountSummary('a');
  const current = h.cache.getAccountSummary('b');
  const duplicate = h.cache.getAccountSummary('b');
  h.finish(0, 9); h.finish(1, 2);
  assert.equal(await old, null);
  assert.equal((await current).cartCount, 2);
  assert.equal((await duplicate).cartCount, 2);
  assert.equal((await h.cache.getAccountSummary('b')).cartCount, 2);
  assert.equal(h.requests.length, 2);
});
test('sign-out reset prevents a late response from repopulating cache', async () => {
  const h = cacheHarness();
  const old = h.cache.getAccountSummary('a');
  h.cache.resetAccountSummary(); h.finish(0, 9);
  assert.equal(await old, null);
  const next = h.cache.getAccountSummary('a'); h.finish(1, 3);
  assert.equal((await next).cartCount, 3);
});
test('mutation invalidation rejects old data even when it finishes last', async () => {
  const h = cacheHarness();
  const old = h.cache.getAccountSummary('a');
  h.cache.invalidateAccountSummary();
  const next = h.cache.getAccountSummary('a'); h.finish(1, 4);
  assert.equal((await next).cartCount, 4);
  h.finish(0, 9); assert.equal(await old, null);
  assert.equal((await h.cache.getAccountSummary('a')).cartCount, 4);
});
for (const mode of ['allowed', 'banned', 'unavailable', 'anonymous']) {
  test(`request-scoped identity preserves ${mode} account protection`, async () => {
    let auth = 0, handled = 0;
    const restrictions = { select() { return this; }, eq() { return this; }, async maybeSingle() {
      return { data: { is_banned: mode === 'banned' }, error: mode === 'unavailable' ? {} : null };
    } };
    const client = { auth: { async getUser() { auth++; return { data: { user: mode === 'anonymous' ? null : { id: 'a' } }, error: null }; } }, from: () => restrictions };
    const guard = load('src/lib/account-restriction.ts', { 'next/server': { NextResponse: { json: (body, init) => ({ body, ...init }) } } });
    const routeUser = { getRouteUser: async supabase => { const { data: { user } } = await supabase.auth.getUser(); return user ? { id: user.id, email: null } : null; } };
    const route = load('src/lib/account-route.ts', { '@/lib/supabase/server': { createServerSupabaseClient: async () => client }, '@/lib/account-restriction': guard, '@/lib/supabase/route-user': routeUser });
    const handler = route.accountRoute(async request => { handled++; const context = await route.getAccountRouteContext(request); return { status: context.user ? 200 : 401 }; });
    const first = await handler({});
    assert.equal(auth, 1);
    assert.equal(first.status, { allowed: 200, banned: 403, unavailable: 503, anonymous: 401 }[mode]);
    assert.equal(handled, mode === 'allowed' || mode === 'anonymous' ? 1 : 0);
    await handler({}); assert.equal(auth, 2);
  });
}
