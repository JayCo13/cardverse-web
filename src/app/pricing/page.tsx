"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { useUser } from "@/lib/supabase";
import { useSubscription } from "@/hooks/useSubscription";
import { useToast } from "@/hooks/use-toast";
import { useLocalization } from "@/context/localization-context";
import { Lightning, CreditCard, Crown, CheckCircle, Star, Lock, Timer, Package, Sparkle, ShieldCheck, Storefront, Gavel, Users } from "@phosphor-icons/react";

function PaymentStatusHandler() {
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const { refresh } = useSubscription();

    useEffect(() => {
        const paymentStatus = searchParams.get("payment");
        if (paymentStatus === "success") {
            toast({
                title: "🎉 Payment Successful!",
                description: "Your package has been activated. Enjoy your new perks!",
                duration: 5000,
            });
            refresh();
            window.history.replaceState({}, "", "/pricing");
        } else if (paymentStatus === "cancelled") {
            toast({
                title: "Payment Cancelled",
                description: "Your payment was cancelled. You can try again anytime.",
                duration: 4000,
            });
            window.history.replaceState({}, "", "/pricing");
        }
    }, [searchParams, toast, refresh]);

    return null;
}

export default function PricingPage() {
    const { user } = useUser();
    const { subscription, isVipPro, isDayPass, hasCredits, creditsRemaining, isLoading: subLoading } = useSubscription();
    const { t } = useLocalization();
    const { toast } = useToast();
    const [loadingPackage, setLoadingPackage] = useState<string | null>(null);

    const handlePurchase = async (packageType: string) => {
        if (!user) {
            toast({
                title: "Login Required",
                description: "Please sign in to purchase a package.",
                duration: 3000,
            });
            return;
        }

        setLoadingPackage(packageType);
        try {
            const res = await fetch("/api/payos/create-payment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ packageType }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Failed to create payment");
            }

            // Redirect to PayOS checkout
            window.location.href = data.checkoutUrl;
        } catch (error) {
            console.error("Purchase error:", error);
            toast({
                title: "Error",
                description: "Failed to initiate payment. Please try again.",
                duration: 4000,
            });
        } finally {
            setLoadingPackage(null);
        }
    };

    return (
        <div className="flex flex-col min-h-screen bg-[#050505]">
            <Suspense fallback={null}>
                <PaymentStatusHandler />
            </Suspense>
            <Header />

            <main className="flex-1 pt-8 pb-20">
                {/* Hero */}
                <div className="text-center max-w-3xl mx-auto px-4 mb-12">
                    <h1 className="text-3xl md:text-5xl font-bold bg-gradient-to-r from-orange-400 via-amber-300 to-orange-500 bg-clip-text text-transparent mb-4">
                        {t('pricing_title') || 'Choose Your Power Package'}
                    </h1>
                    <p className="text-gray-400 text-base md:text-lg">
                        {t('pricing_subtitle') || 'Unlock the full potential of AI-powered card scanning and join the CardVerseHub ecosystem.'}
                    </p>

                    {/* Active subscription badge */}
                    {!subLoading && subscription && (
                        <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-orange-500/20 to-amber-500/20 border border-orange-500/30">
                            <Crown className="w-5 h-5 text-orange-400" weight="fill" />
                            <span className="text-orange-300 font-medium text-sm">
                                Active: {subscription.package_type === 'vip_pro' ? 'MERCHANT VIP Pro' : subscription.package_type === 'day_pass' ? 'BOX BREAK 24H' : `COLLECTOR (${creditsRemaining} credits)`}
                            </span>
                        </div>
                    )}
                </div>

                {/* Package Cards */}
                <div className="max-w-6xl mx-auto px-4 grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">

                    {/* BOX BREAK 24H */}
                    <div className="relative group rounded-2xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent backdrop-blur-sm p-6 lg:p-8 hover:border-blue-500/30 transition-all duration-300 flex flex-col">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                                <Timer className="w-6 h-6 text-blue-400" weight="bold" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">BOX BREAK 24H</h3>
                                <p className="text-xs text-gray-500">Day Pass</p>
                            </div>
                        </div>

                        <div className="mb-6">
                            <span className="text-3xl font-bold text-white">69,000</span>
                            <span className="text-gray-400 ml-1">₫</span>
                            <span className="text-gray-500 text-sm ml-2">/ 24 hours</span>
                        </div>

                        <p className="text-gray-400 text-sm mb-6">Perfect for box-breaking events and high-volume scanning sessions.</p>

                        <div className="space-y-3 mb-8 flex-1">
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Phase 1 — Tools</h4>
                            <Feature icon={<Lightning weight="fill" className="text-blue-400" />} text="Unlimited scans for 24 hours" />
                            <Feature icon={<Package weight="fill" className="text-blue-400" />} text="Portfolio expanded to 100 cards" />
                            <Feature icon={<CheckCircle weight="fill" className="text-blue-400" />} text="Fair Use: max 500 scans/day" />

                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-4">Phases 2–4 — Ecosystem</h4>
                            <Feature icon={<Storefront className="text-gray-600" />} text="Standard 5% marketplace fee" muted />
                            <Feature icon={<Gavel className="text-gray-600" />} text="100% upfront bid balance required" muted />
                            <Feature icon={<Users className="text-gray-600" />} text="No special forum badges" muted />
                        </div>

                        <button
                            onClick={() => handlePurchase("day_pass")}
                            disabled={loadingPackage === "day_pass" || isDayPass}
                            className="w-full py-3 rounded-xl font-bold text-sm transition-all duration-200 bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loadingPackage === "day_pass" ? "Processing..." : isDayPass ? "Active ✓" : "Buy Day Pass"}
                        </button>
                    </div>

                    {/* COLLECTOR */}
                    <div className="relative group rounded-2xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent backdrop-blur-sm p-6 lg:p-8 hover:border-emerald-500/30 transition-all duration-300 flex flex-col">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                                <CreditCard className="w-6 h-6 text-emerald-400" weight="bold" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">COLLECTOR</h3>
                                <p className="text-xs text-gray-500">Credit Pack</p>
                            </div>
                        </div>

                        <div className="mb-6">
                            <span className="text-3xl font-bold text-white">99,000</span>
                            <span className="text-gray-400 ml-1">₫</span>
                            <span className="text-gray-500 text-sm ml-2">/ 100 credits</span>
                        </div>

                        <p className="text-gray-400 text-sm mb-6">Pay-as-you-go credits. Only used on successful scans. Never expires.</p>

                        <div className="space-y-3 mb-8 flex-1">
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Phase 1 — Tools</h4>
                            <Feature icon={<Lightning weight="fill" className="text-emerald-400" />} text="100 lifetime scan credits" />
                            <Feature icon={<Package weight="fill" className="text-emerald-400" />} text="Portfolio expanded to 200 cards" />
                            <Feature icon={<CheckCircle weight="fill" className="text-emerald-400" />} text="Credits deducted on success only" />

                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-4">Phases 2–4 — Ecosystem</h4>
                            <Feature icon={<Storefront className="text-gray-600" />} text="Standard 5% marketplace fee" muted />
                            <Feature icon={<Gavel className="text-gray-600" />} text="100% upfront bid balance required" muted />
                            <Feature icon={<Users className="text-gray-600" />} text="No special forum badges" muted />
                        </div>

                        <button
                            onClick={() => handlePurchase("credit_pack")}
                            disabled={loadingPackage === "credit_pack"}
                            className="w-full py-3 rounded-xl font-bold text-sm transition-all duration-200 bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loadingPackage === "credit_pack" ? "Processing..." : hasCredits ? `Buy More (${creditsRemaining} left)` : "Buy 100 Credits"}
                        </button>
                    </div>

                    {/* MERCHANT VIP Pro */}
                    <div className="relative group rounded-2xl border-2 border-orange-500/40 bg-gradient-to-b from-orange-500/10 via-amber-500/5 to-transparent backdrop-blur-sm p-6 lg:p-8 hover:border-orange-400/60 transition-all duration-300 flex flex-col shadow-[0_0_30px_rgba(251,146,60,0.1)]">
                        {/* Popular badge */}
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                            <span className="bg-gradient-to-r from-orange-500 to-amber-500 text-white text-xs font-bold px-4 py-1 rounded-full shadow-lg flex items-center gap-1">
                                <Sparkle weight="fill" className="w-3 h-3" />
                                MOST POPULAR
                            </span>
                        </div>

                        <div className="flex items-center gap-3 mb-4 mt-2">
                            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500/30 to-amber-500/30 flex items-center justify-center">
                                <Crown className="w-6 h-6 text-orange-400" weight="fill" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold bg-gradient-to-r from-orange-400 to-amber-300 bg-clip-text text-transparent">MERCHANT</h3>
                                <p className="text-xs text-orange-400/70">VIP Pro</p>
                            </div>
                        </div>

                        <div className="mb-6">
                            <span className="text-3xl font-bold text-white">299,000</span>
                            <span className="text-gray-400 ml-1">₫</span>
                            <span className="text-gray-500 text-sm ml-2">/ month</span>
                        </div>

                        <p className="text-gray-400 text-sm mb-6">The ultimate package for serious dealers, sellers, and Razz hosts.</p>

                        <div className="space-y-3 mb-8 flex-1">
                            <h4 className="text-xs font-semibold text-orange-500/70 uppercase tracking-wider flex items-center gap-1">
                                <Star weight="fill" className="w-3 h-3" /> Phase 1 — Immediate Perks
                            </h4>
                            <Feature icon={<Lightning weight="fill" className="text-orange-400" />} text="Unlimited monthly scans (3,000 fair use)" highlight />
                            <Feature icon={<Package weight="fill" className="text-orange-400" />} text="UNLIMITED portfolio capacity" highlight />
                            <Feature icon={<Sparkle weight="fill" className="text-orange-400" />} text="Priority AI scan queue (< 2s)" highlight />
                            <Feature icon={<Crown weight="fill" className="text-orange-400" />} text="👑 VIP Pro profile badge" highlight />

                            <h4 className="text-xs font-semibold text-orange-500/70 uppercase tracking-wider mt-4 flex items-center gap-1">
                                <Star weight="fill" className="w-3 h-3" /> Phase 2 — Marketplace
                            </h4>
                            <Feature icon={<ShieldCheck weight="fill" className="text-amber-400" />} text="✅ Verified Seller checkmark" highlight />
                            <Feature icon={<Storefront weight="fill" className="text-amber-400" />} text="Ultra-low 1.5% seller fee (vs 5%)" highlight />
                            <Feature icon={<Sparkle weight="fill" className="text-amber-400" />} text='5 free "Hot Deal" bumps / week' highlight />

                            <h4 className="text-xs font-semibold text-orange-500/70 uppercase tracking-wider mt-4 flex items-center gap-1">
                                <Star weight="fill" className="w-3 h-3" /> Phase 3 — Auction & Razz
                            </h4>
                            <Feature icon={<Gavel weight="fill" className="text-amber-400" />} text="🎰 Exclusive Razz hosting rights" highlight />
                            <Feature icon={<Lightning weight="fill" className="text-amber-400" />} text="Margin Bidding (credit line)" highlight />
                            <Feature icon={<CheckCircle weight="fill" className="text-amber-400" />} text="Reduced 3% auction fee (vs 8%)" highlight />

                            <h4 className="text-xs font-semibold text-orange-500/70 uppercase tracking-wider mt-4 flex items-center gap-1">
                                <Star weight="fill" className="w-3 h-3" /> Phase 4 — Community
                            </h4>
                            <Feature icon={<Crown weight="fill" className="text-amber-400" />} text="Animated VIP badge + flair" highlight />
                            <Feature icon={<Users weight="fill" className="text-amber-400" />} text="Direct sales posts allowed" highlight />
                            <Feature icon={<Lock weight="fill" className="text-amber-400" />} text="Private VIP forum section" highlight />
                        </div>

                        <button
                            onClick={() => handlePurchase("vip_pro")}
                            disabled={loadingPackage === "vip_pro" || isVipPro}
                            className="w-full py-3.5 rounded-xl font-bold text-sm transition-all duration-200 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white shadow-lg shadow-orange-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loadingPackage === "vip_pro" ? "Processing..." : isVipPro ? "Active ✓ Renew" : "Subscribe VIP Pro"}
                        </button>
                    </div>
                </div>

                {/* Free Tier Info */}
                <div className="max-w-2xl mx-auto px-4 mt-12 text-center">
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6">
                        <h3 className="text-white font-semibold mb-2">Free Tier</h3>
                        <p className="text-gray-500 text-sm">
                            All users get <span className="text-white font-medium">5 free scans per day</span> and a portfolio capacity of <span className="text-white font-medium">20 cards</span>. Sign up to start scanning — no payment required.
                        </p>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}

function Feature({ icon, text, muted, highlight }: { icon: React.ReactNode; text: string; muted?: boolean; highlight?: boolean }) {
    return (
        <div className={`flex items-start gap-2.5 text-sm ${muted ? 'text-gray-600' : highlight ? 'text-gray-200' : 'text-gray-300'}`}>
            <span className="w-4 h-4 mt-0.5 flex-shrink-0">{icon}</span>
            <span>{text}</span>
        </div>
    );
}
