"use client";

import { useState, useEffect, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useUser } from '@/lib/supabase';

const ANONYMOUS_LIMIT = 1;
const REGISTERED_LIMIT = 3;
const LOCAL_STORAGE_KEY = 'cardverse_scan_usage';

interface ScanUsage {
    scanCount: number;
    lastResetDate: string; // ISO date string (YYYY-MM-DD)
}

interface UseScanLimitReturn {
    canScan: boolean;
    scansUsed: number;
    scansLimit: number;
    scansRemaining: number;
    resetTime: Date;
    incrementUsage: () => Promise<void>;
    isLoading: boolean;
}

/**
 * Get the start of the next day (midnight) in local timezone
 */
function getNextMidnight(): Date {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
}

/**
 * Get today's date as YYYY-MM-DD string
 */
function getTodayString(): string {
    return new Date().toISOString().split('T')[0];
}

/**
 * Hook to manage scan usage limits
 * - Anonymous users: 1 scan/day (localStorage)
 * - Registered users: 3 scans/day (Supabase user_scan_usage table)
 */
export function useScanLimit(): UseScanLimitReturn {
    const { user } = useUser();
    const [scansUsed, setScansUsed] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [resetTime, setResetTime] = useState<Date>(getNextMidnight());

    const scansLimit = user ? REGISTERED_LIMIT : ANONYMOUS_LIMIT;
    const scansRemaining = Math.max(0, scansLimit - scansUsed);
    const canScan = scansRemaining > 0;

    // Load usage on mount and when user changes
    useEffect(() => {
        const loadUsage = async () => {
            setIsLoading(true);
            const today = getTodayString();

            if (user) {
                // Authenticated: fetch from Supabase
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
                            // New day - reset count
                            setScansUsed(0);
                        }
                    } else {
                        // No record yet
                        setScansUsed(0);
                    }
                } catch (err) {
                    console.error('Error loading scan usage:', err);
                    setScansUsed(0);
                }
            } else {
                // Anonymous: use localStorage
                try {
                    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
                    if (stored) {
                        const usage: ScanUsage = JSON.parse(stored);
                        if (usage.lastResetDate === today) {
                            setScansUsed(usage.scanCount);
                        } else {
                            // New day - reset
                            setScansUsed(0);
                            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
                                scanCount: 0,
                                lastResetDate: today,
                            }));
                        }
                    } else {
                        setScansUsed(0);
                    }
                } catch {
                    setScansUsed(0);
                }
            }

            setResetTime(getNextMidnight());
            setIsLoading(false);
        };

        loadUsage();
    }, [user]);

    // Increment usage after a successful scan
    const incrementUsage = useCallback(async () => {
        const today = getTodayString();
        const newCount = scansUsed + 1;

        if (user) {
            // Authenticated: upsert to Supabase
            try {
                const supabase = getSupabaseClient();
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
            } catch (err) {
                console.error('Error incrementing scan usage:', err);
            }
        } else {
            // Anonymous: update localStorage
            try {
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
                    scanCount: newCount,
                    lastResetDate: today,
                }));
                setScansUsed(newCount);
            } catch {
                console.error('Error saving scan usage to localStorage');
            }
        }
    }, [user, scansUsed]);

    return {
        canScan,
        scansUsed,
        scansLimit,
        scansRemaining,
        resetTime,
        incrementUsage,
        isLoading,
    };
}

export default useScanLimit;

