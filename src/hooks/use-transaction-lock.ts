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
            // Query as seller
            const { data: sellerTx } = await supabase
                .from('transactions')
                .select('*')
                .eq('seller_id', user.id)
                .eq('status', 'active')
                .limit(1)
                .single();

            if (sellerTx) {
                const txData: Transaction = {
                    id: sellerTx.id,
                    cardId: sellerTx.card_id,
                    sellerId: sellerTx.seller_id,
                    buyerId: sellerTx.buyer_id,
                    offerId: sellerTx.offer_id,
                    price: sellerTx.price,
                    status: sellerTx.status,
                    cancelledBy: sellerTx.cancelled_by,
                    cancellationReason: sellerTx.cancellation_reason,
                    createdAt: sellerTx.created_at,
                    expiresAt: sellerTx.expires_at,
                    completedAt: sellerTx.completed_at,
                    cancelledAt: sellerTx.cancelled_at,
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
                .single();

            if (buyerTx) {
                const txData: Transaction = {
                    id: buyerTx.id,
                    cardId: buyerTx.card_id,
                    sellerId: buyerTx.seller_id,
                    buyerId: buyerTx.buyer_id,
                    offerId: buyerTx.offer_id,
                    price: buyerTx.price,
                    status: buyerTx.status,
                    cancelledBy: buyerTx.cancelled_by,
                    cancellationReason: buyerTx.cancellation_reason,
                    createdAt: buyerTx.created_at,
                    expiresAt: buyerTx.expires_at,
                    completedAt: buyerTx.completed_at,
                    cancelledAt: buyerTx.cancelled_at,
                };
                setActiveTransaction(txData);
                const transactionPath = `/transaction/${txData.id}`;
                if (pathname !== transactionPath) {
                    router.replace(transactionPath);
                }
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
