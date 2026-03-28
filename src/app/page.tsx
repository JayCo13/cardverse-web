"use client";

import dynamic from 'next/dynamic';
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { HeroSection } from "@/components/hero-section";
import { MarketTicker } from "@/components/market-ticker";
const MarketSpotlight = dynamic(() => import("@/components/market-spotlight").then(mod => ({ default: mod.MarketSpotlight })), {
  loading: () => <div className="w-full h-[500px] flex items-center justify-center"><div className="w-full max-w-7xl mx-auto px-4"><Skeleton className="h-[400px] w-full rounded-2xl" /></div></div>
});
import { FeatureTeasers } from "@/components/feature-teasers";
import { SupportSection } from "@/components/support-section";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { useLocalization } from "@/context/localization-context";

const PopularCards = dynamic(() => import("@/components/popular-cards"), {
  loading: () => <div className="w-full h-[400px] flex items-center justify-center"><div className="w-full max-w-7xl mx-auto px-4 space-y-4"><Skeleton className="h-[200px] w-full" /><div className="grid grid-cols-2 md:grid-cols-4 gap-4"><Skeleton className="h-[300px] w-full" /><Skeleton className="h-[300px] w-full" /><Skeleton className="h-[300px] w-full" /><Skeleton className="h-[300px] w-full" /></div></div></div>
});

const SoccerCards = dynamic(() => import("@/components/soccer-cards"), {
  loading: () => <div className="w-full h-[400px] flex items-center justify-center"><div className="w-full max-w-7xl mx-auto px-4"><Skeleton className="h-[200px] w-full" /><div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4"><Skeleton className="h-[300px] w-full" /><Skeleton className="h-[300px] w-full" /><Skeleton className="h-[300px] w-full" /><Skeleton className="h-[300px] w-full" /></div></div></div>
});

const OnePieceCards = dynamic(() => import("@/components/onepiece-cards"), {
  loading: () => <div className="w-full h-[400px] flex items-center justify-center"><div className="w-full max-w-7xl mx-auto px-4"><Skeleton className="h-[200px] w-full" /><div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4"><Skeleton className="h-[300px] w-full" /><Skeleton className="h-[300px] w-full" /><Skeleton className="h-[300px] w-full" /><Skeleton className="h-[300px] w-full" /></div></div></div>
});

const PokemonCards = dynamic(() => import("@/components/pokemon-cards"), {
  loading: () => <div className="w-full h-[400px] flex items-center justify-center"><div className="w-full max-w-7xl mx-auto px-4"><Skeleton className="h-[200px] w-full" /><div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4"><Skeleton className="h-[300px] w-full" /><Skeleton className="h-[300px] w-full" /><Skeleton className="h-[300px] w-full" /><Skeleton className="h-[300px] w-full" /></div></div></div>
});

function ComingSoonToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useLocalization();

  useEffect(() => {
    // Show "Coming Soon" toast if redirected from a beta feature route
    if (searchParams.get('beta') === 'true') {
      toast({
        description: t('coming_soon'),
        duration: 4000,
      });
      // Clean up URL without triggering a full page reload
      router.replace('/', { scroll: false });
    }
  }, [searchParams, router, toast, t]);

  return null;
}

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-[#050505]">
      <Suspense fallback={null}>
        <ComingSoonToast />
      </Suspense>
      <Header />
      <main className="flex-1">
        <HeroSection />
        <MarketTicker />
        <MarketSpotlight />

        <div className="relative galaxy-bg pb-20">
          <div className="stars-bg"></div>
          <div className="stars-md"></div>
          <div className="stars-sm"></div>

          <div style={{ animationDelay: '300ms' }} className="animate-fade-in-up relative z-10">
            <FeatureTeasers />
          </div>

          <div style={{ animationDelay: '400ms' }} className="animate-fade-in-up relative z-10">
            <PopularCards />
          </div>

          <div id="soccer" style={{ animationDelay: '500ms' }} className="animate-fade-in-up relative z-10 scroll-mt-20">
            <SoccerCards />
          </div>

          <div id="pokemon" style={{ animationDelay: '600ms' }} className="animate-fade-in-up relative z-10 scroll-mt-20">
            <PokemonCards />
          </div>

          <div id="onepiece" style={{ animationDelay: '700ms' }} className="animate-fade-in-up relative z-10 scroll-mt-20">
            <OnePieceCards />
          </div>

          <div style={{ animationDelay: '800ms' }} className="animate-fade-in-up relative z-10 scroll-mt-20">
            <SupportSection />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
