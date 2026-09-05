import type { SupabaseClient } from '@supabase/supabase-js';

type MinimalUser = { id: string; email?: string | null };

/**
 * Resolve the caller of an API route.
 *
 * `auth.getUser()` is a network call from the serverless function to Supabase's
 * auth server on every single request. Thirty-two route handlers open with it,
 * and on the production path — Vietnam to Netlify in the US to Supabase — it is
 * a measured 200-350ms spent before the route has looked at any data.
 *
 * `getClaims()` is the same check done from the JWT itself, verified against a
 * cached JWKS, with no round trip. It only works when the project signs tokens
 * with an asymmetric key (ECC/RSA); on a project still using the legacy shared
 * HS256 secret the library falls back to asking the auth server, which is
 * exactly what we do today.
 *
 * So this is written to be correct either way and to get faster on its own the
 * day the project's JWT signing key is rotated to ECC in the Supabase dashboard
 * (Authentication -> JWT Keys). Until then it behaves like `getUser()`.
 *
 * The verdict is not cached anywhere: a route must never trust an identity it
 * did not establish for this request.
 */
export async function getRouteUser(
    supabase: SupabaseClient<any, any, any>,
): Promise<MinimalUser | null> {
    try {
        const { data, error } = await supabase.auth.getClaims();
        if (error || !data?.claims) return null;
        const claims = data.claims as { sub?: string; email?: string };
        if (!claims.sub) return null;
        return { id: claims.sub, email: claims.email ?? null };
    } catch {
        return null;
    }
}
