import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    // If the user lands on the root with a ?code= param (from email OTP/OAuth),
    // redirect to /auth/callback to properly exchange the code for a session
    const code = request.nextUrl.searchParams.get('code')
    if (code && request.nextUrl.pathname === '/') {
        const callbackUrl = request.nextUrl.clone()
        callbackUrl.pathname = '/auth/callback'
        callbackUrl.searchParams.set('code', code)
        return NextResponse.redirect(callbackUrl)
    }

    // Phase 1 Beta Restrictions: Block access to upcoming features
    const restrictedPaths = ['/buy', '/sell', '/bid', '/razz', '/forum'];
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

    // IMPORTANT: Do NOT run code between createServerClient and supabase.auth.getUser().
    // A simple mistake could make it very hard to debug issues with users being
    // randomly logged out.

    // Refresh the auth token on every request to keep the session alive
    await supabase.auth.getUser()

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
