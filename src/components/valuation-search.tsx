"use client";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocalization } from "@/context/localization-context";

export function ValuationSearch() {
    const { t } = useLocalization();

    return (
        <section className="py-16 md:py-24 relative z-20">
            <div className="container mx-auto px-4 text-center">
                <h2 className="text-3xl md:text-5xl font-bold mb-6 text-white tracking-tight" style={{ fontFamily: "'Orbitron', sans-serif" }}>
                    {t('collection_worth_title')}
                    <span className="block text-xl md:text-2xl font-normal text-orange-500 mt-2 font-sans">Real-time Market Data</span>
                </h2>

                <div className="max-w-3xl mx-auto relative mb-6 group">
                    {/* Glow effect */}
                    <div className="absolute -inset-1 bg-gradient-to-r from-orange-600 to-amber-600 rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>

                    <div className="relative flex items-center bg-black/80 rounded-full border border-white/10 p-2 shadow-2xl">
                        <Search className="h-6 w-6 text-gray-400 ml-4 absolute pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search Pokemon, Athlete Name, Set, or Year..."
                            className="w-full bg-transparent border-none text-white text-lg md:text-xl px-14 py-4 focus:outline-none placeholder:text-gray-500 font-medium"
                        />
                        <Button className="rounded-full bg-orange-500 hover:bg-orange-600 text-white font-bold px-8 py-6 h-auto hidden sm:block">
                            {t('search_cards')}
                        </Button>
                    </div>
                </div>

                <p className="text-sm md:text-base text-gray-400 max-w-xl mx-auto">
                    Access comprehensive price history from major global marketplaces including eBay, TCGPlayer, and PWCC.
                </p>
            </div>
        </section>
    );
}
