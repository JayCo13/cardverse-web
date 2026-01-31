
'use client';

import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useLocalization } from '@/context/localization-context';

export default function SellPage() {
  const { t } = useLocalization();
  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold" style={{ fontFamily: "'Orbitron', sans-serif" }}>{t('sell_title')}</h1>
          <p className="text-muted-foreground">{t('sell_description')}</p>
        </div>
        <div className="max-w-2xl mx-auto p-8 rounded-lg border bg-card">
            <h2 className="text-2xl font-semibold text-center mb-6">{t('create_your_listing')}</h2>
            <div className="text-center">
                <p className="text-muted-foreground mb-6">{t('sell_cta_text')}</p>
                <Button size="lg" asChild>
                  <Link href="/sell/create">{t('start_listing')}</Link>
                </Button>
            </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
