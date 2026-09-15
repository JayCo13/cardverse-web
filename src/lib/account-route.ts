import type { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { guardAccount } from '@/lib/account-restriction';
import { getRouteUser } from '@/lib/supabase/route-user';

// Identity comes from the JWT via getRouteUser(): verified locally once the
// project signs tokens with an asymmetric key, and identical to getUser()
// (one auth round trip) until then. Routes only ever read `id` and `email`.
async function resolveAccount(request: NextRequest) {
  void request;
  const supabase = await createServerSupabaseClient();
  const user = await getRouteUser(supabase);
  return { supabase, user, authError: user ? null : new Error('Unauthorized') };
}

// Identity is shared only within this request, never between users or requests.
const accounts = new WeakMap<NextRequest, ReturnType<typeof resolveAccount>>();
export function getAccountRouteContext(request: NextRequest) {
  let pending = accounts.get(request);
  if (!pending) {
    pending = resolveAccount(request);
    accounts.set(request, pending);
  }
  return pending;
}

export function accountRoute<A extends unknown[], R>(handler: (request: NextRequest, ...args: A) => Promise<R>) {
  return async (request: NextRequest, ...args: A) => {
    const { supabase, user } = await getAccountRouteContext(request);
    if (user) {
      const denied = await guardAccount(supabase, user.id);
      if (denied) return denied;
    }
    return handler(request, ...args);
  };
}
