import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { safeAuthReturnTo } from '@/lib/auth-return'

export async function GET(request: Request) {
    const requestUrl = new URL(request.url)
    const code = requestUrl.searchParams.get('code')
    const type = requestUrl.searchParams.get('type')
    let authenticated = false

    if (code) {
        try {
            const supabase = await createServerSupabaseClient()
            const { error } = await supabase.auth.exchangeCodeForSession(code)
            authenticated = !error
            if (error) {
                console.error('Auth callback: Failed to exchange code for session:', error.message)
            }
        } catch (err) {
            console.error('Auth callback: Exception during code exchange:', err)
        }
    }

    // Next's server URL may use localhost internally even when the browser
    // requested 127.0.0.1. Keep the incoming host so session cookies stay on
    // the same origin; never derive the origin from the `next` parameter.
    const host = request.headers.get('host')
    let baseUrl = requestUrl.origin
    if (host && /^[a-z0-9.\-\[\]:]+$/i.test(host)) {
        baseUrl = new URL(`${requestUrl.protocol}//${host}`).origin
    }

    // Handle password recovery redirect
    if (type === 'recovery' && authenticated) {
        return NextResponse.redirect(`${baseUrl}/update-password`)
    }

    const destination = new URL(safeAuthReturnTo(requestUrl.searchParams.get('next')), baseUrl)
    if (!authenticated) destination.searchParams.set('auth_error', 'callback')
    return NextResponse.redirect(destination)
}
