"use client";

import { createContext, createElement, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/supabase';

interface Subscription {
    id: string;
    package_type: 'day_pass' | 'credit_pack' | 'vip_pro';
    status: string;
    starts_at: string;
    expires_at: string | null;
    scan_credits_remaining: number | null;
}

interface UseSubscriptionReturn {
    subscription: Subscription | null;
    isVipPro: boolean;
    isDayPass: boolean;
    hasCredits: boolean;
    creditsRemaining: number;
    scanType: 'free' | 'day_pass' | 'credit' | 'unlimited';
    portfolioLimit: number;
    isLoading: boolean;
    justActivated: boolean;
    refresh: () => Promise<void>;
}

function useSubscriptionState(): UseSubscriptionReturn {
    const { user } = useUser();
    const [snapshot, setSnapshot] = useState<{ userId: string | null; subscription: Subscription | null }>({ userId: null, subscription: null });
    const [isLoading, setIsLoading] = useState(true);
    const [justActivated, setJustActivated] = useState(false);

    const mountedRef = useRef(true);
    const activeUserRef = useRef<string | null>(null);
    const requestVersion = useRef(0);
    const activationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // Stable user ID string — avoids object identity issues
    const userId = user?.id ?? null;
    const subscription = snapshot.userId === userId ? snapshot.subscription : null;

    // Fetch subscription — stable reference, uses userId ref internally
    const doFetch = useCallback(async (uid: string, showLoading: boolean) => {
        const version = ++requestVersion.current;
        if (showLoading) setIsLoading(true);

        try {
            const supabase = getSupabaseClient();
            const now = new Date().toISOString();

            const { data, error } = await supabase
                .from('user_subscriptions')
                .select('id, package_type, status, starts_at, expires_at, scan_credits_remaining, created_at')
                .eq('user_id', uid).eq('status', 'active')
                .or(`and(package_type.in.(vip_pro,day_pass),expires_at.gte.${now}),and(package_type.eq.credit_pack,scan_credits_remaining.gt.0)`)
                .order('expires_at', { ascending: false, nullsFirst: false })
                .order('created_at', { ascending: false });
            if (error) throw error;
            const rows = (data || []) as (Subscription & { created_at: string })[];
            const credits = rows.filter(row => row.package_type === 'credit_pack')
                .sort((a, b) => b.created_at.localeCompare(a.created_at));
            const selected = rows.find(row => row.package_type === 'vip_pro')
                || rows.find(row => row.package_type === 'day_pass') || credits[0] || null;
            if (mountedRef.current && activeUserRef.current === uid && version === requestVersion.current) {
                setSnapshot({ userId: uid, subscription: selected });
                setIsLoading(false);
            }
        } catch (err) {
            console.error('Error fetching subscription:', err);
            if (mountedRef.current && activeUserRef.current === uid && version === requestVersion.current) {
                setSnapshot({ userId: uid, subscription: null });
                setIsLoading(false);
            }
        }
    }, []);

    // Public refresh function
    const refresh = useCallback(async () => {
        if (userId) await doFetch(userId, false);
    }, [userId, doFetch]);

    // Main effect — ONLY depends on userId (string)
    useEffect(() => {
        mountedRef.current = true;
        activeUserRef.current = userId;
        setJustActivated(false);

        if (!userId) {
            setSnapshot({ userId: null, subscription: null });
            setIsLoading(false);

            return;
        }

        // Show loading only on first fetch
        doFetch(userId, true);

        // Realtime subscription for changes
        const supabase = getSupabaseClient();
        const channel = supabase
            .channel(`user_sub_${userId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'user_subscriptions',
                    filter: `user_id=eq.${userId}`,
                },
                () => {
                    if (!mountedRef.current) return;
                    // Re-fetch silently (no loading spinner)
                    doFetch(userId, false).then(() => {
                        if (mountedRef.current && activeUserRef.current === userId) {
                            setJustActivated(true);
                            clearTimeout(activationTimer.current);
                            activationTimer.current = setTimeout(() => setJustActivated(false), 5000);
                        }
                    });
                }
            )
            .subscribe();

        return () => {
            mountedRef.current = false;
            requestVersion.current++;
            clearTimeout(activationTimer.current);
            supabase.removeChannel(channel);
        };
    // ONLY depend on userId (string) — not user object or fetchSubscription
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    useEffect(() => {
        if (!userId) return;
        const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
        document.addEventListener('visibilitychange', onFocus);
        const expiresAt = subscription?.expires_at ? Date.parse(subscription.expires_at) : NaN;
        const remaining = expiresAt - Date.now();
        const timer = Number.isFinite(remaining) && remaining >= 0
            ? setTimeout(() => void refresh(), Math.min(remaining + 100, 2147483647)) : undefined;
        return () => {
            document.removeEventListener('visibilitychange', onFocus);
            clearTimeout(timer);
        };
    }, [userId, subscription?.expires_at, refresh]);

    const isVipPro = subscription?.package_type === 'vip_pro';
    const isDayPass = subscription?.package_type === 'day_pass';
    const hasCredits = subscription?.package_type === 'credit_pack' && (subscription?.scan_credits_remaining ?? 0) > 0;
    const creditsRemaining = subscription?.scan_credits_remaining ?? 0;

    const scanType: 'free' | 'day_pass' | 'credit' | 'unlimited' = isVipPro
        ? 'unlimited'
        : isDayPass
            ? 'day_pass'
            : hasCredits
                ? 'credit'
                : 'free';

    const portfolioLimit = isVipPro
        ? -1
        : hasCredits
            ? 200
            : isDayPass
                ? 100
                : 20;

    return useMemo(() => ({
        subscription,
        isVipPro,
        isDayPass,
        hasCredits,
        creditsRemaining,
        scanType,
        portfolioLimit,
        isLoading: isLoading || snapshot.userId !== userId,
        justActivated: snapshot.userId === userId && justActivated,
        refresh,
    }), [subscription, isVipPro, isDayPass, hasCredits, creditsRemaining, scanType, portfolioLimit, isLoading, justActivated, refresh, snapshot.userId, userId]);
}

const SubscriptionContext = createContext<UseSubscriptionReturn | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
    const value = useSubscriptionState();
    return createElement(SubscriptionContext.Provider, { value }, children);
}

export function useSubscription(): UseSubscriptionReturn {
    const value = useContext(SubscriptionContext);
    if (!value) throw new Error('SubscriptionProvider is required');
    return value;
}

export default useSubscription;
