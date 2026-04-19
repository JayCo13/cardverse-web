"use client";

import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/supabase';
import { useSubscription } from '@/hooks/useSubscription';
import { getCachedDeviceFingerprint } from '@/lib/device-fingerprint';

const ANONYMOUS_LIMIT = 2;
const FREE_USER_LIMIT = 5;
const DAY_PASS_LIMIT = 500; // Fair use
const VIP_PRO_MONTHLY_LIMIT = 3000; // Fair use
const LOCAL_STORAGE_KEY = 'cardverse_scan_usage'; // Keep as fast cache

interface ScanUsage {
    scanCount: number;
    lastResetDate: string;
}

interface UseScanLimitReturn {
    canScan: boolean;
    scansUsed: number;
    scansLimit: number;
    scansRemaining: number;
    resetTime: Date;
    incrementUsage: () => Promise<void>;
    isLoading: boolean;
    scanType: 'free' | 'day_pass' | 'credit' | 'unlimited';
    creditsRemaining: number;
    subscription: { expires_at: string | null; package_type: string } | null;
}

function getNextMidnight(): Date {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
}

function getTodayString(): string {
    return new Date().toISOString().split('T')[0];
}

export function useScanLimit(): UseScanLimitReturn {
    const { user } = useUser();
    const { scanType, creditsRemaining, subscription, refresh: refreshSub } = useSubscription();
    const [scansUsed, setScansUsed] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [resetTime, setResetTime] = useState<Date>(getNextMidnight());

    // Determine the limit based on subscription
    const scansLimit = !user
        ? ANONYMOUS_LIMIT
        : scanType === 'unlimited'
            ? VIP_PRO_MONTHLY_LIMIT
            : scanType === 'day_pass'
                ? DAY_PASS_LIMIT
                : scanType === 'credit'
                    ? creditsRemaining
                    : FREE_USER_LIMIT;

    const scansRemaining = scanType === 'credit'
        ? creditsRemaining
        : Math.max(0, scansLimit - scansUsed);

    const canScan = scansRemaining > 0;

    useEffect(() => {
        const loadUsage = async () => {
            setIsLoading(true);
            const today = getTodayString();

            if (user) {
                // ── Logged-in user: use user_scan_usage table ──
                try {
                    const supabase = getSupabaseClient();
                    const { data, error } = await supabase
                        .from('user_scan_usage')
                        .select('scan_count, last_reset_date')
                        .eq('user_id', user.id)
                        .single();

                    if (error && error.code !== 'PGRST116') {
                        console.error('Error fetching scan usage:', error);
                    }

                    if (data) {
                        const record = data as { scan_count: number; last_reset_date: string };
                        const lastReset = new Date(record.last_reset_date).toISOString().split('T')[0];
                        if (lastReset === today) {
                            setScansUsed(record.scan_count);
                        } else {
                            setScansUsed(0);
                        }
                    } else {
                        setScansUsed(0);
                    }
                } catch (err) {
                    console.error('Error loading scan usage:', err);
                    setScansUsed(0);
                }
            } else {
                // ── Anonymous user: SERVER is the ONLY source of truth ──
                // Do NOT show localStorage cache first — it causes stale '5 remaining' in incognito
                let serverCount: number | null = null;

                try {
                    const deviceId = getCachedDeviceFingerprint();
                    console.log('[ScanLimit] Device fingerprint:', deviceId);
                    const supabase = getSupabaseClient();

                    const { data, error } = await supabase
                        .from('device_scan_usage')
                        .select('scan_count, last_reset_date')
                        .eq('device_id', deviceId)
                        .single();

                    if (error && error.code !== 'PGRST116') {
                        console.error('Error fetching device scan usage:', error);
                    }

                    if (data) {
                        const record = data as { scan_count: number; last_reset_date: string };
                        const lastReset = record.last_reset_date; // Already a date string
                        if (lastReset === today) {
                            serverCount = record.scan_count;
                        } else {
                            // New day — reset
                            serverCount = 0;
                        }
                    } else {
                        // No record yet — fresh device
                        serverCount = 0;
                    }
                } catch (err) {
                    console.error('Error loading device scan usage:', err);
                }

                // If server responded, use it; otherwise fall back to localStorage cache
                if (serverCount !== null) {
                    setScansUsed(serverCount);
                    // Sync to localStorage for next time
                    try {
                        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
                            scanCount: serverCount,
                            lastResetDate: today,
                        }));
                    } catch { /* ignore */ }
                } else {
                    // Server failed — try localStorage as last resort
                    try {
                        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
                        if (stored) {
                            const usage: ScanUsage = JSON.parse(stored);
                            if (usage.lastResetDate === today) {
                                setScansUsed(usage.scanCount);
                            } else {
                                setScansUsed(0);
                            }
                        } else {
                            setScansUsed(0);
                        }
                    } catch {
                        setScansUsed(0);
                    }
                }
            }

            setResetTime(getNextMidnight());
            setIsLoading(false);
        };

        loadUsage();
    }, [user]);

    const incrementUsage = useCallback(async () => {
        const today = getTodayString();
        const newCount = scansUsed + 1;

        if (user) {
            // ── Logged-in user: same as before ──
            try {
                const supabase = getSupabaseClient();

                // For credit-based users, also deduct a credit via server-side API
                if (scanType === 'credit' && subscription) {
                    try {
                        const res = await fetch('/api/scan/decrement-credit', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                subscriptionId: subscription.id,
                                userId: user.id,
                            }),
                        });
                        if (!res.ok) {
                            const errData = await res.json();
                            console.error('Error decrementing credit:', errData.error);
                        }
                    } catch (creditErr) {
                        console.error('Error decrementing credit:', creditErr);
                    }
                    // Refresh subscription to get updated credits
                    refreshSub();
                }

                // Always track scan count in user_scan_usage
                const { error } = await supabase
                    .from('user_scan_usage')
                    .upsert({
                        user_id: user.id,
                        scan_count: newCount,
                        last_reset_date: new Date().toISOString(),
                    } as never, {
                        onConflict: 'user_id',
                    });

                if (error) {
                    console.error('Error updating scan usage:', error);
                } else {
                    setScansUsed(newCount);
                }

                // Log the individual scan history event
                const { error: historyError } = await supabase
                    .from('user_scan_history')
                    .insert({
                        user_id: user.id,
                        scan_type: scanType
                    } as never);

                if (historyError) {
                    console.error('Error logging scan history:', historyError);
                }
            } catch (err) {
                console.error('Error incrementing scan usage:', err);
            }
        } else {
            // ── Anonymous user: upsert to device_scan_usage (server-side) ──
            try {
                const deviceId = getCachedDeviceFingerprint();
                const supabase = getSupabaseClient();

                const { error } = await supabase
                    .from('device_scan_usage')
                    .upsert({
                        device_id: deviceId,
                        scan_count: newCount,
                        last_reset_date: today,
                        updated_at: new Date().toISOString(),
                    }, {
                        onConflict: 'device_id',
                    });

                if (error) {
                    console.error('Error updating device scan usage:', error);
                } else {
                    setScansUsed(newCount);
                }

                // Also sync to localStorage as cache
                try {
                    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
                        scanCount: newCount,
                        lastResetDate: today,
                    }));
                } catch { /* ignore */ }
            } catch (err) {
                console.error('Error incrementing device scan usage:', err);
                // Fallback: at least update UI
                setScansUsed(newCount);
            }
        }
    }, [user, scansUsed, scanType, subscription, refreshSub]);

    return {
        canScan,
        scansUsed,
        scansLimit,
        scansRemaining,
        resetTime,
        incrementUsage,
        isLoading,
        scanType,
        creditsRemaining,
        subscription,
    };
}

export default useScanLimit;
