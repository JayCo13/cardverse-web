"use client";

import Link from "next/link";
import Image from "next/image";
import { Facebook, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLocalization } from "@/context/localization-context";
import { useToast } from "@/hooks/use-toast";

/**
 * Zalo has no icon in either icon set the app carries, so its mark is drawn
 * here: the brand's blue rounded square with the wordmark, which is what makes
 * it recognisable at this size next to Facebook and mail.
 */
function ZaloIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-hidden focusable="false">
      <rect width="24" height="24" rx="6" fill="#0068FF" />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fill="#ffffff"
        fontSize="9"
        fontWeight="700"
        fontFamily="Arial, Helvetica, sans-serif"
      >
        Zalo
      </text>
    </svg>
  );
}

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
      key={label}
      type="button"
      onClick={handleComingSoon}
      // Wraps rather than overflows: three columns on a 360px screen leave about
      // 98px each, and a label plus its chip does not always fit on one line.
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-left text-muted-foreground transition-colors hover:text-foreground"
    >
      {label}
      <Badge variant="outline" className="h-4 shrink-0 border-orange-500/60 px-1 text-[10px] text-orange-500/90">
        {t(badgeKey)}
      </Badge>
    </button>
  );

  /**
   * Social destinations come from configuration, not from here.
   *
   * The only social URLs in the codebase were bare `facebook.com/` and
   * `zalo.me/` with no account on the end, so an icon is rendered only once its
   * destination is set — an icon that goes nowhere is worse than no icon.
   * Mail always appears: it falls back to the contact form, which works today.
   */
  const socials = [
    {
      key: 'facebook',
      href: process.env.NEXT_PUBLIC_FACEBOOK_URL,
      label: 'Facebook',
      icon: <Facebook className="h-[18px] w-[18px]" />,
      hover: 'hover:border-[#1877F2]/60 hover:text-[#1877F2]',
    },
    {
      key: 'zalo',
      href: process.env.NEXT_PUBLIC_ZALO_URL,
      label: 'Zalo',
      icon: <ZaloIcon className="h-[18px] w-[18px]" />,
      hover: 'hover:border-[#0068FF]/60',
    },
    {
      key: 'email',
      href: process.env.NEXT_PUBLIC_SUPPORT_EMAIL
        ? `mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL}`
        : '/contact',
      label: 'Email',
      icon: <Mail className="h-[18px] w-[18px]" />,
      hover: 'hover:border-red-500/60 hover:text-red-400',
    },
  ].filter((social) => !!social.href);

  /** The three link columns, identical in markup so they line up. */
  const columns = [
    {
      key: 'marketplace',
      heading: t('footer_marketplace'),
      items: [
        upcoming(t('nav_buy'), 'beta'),
        upcoming(t('nav_sell'), 'beta'),
        upcoming(t('nav_bid'), 'beta'),
        upcoming(t('nav_razz'), 'soon'),
      ],
    },
    {
      key: 'community',
      heading: t('footer_community'),
      items: [
        upcoming(t('nav_forum'), 'soon'),
        upcoming(t('footer_blog'), 'soon'),
        upcoming(t('footer_events'), 'soon'),
      ],
    },
    {
      key: 'support',
      heading: t('footer_support'),
      items: [
        <Link key="help" href="/help" className="text-muted-foreground transition-colors hover:text-foreground">{t('page_help_title')}</Link>,
        <Link key="contact" href="/contact" className="text-muted-foreground transition-colors hover:text-foreground">{t('page_contact_title')}</Link>,
        <Link key="terms" href="/terms" className="text-muted-foreground transition-colors hover:text-foreground">{t('page_terms_title')}</Link>,
        <Link key="privacy" href="/privacy" className="text-muted-foreground transition-colors hover:text-foreground">{t('page_privacy_title')}</Link>,
      ],
    },
  ];

  return (
    <footer className="border-t bg-card">
      <div className="container mx-auto px-4 py-8 md:py-10">
        {/* Brand above the columns on a phone, beside them from md. Three link
            columns on any width: at 360px that is roughly 98px each, which the
            headings and the beta chips fit into, and it keeps the three even —
            support used to be a wrapping row while the other two were lists. */}
        <div className="flex flex-col gap-8 md:flex-row md:gap-10">
          <div className="flex flex-col items-center gap-4 text-center md:w-64 md:shrink-0 md:items-start md:text-left">
            <Link href="/">
              {/* Sized to what it actually renders (220x58, not 220x220) so the
                  box does not shift once the file loads. */}
              <Image
                src="/assets/logo-verse.png"
                width={220}
                height={58}
                alt="CardVerseHub logo"
                className="h-auto w-[150px] object-contain md:w-[190px]"
              />
            </Link>
            <p className="max-w-xs font-serif text-base italic leading-relaxed tracking-wide text-muted-foreground/90 md:text-lg">
              {t('footer_tagline')}
            </p>

            {socials.length > 0 && (
              <div className="flex items-center gap-3">
                {socials.map((social) => (
                  <a
                    key={social.key}
                    href={social.href}
                    aria-label={social.label}
                    title={social.label}
                    {...(social.href!.startsWith('http')
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : {})}
                    className={`flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors ${social.hover}`}
                  >
                    {social.icon}
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="grid flex-1 grid-cols-3 gap-x-4 gap-y-6 text-sm md:gap-x-8 md:text-base">
            {columns.map((column) => (
              <div key={column.key} className="flex min-w-0 flex-col gap-3">
                <h3 className="font-semibold">{column.heading}</h3>
                {column.items}
              </div>
            ))}
          </div>
        </div>

        {/* Business name, address, tax code and the Bộ Công Thương notification
            badge belong here before launch — leaving them out rather than
            inventing them. */}
        <div className="mt-8 border-t pt-4 text-center text-xs text-muted-foreground md:text-sm">
          © {new Date().getFullYear()} CardVerseHub. {t('footer_copyright')}
        </div>
      </div>
    </footer>
  );
}
