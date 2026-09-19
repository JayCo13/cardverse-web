/** Only local UI destinations may be used after authentication. */
export function safeAuthReturnTo(value?: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const decoded = decodeURIComponent(value);
    if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//')) return '/';
    const url = new URL(value, 'https://auth-return.invalid');
    const path = decodeURIComponent(url.pathname);
    if (url.origin !== 'https://auth-return.invalid' || /^\/(api|auth)(\/|$)/i.test(path)) return '/';
    // Never replay authentication parameters on a destination page.
    for (const key of ['code', 'auth_error', 'access_token', 'refresh_token']) {
      if (url.searchParams.has(key)) url.searchParams.delete(key);
    }
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}

export function authCallbackUrl(origin: string, returnTo?: string): string {
  const url = new URL('/auth/callback', origin);
  url.searchParams.set('next', safeAuthReturnTo(returnTo));
  return url.toString();
}

export function requiresPageAuth(path: string): boolean {
  if (path === '/sell/kyc/callback') return false;
  return /^\/(cart|checkout|orders|offers|wallet|sell|profile|collection|transaction)(\/|$)/.test(path)
    || /^\/cards\/[^/]+\/connect\/[^/]+\/?$/.test(path);
}
