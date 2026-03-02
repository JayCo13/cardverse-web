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
    justActivated: boolean; // True when a subscription was just activated via realtime
    refresh: () => Promise<void>;
}

export function useSubscription(): UseSubscriptionReturn {
    const { user } = useUser();
    const [subscription, setSubscription] = useState<Subscription | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [justActivated, setJustActivated] = useState(false);
    const prevSubRef = useRef<Subscription | null>(null);

    const fetchSubscription = useCallback(async () => {
        if (!user) {
            setSubscription(null);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        try {
            const supabase = getSupabaseClient();
            const now = new Date().toISOString();

            // Priority: VIP Pro > Day Pass > Credit Pack
            const { data: vipPro } = await supabase
                .from('user_subscriptions')
                .select('*')
                .eq('user_id', user.id)
                .eq('package_type', 'vip_pro')
                .eq('status', 'active')
                .gte('expires_at', now)
                .order('expires_at', { ascending: false })
                .limit(1)
                .single();

            if (vipPro) {
                setSubscription(vipPro as Subscription);
                setIsLoading(false);
                return;
            }

            const { data: dayPass } = await supabase
                .from('user_subscriptions')
                .select('*')
                .eq('user_id', user.id)
                .eq('package_type', 'day_pass')
                .eq('status', 'active')
                .gte('expires_at', now)
                .order('expires_at', { ascending: false })
                .limit(1)
                .single();

            if (dayPass) {
                setSubscription(dayPass as Subscription);
                setIsLoading(false);
                return;
            }

            const { data: creditPack } = await supabase
                .from('user_subscriptions')
                .select('*')
                .eq('user_id', user.id)
                .eq('package_type', 'credit_pack')
                .eq('status', 'active')
                .gt('scan_credits_remaining', 0)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (creditPack) {
                setSubscription(creditPack as Subscription);
                setIsLoading(false);
                return;
            }

            setSubscription(null);
        } catch (err) {
            console.error('Error fetching subscription:', err);
            setSubscription(null);
        } finally {
            setIsLoading(false);
        }
    }, [user]);

    // ── Initial fetch ──
    useEffect(() => {
        fetchSubscription();
    }, [fetchSubscription]);

    // ── Supabase Realtime subscription ──
    // Listens for INSERT and UPDATE on user_subscriptions for this user.
    // When the webhook activates a package, this fires instantly.
    useEffect(() => {
        if (!user) return;

        const supabase = getSupabaseClient();
        const channel = supabase
            .channel(`user_subscriptions:${user.id}`)
            .on(
                'postgres_changes',
                {
                    event: '*', // INSERT, UPDATE, DELETE
                    schema: 'public',
                    table: 'user_subscriptions',
                    filter: `user_id=eq.${user.id}`,
                },
                (payload) => {
                    console.log('[Realtime] Subscription change detected:', payload.eventType);
                    // Re-fetch to get the highest priority subscription
                    fetchSubscription().then(() => {
                        // Signal that this was a realtime activation (not initial page load)
                        setJustActivated(true);
                        // Reset the flag after 5 seconds
                        setTimeout(() => setJustActivated(false), 5000);
                    });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, fetchSubscription]);

    // Track previous subscription for detecting changes
    useEffect(() => {
        prevSubRef.current = subscription;
    }, [subscription]);

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
        ? -1 // unlimited
        : hasCredits
            ? 200
            : isDayPass
                ? 100
                : 20; // free

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
        refresh: fetchSubscription,
    };
}

export default useSubscription;
