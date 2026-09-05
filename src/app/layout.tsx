import type { Metadata, Viewport } from 'next';
import { Inter, Orbitron, Quantico } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { LocalizationProvider } from '@/context/localization-context';
import { ScrollToTop } from "@/components/scroll-to-top";
import { SupabaseAuthProvider } from '@/lib/supabase';
import { AuthModal, AuthModalProvider } from '@/components/auth-modal';
import { TransactionLockProvider } from '@/components/transaction-lock-provider';
import { CurrencyProvider } from '@/contexts/currency-context';
import { CardCacheProvider } from '@/contexts/card-cache-context';
import { AuthReady } from '@/components/auth-ready';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { SubscriptionProvider } from '@/hooks/useSubscription';

const inter = Inter({
  subsets: ['latin'],
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
  weight: ['400', '500', '600', '700', '800', '900'],
});

const quantico = Quantico({
  subsets: ['latin'],
  variable: '--font-quantico',
  display: 'swap',
  preload: true,
  weight: ['400', '700'],
});

export const metadata: Metadata = {
  title: 'CardVerseHub - The Universe of Trading Cards',
  description: 'Buy, sell, bid, and razz your favorite trading cards. Discover rare Pokemon, One Piece, and Soccer cards.',
  keywords: ['trading cards', 'Pokemon cards', 'One Piece cards', 'Soccer cards', 'buy cards', 'sell cards'],
  authors: [{ name: 'CardVerseHub' }],
  icons: {
    icon: '/assets/brow-logo.png',
    apple: '/assets/brow-logo.png',
  },
  openGraph: {
    title: 'CardVerseHub - The Universe of Trading Cards',
    description: 'Buy, sell, bid, and razz your favorite trading cards.',
    type: 'website',
  },
};

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
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3779491168688544"
          crossOrigin="anonymous"
        />
      </head>
      <body className={`${inter.variable} ${orbitron.variable} ${quantico.variable} font-body antialiased`}>
        <SupabaseAuthProvider>
          <SubscriptionProvider>
          <AuthReady>
            <AuthModalProvider>
              <CurrencyProvider>
                <LocalizationProvider>
                  <TransactionLockProvider>
                    <CardCacheProvider>
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
                        {/* Grows to fill the viewport so the footer sits at the
                          * bottom on short pages, whether the page hands back a
                          * flex column of its own or a bare fragment. */}
                        <div className="flex flex-1 flex-col">
                          {children}
                        </div>
                        <Footer />
                      </div>
                    </CardCacheProvider>
                  </TransactionLockProvider>
                  <AuthModal />
                </LocalizationProvider>
              </CurrencyProvider>
            </AuthModalProvider>
          </AuthReady>
          </SubscriptionProvider>
        </SupabaseAuthProvider>
        <Toaster />
        <ScrollToTop />
      </body>
    </html>
  );
}
