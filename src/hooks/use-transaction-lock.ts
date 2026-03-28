"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSupabase, useUser } from "@/lib/supabase";
import type { Transaction } from "@/lib/types";

/**
 * Hook to check for active transactions and redirect user to transaction room
 * This prevents users from navigating away during an active transaction
 */
export function useTransactionLock() {
    const supabase = useSupabase();
    const { user } = useUser();
    const router = useRouter();
    const pathname = usePathname();
    const [activeTransaction, setActiveTransaction] = useState<Transaction | null>(null);
    const [isChecking, setIsChecking] = useState(true);

    useEffect(() => {
        if (!user) {
            setIsChecking(false);
            return;
        }

        // Check for active transactions
        const checkTransactions = async () => {
            try {
                // Query as seller
                const { data: sellerTx } = await supabase
                    .from('transactions')
                    .select('*')
                    .eq('seller_id', user.id)
                    .eq('status', 'active')
                    .limit(1)
                    .maybeSingle();

                if (sellerTx) {
                    const txData: Transaction = {
                        id: (sellerTx as any).id,
                        cardId: (sellerTx as any).card_id,
                        sellerId: (sellerTx as any).seller_id,
                        buyerId: (sellerTx as any).buyer_id,
                        offerId: (sellerTx as any).offer_id,
                        price: (sellerTx as any).price,
                        status: (sellerTx as any).status,
                        cancelledBy: (sellerTx as any).cancelled_by,
                        cancellationReason: (sellerTx as any).cancellation_reason,
                        createdAt: (sellerTx as any).created_at,
                        expiresAt: (sellerTx as any).expires_at,
                        completedAt: (sellerTx as any).completed_at,
                        cancelledAt: (sellerTx as any).cancelled_at,
                    };
                    setActiveTransaction(txData);
                    const transactionPath = `/transaction/${txData.id}`;
                    if (pathname !== transactionPath) {
                        router.replace(transactionPath);
                    }
                    setIsChecking(false);
                    return;
                }

                // Query as buyer
                const { data: buyerTx } = await supabase
                    .from('transactions')
                    .select('*')
                    .eq('buyer_id', user.id)
                    .eq('status', 'active')
                    .limit(1)
                    .maybeSingle();

                if (buyerTx) {
                    const txData: Transaction = {
                        id: (buyerTx as any).id,
                        cardId: (buyerTx as any).card_id,
                        sellerId: (buyerTx as any).seller_id,
                        buyerId: (buyerTx as any).buyer_id,
                        offerId: (buyerTx as any).offer_id,
                        price: (buyerTx as any).price,
                        status: (buyerTx as any).status,
                        cancelledBy: (buyerTx as any).cancelled_by,
                        cancellationReason: (buyerTx as any).cancellation_reason,
                        createdAt: (buyerTx as any).created_at,
                        expiresAt: (buyerTx as any).expires_at,
                        completedAt: (buyerTx as any).completed_at,
                        cancelledAt: (buyerTx as any).cancelled_at,
                    };
                    setActiveTransaction(txData);
                    const transactionPath = `/transaction/${txData.id}`;
                    if (pathname !== transactionPath) {
                        router.replace(transactionPath);
                    }
                }
            } catch (err) {
                // Silently handle — don't crash the page if transactions table is unavailable
                console.warn('[TransactionLock] Check failed:', err);
            }

            setIsChecking(false);
        };

        checkTransactions();

        // Subscribe to transaction changes
        const channel = supabase
            .channel('transaction-lock')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'transactions',
                    filter: `seller_id=eq.${user.id}`,
                },
                (payload) => {
                    if (payload.new && (payload.new as any).status === 'active') {
                        const tx = payload.new as any;
                        const txData: Transaction = {
                            id: tx.id,
                            cardId: tx.card_id,
                            sellerId: tx.seller_id,
                            buyerId: tx.buyer_id,
                            offerId: tx.offer_id,
                            price: tx.price,
                            status: tx.status,
                            createdAt: tx.created_at,
                            expiresAt: tx.expires_at,
                        };
                        setActiveTransaction(txData);
                        const transactionPath = `/transaction/${txData.id}`;
                        if (pathname !== transactionPath) {
                            router.replace(transactionPath);
                        }
                    } else if (payload.new && (payload.new as any).status !== 'active') {
                        setActiveTransaction(null);
                    }
                }
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'transactions',
                    filter: `buyer_id=eq.${user.id}`,
                },
                (payload) => {
                    if (payload.new && (payload.new as any).status === 'active') {
                        const tx = payload.new as any;
                        const txData: Transaction = {
                            id: tx.id,
                            cardId: tx.card_id,
                            sellerId: tx.seller_id,
                            buyerId: tx.buyer_id,
                            offerId: tx.offer_id,
                            price: tx.price,
                            status: tx.status,
                            createdAt: tx.created_at,
                            expiresAt: tx.expires_at,
                        };
                        setActiveTransaction(txData);
                        const transactionPath = `/transaction/${txData.id}`;
                        if (pathname !== transactionPath) {
                            router.replace(transactionPath);
                        }
                    } else if (payload.new && (payload.new as any).status !== 'active') {
                        setActiveTransaction(null);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, supabase, pathname, router]);

    return { activeTransaction, isChecking };
}
