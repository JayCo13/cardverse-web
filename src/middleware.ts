import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    // Note: OAuth ?code= handling is done by /auth/callback route directly.
    // The auth provider sets redirectTo to /auth/callback, so no middleware interception is needed.

    // Phase 1 Beta Restrictions: Block access to upcoming features
    const restrictedPaths = ['/bid', '/razz', '/forum'];
    const currentPath = request.nextUrl.pathname;

    // Check if the current path exactly matches or starts with the restricted path (e.g. /sell/create)
    const isRestricted = restrictedPaths.some(path => currentPath === path || currentPath.startsWith(`${path}/`));

    if (isRestricted) {
        // Redirect to home page with a query parameter to show the "Coming Soon" toast
        const url = request.nextUrl.clone();
        url.pathname = '/';
        url.search = '?beta=true';
        return NextResponse.redirect(url);
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
