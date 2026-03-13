
"use client";

import Link from "next/link";
import Image from "next/image";
import { Twitter, Instagram, Facebook } from "lucide-react";
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

  return (
    <footer className="border-t bg-card">
      <div className="container mx-auto px-4 py-8">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
          <div className="flex flex-col gap-4">
            <Link
              href="/"
              className="flex items-center gap-2 text-lg font-semibold"
            >
              <Image src="/assets/logo-verse.png" width={130} height={130} alt="CardVerse logo" />
            </Link>
            <p className="text-muted-foreground">{t('footer_tagline')}</p>
            <div className="flex gap-4">
              <Link href="#" aria-label="Twitter">
                <Twitter className="h-5 w-5 text-muted-foreground hover:text-foreground transition-colors" />
              </Link>
              <Link href="#" aria-label="Instagram">
                <Instagram className="h-5 w-5 text-muted-foreground hover:text-foreground transition-colors" />
              </Link>
              <Link href="#" aria-label="Facebook">
                <Facebook className="h-5 w-5 text-muted-foreground hover:text-foreground transition-colors" />
              </Link>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="font-semibold">{t('footer_marketplace')}</h3>
            <Link href="/buy" className="text-muted-foreground hover:text-foreground transition-colors">{t('nav_buy')}</Link>
            <Link href="/sell" className="text-muted-foreground hover:text-foreground transition-colors">{t('nav_sell')}</Link>
            <Link href="/bid" className="text-muted-foreground hover:text-foreground transition-colors">{t('nav_bid')}</Link>
            <Link href="/razz" className="text-muted-foreground hover:text-foreground transition-colors">{t('nav_razz')}</Link>
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="font-semibold">{t('footer_community')}</h3>
            <Link href="/forum" className="text-muted-foreground hover:text-foreground transition-colors">{t('nav_forum')}</Link>
            <span onClick={handleComingSoon} className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">{t('footer_blog')}</span>
            <span onClick={handleComingSoon} className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">{t('footer_events')}</span>
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="font-semibold">{t('footer_support')}</h3>
            <Link href="/help" className="text-muted-foreground hover:text-foreground transition-colors">{t('page_help_title')}</Link>
            <Link href="/contact" className="text-muted-foreground hover:text-foreground transition-colors">{t('page_contact_title')}</Link>
            <Link href="/terms" className="text-muted-foreground hover:text-foreground transition-colors">{t('page_terms_title')}</Link>
            <Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">{t('page_privacy_title')}</Link>
          </div>
        </div>
        <div className="mt-8 border-t pt-4 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} CardVerse. {t('footer_copyright')}
        </div>
      </div>
    </footer>
  );
}
