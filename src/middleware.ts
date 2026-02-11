import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
    const { pathname, searchParams } = request.nextUrl

    // If an auth code lands on any page OTHER than /auth/callback,
    // redirect it to the server-side callback handler.
    // This prevents the client-side Supabase SDK from auto-processing
    // the PKCE code on the homepage, which causes cascading re-renders.
    if (searchParams.has('code') && pathname !== '/auth/callback') {
        const callbackUrl = request.nextUrl.clone()
        callbackUrl.pathname = '/auth/callback'
        // Preserve code and type params, strip everything else
        const code = searchParams.get('code')!
        const type = searchParams.get('type')
        callbackUrl.search = ''
        callbackUrl.searchParams.set('code', code)
        if (type) callbackUrl.searchParams.set('type', type)
        return NextResponse.redirect(callbackUrl)
    }

    let supabaseResponse = NextResponse.next({
        request,
    })

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
