"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSupabase, useUser } from "@/lib/supabase";
import type { Transaction } from "@/lib/types";

/**
 * Hook to check for active transactions and redirect user to transaction room.
 * Uses refs for router/pathname to avoid re-firing the effect on navigation.
 * Effect only depends on user.id — fires once when auth resolves, not on every render.
 */
export function useTransactionLock() {
    const supabase = useSupabase();
    const { user } = useUser();
    const router = useRouter();
    const pathname = usePathname();
    const [activeTransaction, setActiveTransaction] = useState<Transaction | null>(null);
    const [isChecking, setIsChecking] = useState(true);

    // Store router/pathname in refs so they're always current but don't trigger re-renders
    const routerRef = useRef(router);
    routerRef.current = router;
    const pathnameRef = useRef(pathname);
    pathnameRef.current = pathname;

    // Track which user we already checked — prevents duplicate checks
    const checkedUserIdRef = useRef<string | null>(null);
    const mountedRef = useRef(true);

    // Stable user ID string — avoids object identity issues
    const userId = user?.id ?? null;

    const redirectToTransaction = useCallback((txId: string) => {
        const transactionPath = `/transaction/${txId}`;
        if (pathnameRef.current !== transactionPath) {
            routerRef.current.replace(transactionPath);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;

        if (!userId) {
            setIsChecking(false);
            checkedUserIdRef.current = null;
            return;
        }

        // Skip if we already checked this user
        if (checkedUserIdRef.current === userId) {
            setIsChecking(false);
            return;
        }

        const checkTransactions = async () => {
            try {
                // Query as seller
                const { data: sellerTx } = await supabase
                    .from('transactions')
                    .select('*')
                    .eq('seller_id', userId)
                    .eq('status', 'active')
                    .limit(1)
                    .maybeSingle();

                if (sellerTx && mountedRef.current) {
                    const tx = sellerTx as any;
                    const txData: Transaction = {
                        id: tx.id, cardId: tx.card_id, sellerId: tx.seller_id,
                        buyerId: tx.buyer_id, offerId: tx.offer_id, price: tx.price,
                        status: tx.status, cancelledBy: tx.cancelled_by,
                        cancellationReason: tx.cancellation_reason,
                        createdAt: tx.created_at, expiresAt: tx.expires_at,
                        completedAt: tx.completed_at, cancelledAt: tx.cancelled_at,
                    };
                    setActiveTransaction(txData);
                    redirectToTransaction(txData.id);
                    setIsChecking(false);
                    checkedUserIdRef.current = userId;
                    return;
                }

                // Query as buyer
                const { data: buyerTx } = await supabase
                    .from('transactions')
                    .select('*')
                    .eq('buyer_id', userId)
                    .eq('status', 'active')
                    .limit(1)
                    .maybeSingle();

                if (buyerTx && mountedRef.current) {
                    const tx = buyerTx as any;
                    const txData: Transaction = {
                        id: tx.id, cardId: tx.card_id, sellerId: tx.seller_id,
                        buyerId: tx.buyer_id, offerId: tx.offer_id, price: tx.price,
                        status: tx.status, cancelledBy: tx.cancelled_by,
                        cancellationReason: tx.cancellation_reason,
                        createdAt: tx.created_at, expiresAt: tx.expires_at,
                        completedAt: tx.completed_at, cancelledAt: tx.cancelled_at,
                    };
                    setActiveTransaction(txData);
                    redirectToTransaction(txData.id);
                }
            } catch (err) {
                console.warn('[TransactionLock] Check failed:', err);
            }

            if (mountedRef.current) {
                setIsChecking(false);
                checkedUserIdRef.current = userId;
            }
        };

        checkTransactions();

        // Realtime subscription for transaction changes
        const channel = supabase
            .channel(`tx-lock-${userId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'transactions', filter: `seller_id=eq.${userId}` },
                (payload) => {
                    if (!mountedRef.current) return;
                    const tx = payload.new as any;
                    if (tx?.status === 'active') {
                        const txData: Transaction = {
                            id: tx.id, cardId: tx.card_id, sellerId: tx.seller_id,
                            buyerId: tx.buyer_id, offerId: tx.offer_id, price: tx.price,
                            status: tx.status, createdAt: tx.created_at, expiresAt: tx.expires_at,
                        };
                        setActiveTransaction(txData);
                        redirectToTransaction(txData.id);
                    } else {
                        setActiveTransaction(null);
                    }
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'transactions', filter: `buyer_id=eq.${userId}` },
                (payload) => {
                    if (!mountedRef.current) return;
                    const tx = payload.new as any;
                    if (tx?.status === 'active') {
                        const txData: Transaction = {
                            id: tx.id, cardId: tx.card_id, sellerId: tx.seller_id,
                            buyerId: tx.buyer_id, offerId: tx.offer_id, price: tx.price,
                            status: tx.status, createdAt: tx.created_at, expiresAt: tx.expires_at,
                        };
                        setActiveTransaction(txData);
                        redirectToTransaction(txData.id);
                    } else {
                        setActiveTransaction(null);
                    }
                }
            )
            .subscribe();

        return () => {
            mountedRef.current = false;
            supabase.removeChannel(channel);
        };
    // ONLY depend on userId (string) — not router, pathname, or user object
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    return { activeTransaction, isChecking };
}
