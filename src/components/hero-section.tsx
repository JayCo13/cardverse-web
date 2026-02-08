"use client";

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, Tag, Ticket, Lightning } from '@phosphor-icons/react';
import { useLocalization } from '@/context/localization-context';
import { PlaceHolderImages } from '@/lib/placeholder-images';

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

    if (diff === 0) {
      // Center (Active)
      return {
        zIndex: 30,
        transform: 'translateX(0) scale(1.1)',
        opacity: 1,
        filter: 'brightness(1.1)'
      };
    } else if (diff === -1) {
      // Left
      return {
        zIndex: 20,
        transform: 'translateX(-60%) scale(0.9) rotate(-15deg)',
        opacity: 0.9,
        filter: 'brightness(0.7)'
      };
    } else {
      // Right (diff === 1)
      return {
        zIndex: 20,
        transform: 'translateX(60%) scale(0.9) rotate(15deg)',
        opacity: 0.9,
        filter: 'brightness(0.7)'
      };
    }
  };

  // Auto-cycle images
  React.useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % 3);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative w-full min-h-[750px] md:h-[80vh] md:min-h-[600px] background-grid-scan flex flex-col justify-center overflow-hidden">
      {/* Background Gradient - adjusted to be more transparent at top/center to show grid */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/60 to-background z-10 pointer-events-none" />

      {/* Radial gradient to highlight the center */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-orange-500/10 via-transparent to-transparent z-10 pointer-events-none" />

      <div className="absolute inset-0 container mx-auto px-4 flex items-center z-20">
        <div className="grid md:grid-cols-2 gap-6 md:gap-8 items-center w-full py-12 md:py-0">
          <div className="max-w-2xl animate-fade-in-up space-y-6 text-left will-change-transform">
            <h1
              className="text-4xl sm:text-5xl md:text-7xl font-extrabold !leading-tight tracking-tighter uppercase glitch-text"
              style={{ fontFamily: "'Orbitron', sans-serif" }}
              data-text="CardVerse"
            >
              CardVerse
            </h1>
            <div className="space-y-2 text-base md:text-lg text-white/80 uppercase tracking-widest">
              <p>{t('hero_subtitle_1')}</p>
              <p className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-highlight" />
                <span className="text-highlight">{t('hero_subtitle_2')}</span>
              </p>
              <p className="flex items-center gap-2">
                <Ticket className="h-5 w-5 text-highlight" />
                <span className="text-highlight">{t('hero_subtitle_3')}</span>
              </p>
              <p className="flex items-center gap-2">
                <Lightning className="h-5 w-5 text-highlight" weight="fill" />
                <span className="text-highlight">{t('hero_subtitle_4')}</span>
              </p>
              <p>{t('hero_subtitle_5')}</p>
            </div>
            <div className="pt-4 flex gap-4">
              <Link href="/forum">
                <Button
                  size="lg"
                  className="bg-orange-500 hover:bg-orange-600 text-white border-none font-bold text-lg px-8 py-6 h-auto shadow-[0_0_15px_rgba(249,115,22,0.5)] hover:shadow-[0_0_25px_rgba(249,115,22,0.7)] transition-all duration-300 transform hover:scale-105 rounded-full"
                >
                  {t('explore_community')}
                  <div className="ml-2 bg-white/20 text-white rounded-full p-1">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </Button>
              </Link>
            </div>
          </div>

          {/* Interactive Card Fan */}
          <div className="relative h-[300px] md:h-[500px] w-full flex items-center justify-center animate-fade-in-up will-change-transform mt-0 md:mt-0" style={{ animationDelay: '200ms' }}>
            {images.map((img, index) => {
              if (!img) return null;
              const style = getCardStyle(index);
              const isActive = index === activeIndex;

              return (
                <div
                  key={img.id}
                  onClick={() => setActiveIndex(index)}
                  className={`absolute w-[160px] h-[224px] md:w-[260px] md:h-[364px] rounded-2xl overflow-hidden shadow-2xl transition-all duration-500 ease-out cursor-pointer will-change-transform ${isActive ? 'hover:scale-115' : 'hover:scale-95'}`}
                  style={{
                    ...style,
                    zIndex: style.zIndex // Explicitly set zIndex
                  }}
                >
                  <Image
                    src={img.id === 'hero-3' ? "/assets/imgmain3.jpg" : img.id === 'hero-2' ? "/assets/imgmain2.jpg" : "/assets/imgmain.jpg"}
                    alt={img.description || "Hero Card"}
                    data-ai-hint={img.imageHint}
                    fill
                    priority={isActive}
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
