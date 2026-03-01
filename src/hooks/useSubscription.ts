"use client";

import { useState, useEffect, useCallback } from 'react';
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
    refresh: () => Promise<void>;
}

export function useSubscription(): UseSubscriptionReturn {
    const { user } = useUser();
    const [subscription, setSubscription] = useState<Subscription | null>(null);
    const [isLoading, setIsLoading] = useState(true);

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
            // Check VIP Pro first
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

            // Check Day Pass
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

            // Check Credit Pack
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

    useEffect(() => {
        fetchSubscription();
    }, [fetchSubscription]);

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
        refresh: fetchSubscription,
    };
}

export default useSubscription;
