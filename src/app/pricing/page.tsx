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
                                {t('pricing_active')}: {subscription.package_type === 'vip_pro' ? t('pricing_vippro') : subscription.package_type === 'day_pass' ? t('pricing_daypass') : `${t('pricing_creditpack')} (${creditsRemaining})`}
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
                                <h3 className="text-lg font-bold text-white">{t('pricing_daypass')}</h3>
                                <p className="text-xs text-gray-500">{t('pricing_daypass_type')}</p>
                            </div>
                        </div>

                        <div className="mb-6">
                            <span className="text-3xl font-bold text-white">69,000</span>
                            <span className="text-gray-400 ml-1">₫</span>
                        </div>

                        <p className="text-gray-400 text-sm mb-6">{t('pricing_daypass_desc')}</p>

                        <div className="space-y-3 mb-8 flex-1">
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('pricing_phase1')}</h4>
                            <Feature icon={<Lightning weight="fill" className="text-blue-400" />} text={t('pricing_feat_daypass_1')} />
                            <Feature icon={<Package weight="fill" className="text-blue-400" />} text={t('pricing_feat_daypass_2')} />
                            <Feature icon={<CheckCircle weight="fill" className="text-blue-400" />} text={t('pricing_feat_daypass_3')} />

                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-4">{t('pricing_phase2_ecosystem')}</h4>
                            <Feature icon={<Storefront className="text-gray-600" />} text={t('pricing_feat_basic_p2')} muted />
                            <Feature icon={<Gavel className="text-gray-600" />} text={t('pricing_feat_basic_p3')} muted />
                            <Feature icon={<Users className="text-gray-600" />} text={t('pricing_feat_basic_p4')} muted />
                        </div>

                        <button
                            onClick={() => handlePurchase("day_pass")}
                            disabled={loadingPackage === "day_pass" || isDayPass}
                            className="w-full py-3 rounded-xl font-bold text-sm transition-all duration-200 bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loadingPackage === "day_pass" ? t('pricing_processing') : isDayPass ? t('pricing_active') : t('pricing_buy')}
                        </button>
                    </div>

                    {/* COLLECTOR */}
                    <div className="relative group rounded-2xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent backdrop-blur-sm p-6 lg:p-8 hover:border-emerald-500/30 transition-all duration-300 flex flex-col">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                                <CreditCard className="w-6 h-6 text-emerald-400" weight="bold" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">{t('pricing_creditpack')}</h3>
                                <p className="text-xs text-gray-500">{t('pricing_creditpack_type')}</p>
                            </div>
                        </div>

                        <div className="mb-6">
                            <span className="text-3xl font-bold text-white">99,000</span>
                            <span className="text-gray-400 ml-1">₫</span>
                        </div>

                        <p className="text-gray-400 text-sm mb-6">{t('pricing_creditpack_desc')}</p>

                        <div className="space-y-3 mb-8 flex-1">
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('pricing_phase1')}</h4>
                            <Feature icon={<Lightning weight="fill" className="text-emerald-400" />} text={t('pricing_feat_credit_1')} />
                            <Feature icon={<Package weight="fill" className="text-emerald-400" />} text={t('pricing_feat_credit_2')} />
                            <Feature icon={<CheckCircle weight="fill" className="text-emerald-400" />} text={t('pricing_feat_credit_3')} />

                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-4">{t('pricing_phase2_ecosystem')}</h4>
                            <Feature icon={<Storefront className="text-gray-600" />} text={t('pricing_feat_basic_p2')} muted />
                            <Feature icon={<Gavel className="text-gray-600" />} text={t('pricing_feat_basic_p3')} muted />
                            <Feature icon={<Users className="text-gray-600" />} text={t('pricing_feat_basic_p4')} muted />
                        </div>

                        <button
                            onClick={() => handlePurchase("credit_pack")}
                            disabled={loadingPackage === "credit_pack"}
                            className="w-full py-3 rounded-xl font-bold text-sm transition-all duration-200 bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loadingPackage === "credit_pack" ? t('pricing_processing') : hasCredits ? `${t('pricing_buy')} (${creditsRemaining})` : t('pricing_buy')}
                        </button>
                    </div>

                    {/* MERCHANT VIP Pro */}
                    <div className="relative group rounded-2xl border-2 border-orange-500/40 bg-gradient-to-b from-orange-500/10 via-amber-500/5 to-transparent backdrop-blur-sm p-6 lg:p-8 hover:border-orange-400/60 transition-all duration-300 flex flex-col shadow-[0_0_30px_rgba(251,146,60,0.1)]">
                        {/* Popular badge */}
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                            <span className="bg-gradient-to-r from-orange-500 to-amber-500 text-white text-xs font-bold px-4 py-1 rounded-full shadow-lg flex items-center gap-1">
                                <Sparkle weight="fill" className="w-3 h-3" />
                                {t('pricing_popular')}
                            </span>
                        </div>

                        <div className="flex items-center gap-3 mb-4 mt-2">
                            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500/30 to-amber-500/30 flex items-center justify-center">
                                <Crown className="w-6 h-6 text-orange-400" weight="fill" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold bg-gradient-to-r from-orange-400 to-amber-300 bg-clip-text text-transparent">{t('pricing_vippro')}</h3>
                                <p className="text-xs text-orange-400/70">{t('pricing_vippro_type')}</p>
                            </div>
                        </div>

                        <div className="mb-6">
                            <span className="text-3xl font-bold text-white">299,000</span>
                            <span className="text-gray-400 ml-1">₫</span>
                            <span className="text-gray-500 text-sm ml-2">/ month</span>
                        </div>

                        <p className="text-gray-400 text-sm mb-6">{t('pricing_vippro_desc')}</p>

                        <div className="space-y-3 mb-8 flex-1">
                            <h4 className="text-xs font-semibold text-orange-500/70 uppercase tracking-wider flex items-center gap-1">
                                <Star weight="fill" className="w-3 h-3" /> {t('pricing_phase1_perks')}
                            </h4>
                            <Feature icon={<Lightning weight="fill" className="text-orange-400" />} text={t('pricing_feat_vip_1')} highlight />
                            <Feature icon={<Package weight="fill" className="text-orange-400" />} text={t('pricing_feat_vip_2')} highlight />
                            <Feature icon={<Sparkle weight="fill" className="text-orange-400" />} text={t('pricing_feat_vip_3')} highlight />
                            <Feature icon={<Crown weight="fill" className="text-orange-400" />} text={t('pricing_feat_vip_4')} highlight />

                            <h4 className="text-xs font-semibold text-orange-500/70 uppercase tracking-wider mt-4 flex items-center gap-1">
                                <Star weight="fill" className="w-3 h-3" /> {t('pricing_phase2')}
                            </h4>
                            <Feature icon={<ShieldCheck weight="fill" className="text-amber-400" />} text={t('pricing_feat_vip_p2_1')} highlight />
                            <Feature icon={<Storefront weight="fill" className="text-amber-400" />} text={t('pricing_feat_vip_p2_2')} highlight />
                            <Feature icon={<Sparkle weight="fill" className="text-amber-400" />} text={t('pricing_feat_vip_p2_3')} highlight />

                            <h4 className="text-xs font-semibold text-orange-500/70 uppercase tracking-wider mt-4 flex items-center gap-1">
                                <Star weight="fill" className="w-3 h-3" /> {t('pricing_phase3')}
                            </h4>
                            <Feature icon={<Gavel weight="fill" className="text-amber-400" />} text={t('pricing_feat_vip_p3_1')} highlight />
                            <Feature icon={<Lightning weight="fill" className="text-amber-400" />} text={t('pricing_feat_vip_p3_2')} highlight />
                            <Feature icon={<CheckCircle weight="fill" className="text-amber-400" />} text={t('pricing_feat_vip_p3_3')} highlight />

                            <h4 className="text-xs font-semibold text-orange-500/70 uppercase tracking-wider mt-4 flex items-center gap-1">
                                <Star weight="fill" className="w-3 h-3" /> {t('pricing_phase4')}
                            </h4>
                            <Feature icon={<Crown weight="fill" className="text-amber-400" />} text={t('pricing_feat_vip_p4_1')} highlight />
                            <Feature icon={<Users weight="fill" className="text-amber-400" />} text={t('pricing_feat_vip_p4_2')} highlight />
                            <Feature icon={<Lock weight="fill" className="text-amber-400" />} text={t('pricing_feat_vip_p4_3')} highlight />
                        </div>

                        <button
                            onClick={() => handlePurchase("vip_pro")}
                            disabled={loadingPackage === "vip_pro" || isVipPro}
                            className="w-full py-3.5 rounded-xl font-bold text-sm transition-all duration-200 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white shadow-lg shadow-orange-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loadingPackage === "vip_pro" ? t('pricing_processing') : isVipPro ? `${t('pricing_active')}` : t('pricing_buy')}
                        </button>
                    </div>
                </div>

                {/* Free Tier Info */}
                <div className="max-w-2xl mx-auto px-4 mt-12 text-center">
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6">
                        <h3 className="text-white font-semibold mb-2">{t('pricing_free_tier')}</h3>
                        <p className="text-gray-500 text-sm">
                            {t('pricing_free_tier_desc')}
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
