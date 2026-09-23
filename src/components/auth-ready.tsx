"use client";

import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/supabase';

/**
 * Routes whose content does not depend on who is looking.
 *
 * Everything here renders while auth is still resolving. A signed-in visitor
 * reopening the app has an expired access token, and resolving it means a
 * network refresh against Supabase — holding the catalogue behind a spinner for
 * that round trip is the single most visible delay on the site, and it buys
 * these pages nothing.
 *
 * The header reads `user` itself and simply renders signed-out until it fills
 * in, which is the normal behaviour of every marketplace.
 */
const PUBLIC_PREFIXES = [
    '/cards', '/products', '/pokemon', '/onepiece', '/soccer',
    '/sold', '/pricing', '/help', '/about', '/terms', '/privacy', '/complaints', '/contact', '/users',
    // Not public, but not worth gating either: middleware has already turned
    // away anyone who is not a signed-in tester, and the listings do not depend
    // on who is looking. Gating it only hid a server-rendered catalogue behind
    // a spinner while the client re-confirmed something already established.
    '/buy',
];

function isPublicRoute(pathname: string | null) {
    if (!pathname) return false;
    if (pathname === '/') return true;
    return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * AuthReady gate — prevents downstream components from mounting until auth
 * state is resolved, on the routes whose content depends on it.
 *
 * This eliminates the "overloading" cascade:
 * - Without gate: components mount → hooks fire with user=null → auth resolves → 
 *   hooks re-fire with user → queries + channels tear down and recreate → OVERLOAD
 * - With gate: auth resolves → components mount ONCE with correct user → 
 *   hooks fire ONCE → clean load
 *
 * That cascade is only worth a full-screen wait where the page actually queries
 * per-user data. On public routes the gate was pure latency.
 */
export function AuthReady({ children }: { children: React.ReactNode }) {
    const { isLoading } = useAuth();
    const pathname = usePathname();

    if (isLoading && !isPublicRoute(pathname)) {
        return <div className="w-full flex-1 space-y-5 p-6" aria-busy="true">
            <div className="h-9 w-48 animate-pulse rounded bg-white/10" />
            <div className="h-20 animate-pulse rounded-xl bg-white/5" />
            <div className="h-64 animate-pulse rounded-xl bg-white/5" />
        </div>;
    }

    return <>{children}</>;
}
