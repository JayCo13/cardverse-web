
"use client";

import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, Tag, Ticket, Lightning } from '@phosphor-icons/react';
import { useLocalization } from '@/context/localization-context';
import { PlaceHolderImages } from '@/lib/placeholder-images';

export function HeroSection() {
  const { t } = useLocalization();

  const mainImage1 = PlaceHolderImages.find(p => p.id === 'hero-1');
  const mainImage2 = PlaceHolderImages.find(p => p.id === 'hero-2');
  const mainImage3 = PlaceHolderImages.find(p => p.id === 'hero-3');


  return (
    <div className="relative w-full h-[80vh] min-h-[600px] background-grid-scan">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background/80 to-transparent z-10" />

      <div className="absolute inset-0 container mx-auto px-4 flex items-center z-20">
        <div className="grid md:grid-cols-2 gap-8 items-center w-full">
          <div className="max-w-2xl animate-fade-in-up space-y-6 text-left will-change-transform">
            <h1
              className="text-5xl md:text-7xl font-extrabold !leading-tight tracking-tighter uppercase glitch-text"
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
            <div className="pt-4">
              <Button
                asChild
                size="lg"
                className="bg-orange-500 hover:bg-orange-600 text-white border-none font-bold text-lg px-8 py-6 h-auto shadow-[0_0_15px_rgba(249,115,22,0.5)] hover:shadow-[0_0_25px_rgba(249,115,22,0.7)] transition-all duration-300 transform hover:scale-105"
              >
                <Link href="/buy">
                  {t('hero_cta')}
                  <div className="ml-2 bg-white/90 text-black rounded-full p-1">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </Link>
              </Button>
            </div>
          </div>
          <div className="relative h-[500px] w-full hidden md:flex items-center justify-center animate-fade-in-up will-change-transform" style={{ animationDelay: '200ms', transform: 'translateY(-40px)' }}>
            {mainImage3 && <div
              className="absolute w-[250px] h-[350px] rounded-2xl overflow-hidden shadow-2xl transition-transform duration-300 hover:rotate-[-5deg] hover:scale-105 will-change-transform"
              style={{ transform: 'rotate(-10deg) translate(80px, -80px)', zIndex: 10 }}
            >
              <Image
                src="/assets/imgmain3.jpg"
                alt={mainImage3.description}
                data-ai-hint={mainImage3.imageHint}
                fill
                loading="lazy"
                className="object-cover rounded-2xl"
              />
            </div>}
            {mainImage2 && <div
              className="absolute w-[250px] h-[350px] rounded-2xl overflow-hidden shadow-2xl transition-transform duration-300 hover:rotate-[10deg] hover:scale-105 will-change-transform"
              style={{ transform: 'rotate(5deg) translate(-120px, 20px)', zIndex: 20 }}
            >
              <Image
                src="/assets/imgmain2.jpg"
                alt={mainImage2.description}
                data-ai-hint={mainImage2.imageHint}
                fill
                priority
                className="object-cover rounded-2xl"
              />
            </div>}
            {mainImage1 && <div
              className="absolute w-[250px] h-[350px] rounded-2xl overflow-hidden shadow-2xl transition-transform duration-300 hover:rotate-[20deg] hover:scale-105 will-change-transform"
              style={{ transform: 'rotate(15deg) translate(150px, 60px)', zIndex: 30 }}
            >
              <Image
                src="/assets/imgmain.jpg"
                alt={mainImage1.description}
                data-ai-hint={mainImage1.imageHint}
                fill
                priority
                className="object-cover rounded-2xl"
              />
            </div>}
          </div>
        </div>
      </div>
    </div>
  );
}
