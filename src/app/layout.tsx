import { AccountRestrictionProvider } from '@/components/account-restriction-provider';
import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { buildMetadata } from '@/lib/seo/metadata';
import { LOGO_PATH, SITE_KEYWORDS, SITE_NAME } from '@/lib/seo/site';
import { JsonLd, organizationJsonLd, websiteJsonLd } from '@/lib/seo/jsonld';
import { Inter, Orbitron, Quantico } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { LocalizationProvider } from '@/context/localization-context';
import { ScrollToTop } from "@/components/scroll-to-top";
import { SupabaseAuthProvider } from '@/lib/supabase';
import { AuthModal, AuthModalProvider } from '@/components/auth-modal';
import { PageAuthGate } from '@/components/page-auth-gate';
import { TransactionLockProvider } from '@/components/transaction-lock-provider';
import { CurrencyProvider } from '@/contexts/currency-context';
import { CardCacheProvider } from '@/contexts/card-cache-context';
import { BuyerShippingQuotesProvider } from '@/components/buyer-shipping-quotes';
import { AuthReady } from '@/components/auth-ready';
import { Header } from '@/components/layout/header';
import { LaunchBanner } from '@/components/announcements/launch-banner';
import { Footer } from '@/components/layout/footer';
import { SubscriptionProvider } from '@/hooks/useSubscription';

const inter = Inter({
  // Vietnamese is the primary audience: without this subset every diacritic
  // falls back to a system font, so headings render as two mixed typefaces.
  subsets: ['latin', 'vietnamese'],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
  weight: ['400', '500', '600', '700'],
});

const orbitron = Orbitron({
  subsets: ['latin'],
  variable: '--font-orbitron',
  display: 'swap',
  preload: true,
  // 900 is loaded by nothing (no font-black on any Orbitron element); the
  // rest are: 500 font-medium, 600 CardTitle, 700 font-bold, 800 the hero h1.
  weight: ['400', '500', '600', '700', '800'],
});

const quantico = Quantico({
  subsets: ['latin'],
  variable: '--font-quantico',
  display: 'swap',
  preload: true,
  weight: ['400', '700'],
});

/**
 * Site-wide defaults. Every route overrides title/description/canonical through
 * `buildMetadata` (see `src/lib/seo/`); the values themselves live in
 * `src/lib/seo/site.ts` so the JSON-LD, `llms.txt` and the about page say the
 * same thing.
 */
export const metadata: Metadata = {
  ...buildMetadata({ path: '/' }),
  keywords: SITE_KEYWORDS,
  authors: [{ name: SITE_NAME }],
  icons: {
    icon: LOGO_PATH,
    apple: LOGO_PATH,
  },
  // Search Console can also be verified through DNS; the tag is only emitted
  // when a token is configured.
  verification: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : undefined,
};

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0a0a0a',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Vietnamese is the primary audience and the language the HTML is served
  // in; the client toggle can switch to en/ja after hydration.
  return (
    <html lang="vi" className="dark" suppressHydrationWarning>
      <head>
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3779491168688544"
          crossOrigin="anonymous"
        />
      </head>
      <body className={`${inter.variable} ${orbitron.variable} ${quantico.variable} font-body antialiased`}>
        <JsonLd data={[organizationJsonLd(), websiteJsonLd()]} />
        {GA_ID && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
            <Script id="ga4-init" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
            </Script>
          </>
        )}
        <SupabaseAuthProvider>

            <AuthModalProvider>
              <CurrencyProvider>
                <LocalizationProvider>
                  <AccountRestrictionProvider allowedContent={children}>
                  <SubscriptionProvider>
                  <TransactionLockProvider>
                    <CardCacheProvider>
                    <BuyerShippingQuotesProvider>
                      {/*
                        * Header and Footer live here, not in each page.
                        *
                        * Rendered per page they were torn down and rebuilt on
                        * every navigation, and the header is not cheap: the
                        * cart badge, the offer badge, the notification bell,
                        * the chat inbox and the subscription hook each open
                        * their own request on mount. That was five to six
                        * round trips repeated for every link the user clicked,
                        * on a path where a single round trip costs the best
                        * part of a second.
                        *
                        * Mounted once in the layout they survive navigation:
                        * the chrome stays on screen, its data is fetched once
                        * per session, and only the page body swaps.
                        */}
                      <div className="flex min-h-screen flex-col">
                        <Header />
                        <LaunchBanner />
                        {/* Grows to fill the viewport so the footer sits at the
                          * bottom on short pages, whether the page hands back a
                          * flex column of its own or a bare fragment. */}
                        <div className="flex flex-1 flex-col">
                          <AuthReady><PageAuthGate>{children}</PageAuthGate></AuthReady>
                        </div>
                        <Footer />
                      </div>
                    </BuyerShippingQuotesProvider>
                    </CardCacheProvider>
                  </TransactionLockProvider>
                  <AuthModal />
                  </SubscriptionProvider>
                  </AccountRestrictionProvider>
                </LocalizationProvider>
              </CurrencyProvider>
            </AuthModalProvider>

        </SupabaseAuthProvider>
        <Toaster />
        <ScrollToTop />
      </body>
    </html>
  );
}
