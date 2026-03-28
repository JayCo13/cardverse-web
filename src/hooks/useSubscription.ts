"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
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

export function useSubscription(): UseSubscriptionReturn {
    const { user } = useUser();
    const [subscription, setSubscription] = useState<Subscription | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [justActivated, setJustActivated] = useState(false);

    const mountedRef = useRef(true);
    const fetchedForUserRef = useRef<string | null>(null);

    // Stable user ID string — avoids object identity issues
    const userId = user?.id ?? null;

    // Fetch subscription — stable reference, uses userId ref internally
    const doFetch = useCallback(async (uid: string, showLoading: boolean) => {
        if (showLoading) setIsLoading(true);

        try {
            const supabase = getSupabaseClient();
            const now = new Date().toISOString();

            // Priority: VIP Pro > Day Pass > Credit Pack
            const { data: vipPro } = await supabase
                .from('user_subscriptions')
                .select('*')
                .eq('user_id', uid)
                .eq('package_type', 'vip_pro')
                .eq('status', 'active')
                .gte('expires_at', now)
                .order('expires_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (vipPro && mountedRef.current) {
                setSubscription(vipPro as Subscription);
                setIsLoading(false);
                return;
            }

            const { data: dayPass } = await supabase
                .from('user_subscriptions')
                .select('*')
                .eq('user_id', uid)
                .eq('package_type', 'day_pass')
                .eq('status', 'active')
                .gte('expires_at', now)
                .order('expires_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (dayPass && mountedRef.current) {
                setSubscription(dayPass as Subscription);
                setIsLoading(false);
                return;
            }

            const { data: creditPack } = await supabase
                .from('user_subscriptions')
                .select('*')
                .eq('user_id', uid)
                .eq('package_type', 'credit_pack')
                .eq('status', 'active')
                .gt('scan_credits_remaining', 0)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (creditPack && mountedRef.current) {
                setSubscription(creditPack as Subscription);
                setIsLoading(false);
                return;
            }

            if (mountedRef.current) {
                setSubscription(null);
                setIsLoading(false);
            }
        } catch (err) {
            console.error('Error fetching subscription:', err);
            if (mountedRef.current) {
                setSubscription(null);
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

        if (!userId) {
            setSubscription(null);
            setIsLoading(false);
            fetchedForUserRef.current = null;
            return;
        }

        // Skip if we already fetched for this exact user
        if (fetchedForUserRef.current === userId) {
            return;
        }

        fetchedForUserRef.current = userId;
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
                        if (mountedRef.current) {
                            setJustActivated(true);
                            setTimeout(() => setJustActivated(false), 5000);
                        }
                    });
                }
            )
            .subscribe();

        return () => {
            mountedRef.current = false;
            supabase.removeChannel(channel);
        };
    // ONLY depend on userId (string) — not user object or fetchSubscription
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

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

    return {
        subscription,
        isVipPro,
        isDayPass,
        hasCredits,
        creditsRemaining,
        scanType,
        portfolioLimit,
        isLoading,
        justActivated,
        refresh,
    };
}

export default useSubscription;
