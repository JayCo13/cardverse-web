import { createServerSupabaseClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
    const requestUrl = new URL(request.url)
    const code = requestUrl.searchParams.get('code')
    const type = requestUrl.searchParams.get('type')

    if (code) {
        const supabase = await createServerSupabaseClient()
        await supabase.auth.exchangeCodeForSession(code)
    }

    // Handle password recovery redirect
    if (type === 'recovery') {
        const redirectUrl = process.env.NODE_ENV === 'production'
            ? 'https://cardversehub.com/update-password'
            : requestUrl.origin + '/update-password'
        return NextResponse.redirect(redirectUrl)
    }

    // Redirect to production domain after sign in
    const redirectUrl = process.env.NODE_ENV === 'production'
        ? 'https://cardversehub.com/'
        : requestUrl.origin + '/'

    return NextResponse.redirect(redirectUrl)
}
