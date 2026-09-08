import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AccountStatus = { user_id: string; is_banned: boolean; reason: string | null; banned_at: string | null; version: number };

// The same guard is used after verified getUser and getClaims authentication.
export async function guardAccount(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from('account_restrictions')
    .select('is_banned').eq('user_id', userId).maybeSingle();
  if (error) return NextResponse.json({ code: 'account_status_unavailable' }, { status: 503 });
  if (data?.is_banned) return NextResponse.json({ code: 'account_banned', error: 'Account restricted' }, { status: 403 });
  return null;
}
