"use client";

import { Gavel, GameController, ArrowRight } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Image from "next/image";
import { useLocalization } from "@/context/localization-context";

export function FeatureTeasers() {
    const { t } = useLocalization();

    return (
        <section className="py-16 relative z-20">
            <div className="container mx-auto px-4">
                <div className="grid md:grid-cols-2 gap-8">

                    <div className="group relative overflow-hidden rounded-3xl border-2 border-orange-500/50 h-[400px] flex flex-col justify-end p-8 transition-all hover:border-orange-400 will-change-transform">
                        <Image
                            src="/assets/c1.jpg"
                            alt="Auctions"
                            fill
                            loading="lazy"
                            className="object-cover transition-transform duration-700 group-hover:scale-110 will-change-transform"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent"></div>

                        <div className="relative z-10">
                            <div className="flex justify-between items-start mb-4">
                                <div className="bg-orange-500/10 p-3 rounded-xl border border-orange-500/40">
                                    <Gavel className="w-8 h-8 text-orange-500" />
                                </div>
                                <Badge className="bg-orange-500/20 text-white border-2 border-orange-400 backdrop-blur-md uppercase tracking-widest text-[10px] px-3 py-1.5">
                                    {t('coming_soon')}
                                </Badge>
                            </div>

                            <h3 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: "'Orbitron', sans-serif" }}>{t('live_auctions_title')}</h3>
                            <p className="text-gray-300 mb-6 max-w-md">{t('live_auctions_desc')}</p>

                            <Button
                                variant="outline"
                                className="border-2 border-orange-400 bg-orange-500/10 text-white hover:bg-orange-500 hover:border-orange-500 hover:text-white transition-all duration-300 font-semibold tracking-wide"
                            >
                                {t('join_waitlist')} <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                        </div>
                    </div>

                    <div className="group relative overflow-hidden rounded-3xl border-2 border-blue-500/50 h-[400px] flex flex-col justify-end p-8 transition-all hover:border-blue-400 will-change-transform">
                        <Image
                            src="/assets/c2.jpg"
                            alt="Razz Slots"
                            fill
                            loading="lazy"
                            className="object-cover transition-transform duration-700 group-hover:scale-110 will-change-transform"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent"></div>

                        <div className="relative z-10">
                            <div className="flex justify-between items-start mb-4">
                                <div className="bg-blue-500/10 p-3 rounded-xl border border-blue-500/40">
                                    <GameController className="w-8 h-8 text-blue-400" weight="fill" />
                                </div>
                                <Badge className="bg-blue-500/20 text-white border-2 border-blue-400 backdrop-blur-md uppercase tracking-widest text-[10px] px-3 py-1.5">
                                    {t('coming_soon')}
                                </Badge>
                            </div>

                            <h3 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: "'Orbitron', sans-serif" }}>{t('razz_slots_title')}</h3>
                            <p className="text-gray-300 mb-6 max-w-md">{t('razz_slots_desc')}</p>

                            <Button
                                variant="outline"
                                className="border-2 border-blue-400 bg-blue-500/10 text-white hover:bg-blue-500 hover:border-blue-500 hover:text-white transition-all duration-300 font-semibold tracking-wide"
                            >
                                {t('get_free_credits')} <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                        </div>
                    </div>

                </div>
            </div>
        </section>
    );
}
