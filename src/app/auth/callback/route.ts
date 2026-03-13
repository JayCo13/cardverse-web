import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
    const requestUrl = new URL(request.url)
    const code = requestUrl.searchParams.get('code')
    const type = requestUrl.searchParams.get('type')

    if (code) {
        try {
            const supabase = await createServerSupabaseClient()
            const { error } = await supabase.auth.exchangeCodeForSession(code)
            if (error) {
                console.error('Auth callback: Failed to exchange code for session:', error.message)
            }
        } catch (err) {
            console.error('Auth callback: Exception during code exchange:', err)
        }
    }

    // Determine base URL (no query params to prevent redirect loops)
    const baseUrl = process.env.NODE_ENV === 'production'
        ? 'https://cardversehub.com'
        : requestUrl.origin

    // Handle password recovery redirect
    if (type === 'recovery') {
        return NextResponse.redirect(`${baseUrl}/update-password`)
    }

    // Redirect to home — MUST be a clean URL with no ?code= to avoid middleware loop
    return NextResponse.redirect(baseUrl + '/')
}
