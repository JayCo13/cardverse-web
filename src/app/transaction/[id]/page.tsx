"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Skeleton } from "@/components/ui/skeleton";
import { useSupabase, useUser } from "@/lib/supabase";

export default function LegacyTransactionRedirectPage() {
    const params = useParams();
    const router = useRouter();
    const supabase = useSupabase();
    const { user, isLoading } = useUser();
    const transactionId = params.id as string;

    useEffect(() => {
        if (isLoading) return;

        if (!user || !transactionId) {
            router.replace("/buy");
            return;
        }

        const redirect = async () => {
            const { data: transaction } = await supabase
                .from("transactions")
                .select("id, offer_id, card_id, buyer_id, seller_id, status")
                .eq("id", transactionId)
                .maybeSingle();

            if (!transaction) {
                router.replace("/buy");
                return;
            }

            const row = transaction as {
                offer_id: string | null;
                card_id: string | null;
                buyer_id: string;
                seller_id: string;
                status: string | null;
            };

            if (row.buyer_id !== user.id && row.seller_id !== user.id) {
                router.replace("/buy");
                return;
            }

            if (row.status === "completed" || row.status === "paid") {
                router.replace("/orders");
                return;
            }

            if (row.status === "cancelled" || row.status === "auto_cancelled" || row.status === "expired") {
                router.replace(row.card_id ? `/cards/${row.card_id}` : "/buy");
                return;
            }

            if (row.offer_id && row.buyer_id === user.id) {
                router.replace(`/checkout?offerId=${row.offer_id}`);
                return;
            }

            router.replace(row.card_id ? `/cards/${row.card_id}` : "/buy");
        };

        void redirect();
    }, [isLoading, router, supabase, transactionId, user]);

    return (
        <div className="flex min-h-screen flex-col">
            <Header />
            <main className="container mx-auto flex-1 px-4 py-10">
                <div className="mx-auto max-w-xl rounded-xl border bg-card p-6">
                    <p className="mb-4 text-lg font-semibold">Đang chuyển sang checkout...</p>
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="mt-3 h-4 w-2/3" />
                </div>
            </main>
            <Footer />
        </div>
    );
}
