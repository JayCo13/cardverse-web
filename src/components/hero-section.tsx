'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
import { Storefront, Handshake, ShieldCheck, Truck } from '@phosphor-icons/react';
import { useLocalization } from '@/context/localization-context';
import { homeAnnouncements, type HomeAnnouncement } from '@/lib/home-announcements';
import { AnnouncementActions } from '@/components/announcements/announcement-actions';

const slides = homeAnnouncements.filter(item => item.enabled).sort((a, b) => a.order - b.order);

// Tiny 8x8 blur placeholder shown while the card images stream in.
const BLUR_PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAMklEQVQI12NwdHZh+P+fgYGBwdHZhcHR2YXh/38GBgZGBkcnZwZHJ2eG//8ZGBgYHZ1dAFP8Dq94hkmuAAAAAElFTkSuQmCC';

// Only keyboard focus pauses the slideshow; a mouse click on a control should not stall it.
// Older Safari throws on the unknown pseudo-class, in which case any focus counts.
function keyboardFocus(target: Element) {
  try { return target.matches(':focus-visible'); } catch { return true; }
}

const badgeIcons = { storefront: Storefront, shield: ShieldCheck, truck: Truck, handshake: Handshake };
// Offsets sit just past the laptop's edges, like sticky notes pinned around it.
// On phones the box is narrow, so badges hug the corners and overlap the laptop's edge like the reference mockup.
const badgePositions = {
  tl: 'left-0 top-0 sm:top-[6%]', tr: 'right-0 top-[10%] sm:top-[2%] [animation-delay:1.3s]',
  bl: 'left-0 bottom-[6%] sm:left-[2%] sm:bottom-[18%] [animation-delay:2.6s]', br: 'right-0 bottom-[2%] sm:right-[4%] sm:bottom-[10%] [animation-delay:0.7s]',
};

function HeroBadge({ label, icon, position }: NonNullable<HomeAnnouncement['badges']>[number]) {
  const { t } = useLocalization();
  const Icon = badgeIcons[icon];
  return <div className={`absolute z-20 flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur-md motion-safe:animate-hero-float sm:gap-2 sm:rounded-2xl sm:px-4 sm:py-2.5 sm:text-sm ${badgePositions[position]}`}>
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-orange-300 sm:h-7 sm:w-7"><Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" weight="fill" /></span>
    <span className="whitespace-nowrap">{t(label)}</span>
  </div>;
}

