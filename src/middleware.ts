import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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
    const testerOnlyPaths = ['/buy', '/sell', '/bid', '/razz', '/orders', '/wallet'];
    if (matchesAny(testerOnlyPaths)) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return betaRedirect();
        }
        const { data: profile } = await supabase
            .from('profiles')
            .select('is_tester')
            .eq('id', user.id)
            .single();
        if (!profile?.is_tester) {
            return betaRedirect();
        }
        // Tester verified — allow through (session already refreshed by getUser()).
        return supabaseResponse;
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
