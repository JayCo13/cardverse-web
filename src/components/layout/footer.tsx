"use client";

import Link from "next/link";
import Image from "next/image";
import { Headphones } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLocalization } from "@/context/localization-context";
import { useToast } from "@/hooks/use-toast";

export function Footer() {
  const { t } = useLocalization();
  const { toast } = useToast();

  const handleComingSoon = () => {
    toast({
      description: t('coming_soon'),
      duration: 3000,
    });
  };

  /**
   * `/buy`, `/sell`, `/bid`, `/razz` and `/forum` sit behind the beta curtain in
   * `src/middleware.ts`, so a visitor who taps them is bounced to `/?beta=true`.
   * Saying "coming soon" up front beats a link that throws them back to the home
   * page. Testers still reach these pages from the header nav, which knows who
   * they are; the footer deliberately fetches nothing.
   */
  const upcoming = (label: string, badgeKey: 'beta' | 'soon') => (
    <button
      type="button"
      onClick={handleComingSoon}
      className="flex items-center gap-1.5 text-left text-muted-foreground transition-colors hover:text-foreground"
    >
      {label}
      <Badge variant="outline" className="h-4 shrink-0 border-orange-500/60 px-1 text-[10px] text-orange-500/90">
        {t(badgeKey)}
      </Badge>
    </button>
  );

  return (
    <footer className="border-t bg-card">
      <div className="container mx-auto px-4 py-6 md:py-8">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4 md:gap-8">
          <div className="col-span-2 flex flex-col items-center gap-3 text-center md:col-span-1 md:gap-4">
            <Link href="/" className="w-full">
              {/* Sized to what it actually renders (220x58, not 220x220) so the
                  box does not shift once the file loads, and left lazy: this sits
                  below the fold on every page and used to be preloaded on all 33. */}
              <Image
                src="/assets/logo-verse.png"
                width={220}
                height={58}
                alt="CardVerseHub logo"
                className="mx-auto h-auto w-[130px] object-contain md:w-[200px]"
              />
            </Link>
            <p className="hidden font-serif text-lg italic leading-relaxed tracking-wide text-muted-foreground/90 md:block">
              {t('footer_tagline')}
            </p>
            {/* The header hides this number below lg, so on a phone the footer is
                the only place a buyer can find a way to call. */}
            <a
              href="tel:+84812334511"
              className="flex items-center gap-2 text-sm font-medium transition-colors hover:text-orange-400"
            >
              <Headphones className="h-4 w-4 text-orange-400" />
              +84 812 334 511
            </a>
          </div>

          <div className="flex flex-col gap-3 text-sm md:text-base">
            <h3 className="font-semibold">{t('footer_marketplace')}</h3>
            {upcoming(t('nav_buy'), 'beta')}
            {upcoming(t('nav_sell'), 'beta')}
            {upcoming(t('nav_bid'), 'beta')}
            {upcoming(t('nav_razz'), 'soon')}
          </div>

          <div className="flex flex-col gap-3 text-sm md:text-base">
            <h3 className="font-semibold">{t('footer_community')}</h3>
            {upcoming(t('nav_forum'), 'soon')}
            {upcoming(t('footer_blog'), 'soon')}
            {upcoming(t('footer_events'), 'soon')}
          </div>

          {/* The only column that works today, and the one PayOS, AdSense and a
              wary buyer all look for. On a phone it reads as one wrapping row
              rather than a fourth stacked column. */}
          <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-2 border-t pt-4 text-sm md:col-span-1 md:flex-col md:gap-3 md:border-0 md:pt-0 md:text-base">
            <h3 className="w-full font-semibold md:w-auto">{t('footer_support')}</h3>
            <Link href="/help" className="text-muted-foreground transition-colors hover:text-foreground">{t('page_help_title')}</Link>
            <Link href="/contact" className="text-muted-foreground transition-colors hover:text-foreground">{t('page_contact_title')}</Link>
            <Link href="/terms" className="text-muted-foreground transition-colors hover:text-foreground">{t('page_terms_title')}</Link>
            <Link href="/privacy" className="text-muted-foreground transition-colors hover:text-foreground">{t('page_privacy_title')}</Link>
          </div>
        </div>

        {/* Business name, address, tax code and the Bộ Công Thương notification
            badge belong here before launch — leaving them out rather than
            inventing them. */}
        <div className="mt-6 border-t pt-4 text-center text-xs text-muted-foreground md:mt-8 md:text-sm">
          © {new Date().getFullYear()} CardVerseHub. {t('footer_copyright')}
        </div>
      </div>
    </footer>
  );
}
