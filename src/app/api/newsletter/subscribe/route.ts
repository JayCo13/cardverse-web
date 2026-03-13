import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize a Supabase admin client with the service role key
// We use the service role key here to bypass RLS. We didn't enable
// public INSERTs on the newsletter_subscribers table to prevent spam.
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dummy.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key',
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

// Basic email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { email } = body;

        // Basic validation
        if (!email || typeof email !== 'string') {
            return NextResponse.json(
                { error: 'Email is required' },
                { status: 400 }
            );
        }

        const trimmedEmail = email.trim().toLowerCase();

        if (!EMAIL_REGEX.test(trimmedEmail)) {
            return NextResponse.json(
                { error: 'Invalid email format' },
                { status: 400 }
            );
        }

        // Insert into database using admin client
        const { error } = await supabaseAdmin
            .from('newsletter_subscribers')
            .insert([{ email: trimmedEmail }]);

        if (error) {
            // Check for unique constraint violation (code 23505)
            // If the user is already subscribed, we just return a success message
            if (error.code === '23505') {
                return NextResponse.json(
                    { message: 'Already subscribed' },
                    { status: 200 }
                );
            }

            console.error('Error inserting newsletter subscriber:', error);
            return NextResponse.json(
                { error: 'Failed to subscribe' },
                { status: 500 }
            );
        }

        return NextResponse.json(
            { message: 'Successfully subscribed' },
            { status: 201 }
        );

    } catch (error) {
        console.error('Newsletter subscription error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
