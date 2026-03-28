"use client";

import { useAuth } from '@/lib/supabase';

/**
 * AuthReady gate — prevents ALL downstream components from mounting
 * until auth state is fully resolved (user + profile loaded).
 * 
 * This eliminates the "overloading" cascade:
 * - Without gate: components mount → hooks fire with user=null → auth resolves → 
 *   hooks re-fire with user → queries + channels tear down and recreate → OVERLOAD
 * - With gate: auth resolves → components mount ONCE with correct user → 
 *   hooks fire ONCE → clean load
 */
export function AuthReady({ children }: { children: React.ReactNode }) {
    const { isLoading } = useAuth();

    if (isLoading) {
        // Minimal dark screen — matches site background, no hydration issues
        return (
            <div
                style={{
                    minHeight: '100vh',
                    background: '#050505',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <div
                    style={{
                        width: 32,
                        height: 32,
                        border: '3px solid rgba(249,115,22,0.15)',
                        borderTopColor: '#f97316',
                        borderRadius: '50%',
                        animation: 'spin 0.7s linear infinite',
                    }}
                />
                <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
        );
    }

    return <>{children}</>;
}
