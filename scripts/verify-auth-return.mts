import assert from 'node:assert/strict';
import { authCallbackUrl, requiresPageAuth, safeAuthReturnTo } from '../src/lib/auth-return.ts';

for (const path of ['/buy?search=One%20Piece#results', '/cards/123', '/offers?view=received&cardId=123', '/checkout?items=a%2Cb']) {
  assert.equal(safeAuthReturnTo(path), path);
  const callback = new URL(authCallbackUrl('https://preview.example.com', path));
  assert.equal(callback.origin, 'https://preview.example.com');
  assert.equal(callback.pathname, '/auth/callback');
  assert.equal(callback.searchParams.get('next'), path);
}
for (const path of [undefined, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/%2fevil.example', '/%5cevil.example', '/api/pay', '/auth/callback?code=x', '/%61uth/callback', '/foo/../auth/callback', '/bad%0apath', '/%']) {
  assert.equal(safeAuthReturnTo(path), '/');
}
assert.equal(safeAuthReturnTo('/buy?code=secret&category=pokemon&auth_error=callback'), '/buy?category=pokemon');
for (const path of ['/cart', '/checkout', '/orders/123', '/offers', '/wallet', '/sell/create', '/sell/edit/123', '/profile/edit', '/collection/123', '/transaction/123', '/cards/123/connect/456']) {
  assert.equal(requiresPageAuth(path), true, path);
}
for (const path of ['/', '/buy', '/cards/123', '/products/123', '/users/123', '/pricing', '/forum', '/bid/123', '/razz', '/sell/kyc/callback', '/reset-password', '/update-password']) {
  assert.equal(requiresPageAuth(path), false, path);
}
console.log('Auth return URL and page access checks passed.');
