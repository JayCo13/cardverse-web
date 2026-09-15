import type { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { guardAccount } from '@/lib/account-restriction';

async function resolveAccount(request: NextRequest) {
  void request;
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  return { supabase, user: authError ? null : user, authError };
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
