import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
    const requestUrl = new URL(request.url)
    const code = requestUrl.searchParams.get('code')

    if (code) {
        const supabase = await createServerSupabaseClient()
        await supabase.auth.exchangeCodeForSession(code)
    }

    // Redirect to production domain after sign in
    const redirectUrl = process.env.NODE_ENV === 'production'
        ? 'https://cardversehub.com/'
        : requestUrl.origin + '/'

    return NextResponse.redirect(redirectUrl)
}
