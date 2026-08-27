import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'


/**
 * How long a tester verdict is trusted before the database is asked again.
 *
 * Short enough that granting or revoking beta access takes effect while the
 * admin is still looking at the screen, long enough that a browsing session
 * costs one query rather than one per page.
 */
const TESTER_CACHE_SECONDS = 300;

const TESTER_COOKIE = 'cv_beta';

/**
 * Signed so the cookie cannot simply be typed by hand. This is a soft gate, not
 * an authorisation boundary — but a curtain anyone can pull aside is not worth
 * the code that draws it.
 *
 * Falls back to no caching when no secret is configured, which costs latency
 * rather than correctness.
 */
function cacheSecret() {
    return process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

async function sign(payload: string) {
    const secret = cacheSecret();
    if (!secret) return null;
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    return Buffer.from(new Uint8Array(mac)).toString('base64url');
}

/** null when there is no usable verdict and the database must be asked. */
async function readTesterVerdict(request: NextRequest, userId: string): Promise<boolean | null> {
    const raw = request.cookies.get(TESTER_COOKIE)?.value;
    if (!raw) return null;

    const [verdict, expiry, signature] = raw.split('.');
    if (!verdict || !expiry || !signature) return null;
    if (verdict !== '1' && verdict !== '0') return null;

    const expiresAt = Number(expiry);
    if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) return null;

    // The user id is signed but never stored, so a cookie cannot be carried from
    // one account to another.
    const expected = await sign(`${userId}.${verdict}.${expiry}`);
    if (!expected || expected !== signature) return null;

    return verdict === '1';
}

async function writeTesterVerdict(response: NextResponse, userId: string, isTester: boolean) {
    const verdict = isTester ? '1' : '0';
    const expiry = Math.floor(Date.now() / 1000) + TESTER_CACHE_SECONDS;
    const signature = await sign(`${userId}.${verdict}.${expiry}`);
    if (!signature) return;

    response.cookies.set({
        name: TESTER_COOKIE,
        value: `${verdict}.${expiry}.${signature}`,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: TESTER_CACHE_SECONDS,
    });
}

export async function middleware(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    // Note: OAuth ?code= handling is done by /auth/callback route directly.
    // The auth provider sets redirectTo to /auth/callback, so no middleware interception is needed.

    const currentPath = request.nextUrl.pathname;

    const betaRedirect = () => {
        // Redirect to home page with a query parameter to show the "Coming Soon" toast
        const url = request.nextUrl.clone();
        url.pathname = '/';
        url.search = '?beta=true';
        return NextResponse.redirect(url);
    };

    const matchesAny = (paths: string[]) =>
        paths.some(path => currentPath === path || currentPath.startsWith(`${path}/`));

    // Always "Coming Soon" for everyone (feature not built yet).
    const comingSoonPaths = ['/forum'];
    if (matchesAny(comingSoonPaths)) {
        return betaRedirect();
    }

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value),
                    )
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options),
                    )
                },
            },
        }
    )

    // Beta marketplace features: only admin-created tester accounts may enter.
    // Normal users (and signed-out visitors) are redirected to the "Coming Soon" toast.
    //
    // This gate used to cost two sequential round trips on EVERY request to these
    // paths — getUser() over the network plus a profiles read — and Next fires it
    // again for every link prefetch. These are exactly the pages that felt slow to
    // open. It now reads the session from the cookie (local, no network) and
    // remembers the tester verdict in a short-lived signed cookie, so the database
    // is asked once per window instead of once per navigation.
    //
    // Reading the session without verifying the JWT is acceptable *here*: this is a
    // beta curtain over the UI, not the security boundary. Row-level security still
    // governs every byte of data, and route handlers that need a verified identity
    // call getUser() themselves.
    const testerOnlyPaths = ['/buy', '/sell', '/bid', '/razz', '/orders', '/wallet'];
    if (matchesAny(testerOnlyPaths)) {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) {
            return betaRedirect();
        }

        const cached = await readTesterVerdict(request, user.id);
        if (cached === false) return betaRedirect();
        if (cached === true) return supabaseResponse;

        const { data: profile } = await supabase
            .from('profiles')
            .select('is_tester')
            .eq('id', user.id)
            .single();

        const isTester = !!profile?.is_tester;
        // Remember the answer either way. Caching only the allow would leave every
        // blocked visitor paying for the query on each redirect.
        const response = isTester ? supabaseResponse : betaRedirect();
        await writeTesterVerdict(response, user.id, isTester);
        return response;
    }

    // Refresh the auth token on every request to keep the session alive.
    // Using getSession() instead of getUser() for performance:
    // - getSession() reads from local cookie (~0ms)
    // - getUser() makes a network call to Supabase (~200-500ms)
    // Protected routes should call getUser() themselves if JWT verification is needed.
    await supabase.auth.getSession()

    return supabaseResponse
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - Public assets (images, etc.)
         */
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
    ],
}
