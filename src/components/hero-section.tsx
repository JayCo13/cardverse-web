"use client";

import React from 'react';
import { useVisibleCycle } from '@/hooks/use-visible-cycle';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, Storefront, Handshake, ShieldCheck } from '@phosphor-icons/react';
import { useLocalization } from '@/context/localization-context';
import { PlaceHolderImages } from '@/lib/placeholder-images';

// Tiny 8x8 blur placeholders generated for each hero image
const BLUR_PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAMklEQVQI12NwdHZh+P+fgYGBwdHZhcHR2YXh/38GBgZGBkcnZwZHJ2eG//8ZGBgYHZ1dAFP8Dq94hkmuAAAAAElFTkSuQmCC';

export function HeroSection() {
  const { t } = useLocalization();
  const [activeIndex, setActiveIndex] = React.useState(1);

  const images = [
    { ...PlaceHolderImages.find(p => p.id === 'hero-3'), id: 'hero-3' }, // Left
    { ...PlaceHolderImages.find(p => p.id === 'hero-2'), id: 'hero-2' }, // Center
    { ...PlaceHolderImages.find(p => p.id === 'hero-1'), id: 'hero-1' }, // Right
  ].filter(Boolean); // Ensure strictly defined images

  const getCardStyle = (index: number) => {
    // Calculate relative position: 0 (active), 1 (right), -1 (left)
    // For 3 items: 
    // If active is 0: 0->0, 1->1 (right), 2->-1 (left)
    // If active is 1: 0->-1 (left), 1->0, 2->1 (right)
    // If active is 2: 0->1 (right), 1->-1 (left), 2->0

    let diff = (index - activeIndex);
    // Adjust for circular wraparound
    if (diff > 1) diff -= 3;
    if (diff < -1) diff += 3;

    // The fan's spread, scale and tilt come from CSS variables the container
    // sets per breakpoint. On a 320px screen the desktop values (60% offset,
    // 15deg tilt) push the side cards past the viewport edge and they get
    // clipped by the section's overflow-hidden — hence the tighter mobile set.
    if (diff === 0) {
      // Center (Active)
      return {
        zIndex: 30,
        transform: 'translateX(0) scale(var(--fan-center-scale))',
        opacity: 1,
        filter: 'brightness(1.1)'
      };
    } else if (diff === -1) {
      // Left
      return {
        zIndex: 20,
        transform: 'translateX(calc(-1 * var(--fan-x))) scale(var(--fan-scale)) rotate(calc(-1 * var(--fan-rot)))',
        opacity: 0.9,
        filter: 'brightness(0.7)'
      };
    } else {
      // Right (diff === 1)
      return {
        zIndex: 20,
        transform: 'translateX(var(--fan-x)) scale(var(--fan-scale)) rotate(var(--fan-rot))',
        opacity: 0.9,
        filter: 'brightness(0.7)'
      };
    }
  };

  // Auto-cycle images
  const cycleRef = useVisibleCycle<HTMLDivElement>(() => setActiveIndex(prev => (prev + 1) % 3), 4000);

  return (
    <div ref={cycleRef} className="relative w-full py-14 md:py-0 md:h-[80vh] md:min-h-[600px] background-grid-scan flex flex-col justify-center overflow-hidden">
      {/* Background Gradient - adjusted to be more transparent at top/center to show grid */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/60 to-background z-10 pointer-events-none" />

      {/* Radial gradient to highlight the center */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-orange-500/10 via-transparent to-transparent z-10 pointer-events-none" />

      <div className="relative container mx-auto px-4 flex items-center z-20">
        <div className="grid md:grid-cols-2 gap-10 md:gap-8 items-center w-full">
          <div className="max-w-2xl animate-fade-in-up space-y-5 md:space-y-6 text-left will-change-transform">
            <h1
              className="text-3xl sm:text-4xl md:text-6xl font-extrabold !leading-tight tracking-tighter uppercase glitch-text"
              style={{ fontFamily: "'Orbitron', sans-serif" }}
              data-text="CardVerseHub"
            >
              CardVerseHub
            </h1>
            <div className="space-y-2 text-sm sm:text-base md:text-lg text-white/80 uppercase tracking-wide sm:tracking-widest">
              <p>{t('hero_subtitle_1')}</p>
              <p className="flex items-center gap-2">
                <Storefront className="h-5 w-5 shrink-0 text-highlight" />
                <span className="text-highlight">{t('hero_subtitle_2')}</span>
              </p>
              <p className="flex items-center gap-2">
                <Handshake className="h-5 w-5 shrink-0 text-highlight" />
                <span className="text-highlight">{t('hero_subtitle_3')}</span>
              </p>
              <p className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 shrink-0 text-highlight" weight="fill" />
                <span className="text-highlight">{t('hero_subtitle_4')}</span>
              </p>
              <p>{t('hero_subtitle_5')}</p>
            </div>
            {/* The marketplace is the primary action now; the collection keeps
                a place beside it because that page works for every visitor,
                where /buy is still behind the beta curtain in middleware. */}
            <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:gap-4">
              <Link href="/buy" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white border-none font-bold text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6 h-auto shadow-[0_0_15px_rgba(249,115,22,0.5)] hover:shadow-[0_0_25px_rgba(249,115,22,0.7)] transition-all duration-300 transform hover:scale-105 rounded-full sm:w-auto"
                >
                  {t('explore_community')}
                  <div className="ml-2 bg-white/20 text-white rounded-full p-1">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </Button>
              </Link>
              <Link href="/collection" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full border-white/25 bg-white/5 text-white font-semibold text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6 h-auto rounded-full transition-all duration-300 hover:bg-white/10 hover:text-white sm:w-auto"
                >
                  {t('hero_secondary_cta')}
                </Button>
              </Link>
            </div>
          </div>

          {/* Interactive Card Fan */}
          <div
            className="relative h-[240px] sm:h-[300px] md:h-[500px] w-full flex items-center justify-center animate-fade-in-up will-change-transform [--fan-x:44%] [--fan-scale:0.82] [--fan-rot:12deg] [--fan-center-scale:1.05] sm:[--fan-x:52%] sm:[--fan-scale:0.86] sm:[--fan-rot:14deg] md:[--fan-x:60%] md:[--fan-scale:0.9] md:[--fan-rot:15deg] md:[--fan-center-scale:1.1]"
            style={{ animationDelay: '200ms' }}
          >
            {images.map((img, index) => {
              if (!img) return null;
              const style = getCardStyle(index);
              const isActive = index === activeIndex;

              return (
                <div
                  key={img.id}
                  onClick={() => setActiveIndex(index)}
                  className={`absolute w-[136px] h-[190px] sm:w-[160px] sm:h-[224px] md:w-[260px] md:h-[364px] rounded-2xl overflow-hidden shadow-2xl transition-all duration-500 ease-out cursor-pointer will-change-transform ${isActive ? 'hover:scale-115' : 'hover:scale-95'}`}
                  style={{
                    ...style,
                    zIndex: style.zIndex // Explicitly set zIndex
                  }}
                >
                  <Image
                    src={img.id === 'hero-3' ? "/assets/imgmain3.jpg" : img.id === 'hero-2' ? "/assets/imgmain2.webp" : "/assets/imgmain.webp"}
                    alt={img.description || "Hero Card"}
                    data-ai-hint={img.imageHint}
                    fill
                    priority
                    sizes="(max-width: 639px) 136px, (max-width: 767px) 160px, 260px"
                    placeholder="blur"
                    blurDataURL={BLUR_PLACEHOLDER}
                    className={`object-cover rounded-2xl transition-all duration-500 ${isActive ? 'border-[4px] border-white/20' : 'border-[2px] border-white/10 grayscale-[0.3]'}`}
                  />
                  {/* Highlight overlay for inactive cards */}
                  {!isActive && (
                    <div className="absolute inset-0 bg-black/20 hover:bg-transparent transition-colors duration-300" />
                  )}
                  {/* Shine effect for active card */}
                  {isActive && (
                    <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/10 to-white/0 opacity-0 hover:opacity-100 transition-opacity duration-500" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
