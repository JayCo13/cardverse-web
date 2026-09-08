import type { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { guardAccount } from '@/lib/account-restriction';

export function accountRoute<A extends unknown[], R>(handler: (request: NextRequest, ...args: A) => Promise<R>) {
  return async (request: NextRequest, ...args: A) => {
    const client = await createServerSupabaseClient();
    const { data: { user } } = await client.auth.getUser();
    if (user) {
      const denied = await guardAccount(client, user.id);
      if (denied) return denied;
    }
    return handler(request, ...args);
  };
}
