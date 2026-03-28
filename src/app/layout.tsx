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
  icons: {
    icon: '/assets/brow-logo.png',
    apple: '/assets/brow-logo.png',
  },
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
        {/* Inline loading screen - renders before JS, fades when React hydrates */}
        <div id="__loading" style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: '#050505',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
          transition: 'opacity 0.4s ease-out',
        }}>
          <div style={{
            width: 48, height: 48,
            border: '3px solid rgba(249,115,22,0.2)',
            borderTopColor: '#f97316',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <p style={{
            color: '#f97316', fontFamily: "'Orbitron', sans-serif",
            fontSize: 14, fontWeight: 700, marginTop: 16, letterSpacing: 2,
            animation: 'pulse 1.5s ease-in-out infinite',
          }}>CARDVERSE</p>
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes spin { to { transform: rotate(360deg) } }
            @keyframes pulse { 0%,100% { opacity: 0.5 } 50% { opacity: 1 } }
          `}} />
        </div>
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var el = document.getElementById('__loading');
            if (!el) return;
            window.addEventListener('load', function() {
              setTimeout(function() {
                el.style.opacity = '0';
                setTimeout(function() { el.remove() }, 400);
              }, 200);
            });
          })();
        `}} />
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

