import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function GET() {
  const client = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  const headers = { 'Cache-Control': 'private, no-store' };
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const { data, error } = await client.from('account_restrictions' as never)
    .select('user_id,is_banned,reason,banned_at,version').eq('user_id', user.id).maybeSingle();
  if (error) return NextResponse.json({ code: 'account_status_unavailable' }, { status: 503, headers });
  return NextResponse.json(data || { user_id: user.id, is_banned: false, reason: null, banned_at: null, version: 0 }, { headers });
}