export function HeroSection() {
  const { t } = useLocalization();
  const root = useRef<HTMLElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const focusNextSlide = useRef(false);
  const [selected, setSelected] = useState(0);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [reduced, setReduced] = useState(true);
  const autoplay = useMemo(() => Autoplay({ delay: 5000, playOnInit: false, stopOnInteraction: true, stopOnFocusIn: false }), []);
  const [viewport, api] = useEmblaCarousel({ loop: slides.length > 1, duration: reduced ? 0 : 25, watchFocus: false }, [autoplay]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(media.matches);
    const visibility = () => setHidden(document.hidden);
    motion();
    visibility();
    media.addEventListener('change', motion);
    document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.1 });
    if (root.current) observer.observe(root.current);
    return () => {
      media.removeEventListener('change', motion);
      document.removeEventListener('visibilitychange', visibility);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!api) return;
    const select = () => setSelected(api.selectedScrollSnap());
    select();
    api.on('select', select).on('reInit', select);
    return () => { api.off('select', select).off('reInit', select); };
  }, [api]);

  // After a keyboard navigation the old slide turns inert, which would drop focus to <body>.
  // Move focus onto the new slide before the browser's focus fixup runs so it stays inside the region.
  useLayoutEffect(() => {
    if (!focusNextSlide.current) return;
    focusNextSlide.current = false;
    slideRefs.current[selected]?.focus({ preventScroll: true });
  }, [selected]);

  const running = slides.length > 1 && !reduced;
  useEffect(() => {
    if (!api || slides.length < 2) return;
    const sync = () => {
      const plugin = api.plugins().autoplay;
      if (running && visible && !hidden && !focused) plugin?.play();
      else plugin?.stop();
    };
    sync();
    // Restart the five-second interval after dragging, subject to visibility/focus guards.
    api.on('reInit', sync).on('pointerUp', sync);
    return () => { api.off('reInit', sync).off('pointerUp', sync); api.plugins().autoplay?.stop(); };
  }, [api, running, visible, hidden, focused]);

  function navigate(index: number, viaKeyboard = false) {
    if (viaKeyboard && root.current?.contains(document.activeElement)) focusNextSlide.current = true;
    api?.scrollTo(index, reduced);
    api?.plugins().autoplay?.reset();
  }

  if (!slides.length) return null;
  return <section ref={root} role="region" aria-roledescription="carousel" aria-label={t('hero_carousel')}
    onFocusCapture={event => setFocused(keyboardFocus(event.target))}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onKeyDown={event => {
      if (slides.length < 2 || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      navigate(selected + (event.key === 'ArrowLeft' ? -1 : 1), true);
    }}
    className="relative overflow-hidden bg-[#050505] background-grid-scan before:pointer-events-none after:pointer-events-none motion-reduce:before:animate-none motion-reduce:after:animate-none">
    <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-transparent via-background/60 to-background" />
    <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(circle_at_center,rgba(249,115,22,0.1),transparent)]" />
    <div ref={viewport} className="relative z-10 overflow-hidden touch-pan-y">
      <div className="flex items-stretch">
        {slides.map((slide, index) => {
          // A single <h1> per page: the first slide owns it, the rest are section headings.
          const Heading = index === 0 ? 'h1' : 'h2';
          return <div key={slide.id} ref={el => { slideRefs.current[index] = el; }} role="group" aria-roledescription="slide" tabIndex={-1}
            aria-label={`${t('hero_slide')} ${index + 1} / ${slides.length}`} aria-hidden={selected !== index} inert={selected !== index}
            className="relative min-w-0 flex-[0_0_100%] outline-none">
            <div className="container mx-auto grid h-full items-center gap-5 px-4 pb-4 pt-10 lg:min-h-[600px] lg:grid-cols-2 lg:gap-10 lg:py-12">
              <div className="min-w-0 space-y-5">
                <Heading className="text-[26px] min-[375px]:text-3xl sm:text-4xl lg:text-[42px] xl:text-6xl font-extrabold !leading-tight tracking-tighter uppercase glitch-text motion-reduce:animate-none motion-reduce:before:animate-none motion-reduce:after:animate-none"
                  style={{ fontFamily: "'Orbitron', sans-serif" }} data-text="CardVerseHub">
                  CardVerseHub
                </Heading>
                {slide.banner && <p className="text-base font-semibold uppercase tracking-wide text-highlight sm:text-lg lg:text-xl">{t('launch_marketplace')} {t('launch_status')}</p>}
                <div className="space-y-2 text-sm text-white/80 uppercase tracking-wide sm:text-base sm:tracking-widest lg:text-lg">
                  {slide.description.map((key, i) => {
                    const Icon = slide.title === 'CardVerseHub' ? [null, Storefront, Handshake, ShieldCheck][i] : null;
                    return <p key={key} className={Icon ? 'flex items-center gap-2 text-highlight' : undefined}>
                      {Icon && <Icon className="h-5 w-5 shrink-0" weight={i === 3 ? 'fill' : 'regular'} />}
                      <span>{t(key)}</span>
                    </p>;
                  })}
                </div>
                <AnnouncementActions announcement={slide} hero />
              </div>
              <div className={`relative flex w-full items-center justify-center ${slide.illustration ? 'h-[300px] sm:h-[340px] lg:mx-6 lg:h-[500px] xl:h-[560px]' : 'h-[230px] sm:h-[290px] lg:h-[440px]'}`} aria-hidden="true">
                {slide.illustration ? <>
                  {/* Soft orange glow so the mockup sits on the dark grid instead of floating over it. */}
                  <div className="pointer-events-none absolute inset-[10%] rounded-full bg-[radial-gradient(circle_at_center,rgba(249,115,22,0.28),transparent_65%)] blur-2xl" />
                  <Image src={slide.illustration} alt="" fill priority={index === 0}
                    sizes="(min-width: 1280px) 560px, (min-width: 1024px) 50vw, 100vw" className="object-contain drop-shadow-[0_24px_48px_rgba(0,0,0,0.6)]" />
                  {slide.badges?.map(badge => <HeroBadge key={badge.label} {...badge} />)}
                </> : slide.images.map((src, imageIndex) => <div key={src}
                  className="absolute h-[168px] w-[120px] overflow-hidden rounded-xl border-2 border-white/20 shadow-2xl sm:h-[224px] sm:w-[160px] lg:h-[336px] lg:w-[240px]"
                  style={{ transform: `translateX(${(imageIndex - 1) * 48}%) rotate(${(imageIndex - 1) * 13}deg) scale(${imageIndex === 1 ? 1.08 : 0.9})`, zIndex: imageIndex === 1 ? 2 : 1 }}>
                  {/* Off-screen slides are clipped by the viewport, so native lazy-load would only start
                    * once they scroll in; fetch eagerly and blur so the first autoplay tick is not blank. */}
                  <Image src={src} alt="" fill priority={index === 0} loading={index === 0 ? undefined : 'eager'}
                    placeholder="blur" blurDataURL={BLUR_PLACEHOLDER}
                    sizes="(min-width: 1024px) 240px, (min-width: 640px) 160px, 120px" className="object-cover" />
                </div>)}
              </div>
            </div>
          </div>;
        })}
      </div>
    </div>
  </section>;
}
