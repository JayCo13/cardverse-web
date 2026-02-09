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

// Force dynamic rendering for all pages - prevents static export errors
export const dynamic = 'force-dynamic';

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
  title: 'CardVerse - The Universe of Trading Cards',
  description: 'Buy, sell, bid, and razz your favorite trading cards. Discover rare Pokemon, One Piece, and Soccer cards.',
  keywords: ['trading cards', 'Pokemon cards', 'One Piece cards', 'Soccer cards', 'buy cards', 'sell cards'],
  authors: [{ name: 'CardVerse' }],
  openGraph: {
    title: 'CardVerse - The Universe of Trading Cards',
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
      <body className={`${inter.variable} ${orbitron.variable} ${quantico.variable} font-body antialiased`}>
        <SupabaseAuthProvider>
          <AuthModalProvider>
            <CurrencyProvider>
              <LocalizationProvider>
                <TransactionLockProvider>
                  <CardCacheProvider>
                    {children}
                  </CardCacheProvider>
                </TransactionLockProvider>
                <AuthModal />
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

