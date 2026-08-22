'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { HandCoins, Tag, Package } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';
import { optimizeCloudinaryUrl } from '@/lib/cloudinary-url';
import { getCategoryCode } from '@/lib/category-code';

type SoldItem = {
  orderId: string;
  cardId: string;
  name: string;
  image: string | null;
  category: string;
  condition: string | null;
  isBundle: boolean;
  askingPrice: number;
  soldPrice: number;
  isOffer: boolean;
  soldAt: string;
};

const fmtVND = (n: number) => new Intl.NumberFormat('vi-VN').format(Number(n || 0)) + 'đ';

export default function SoldCardsPage() {
  const { locale } = useLocalization();
  const tx = (vi: string, en: string, ja: string) => (locale === 'ja-JP' ? ja : locale === 'en-US' ? en : vi);
  const [items, setItems] = useState<SoldItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/marketplace/sold', { cache: 'no-store' });
        const data = await res.json();
        if (!cancelled) setItems(data.items || []);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="container mx-auto flex-1 px-4 py-8">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-normal">
            <HandCoins className="h-7 w-7 text-orange-500" />
            {tx('Thẻ đã bán', 'Sold cards', '販売済みカード')}
          </h1>
          <p className="text-muted-foreground">
            {tx('Lịch sử giá bán và giá offer được chấp nhận trên CardVerseHub.',
               'History of sale prices and accepted offer prices on CardVerseHub.',
               'CardVerseHubでの販売価格と承認オファー価格の履歴。')}
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-72 w-full rounded-xl" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border bg-card p-12 text-center text-muted-foreground">
            {tx('Chưa có thẻ nào được bán.', 'No cards have been sold yet.', 'まだ販売されたカードはありません。')}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map(item => (
              <div key={item.orderId} className="group overflow-hidden rounded-xl border bg-card/60 transition hover:border-orange-500/40">
                <div className="relative aspect-[3/4] bg-gradient-to-br from-zinc-900 to-black">
                  {item.image && (
                    <Image src={optimizeCloudinaryUrl(item.image, 360)} alt={item.name} fill className="object-cover grayscale" />
                  )}
                  <span className="absolute left-2 top-2 rounded-md bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">
                    {getCategoryCode(item.category)}
                  </span>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2">
                    <span className="rounded bg-red-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      {tx('Đã bán', 'Sold', '販売済み')}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 p-3">
                  <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold">{item.name}</h3>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    {item.condition && <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5">{item.condition}</span>}
                    {item.isBundle && <span className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5"><Package className="h-3 w-3" />Bundle</span>}
                  </div>

                  <div className="space-y-1 border-t pt-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">{tx('Giá bán', 'Asking', '出品価格')}</span>
                      <span className={`whitespace-nowrap ${item.isOffer ? 'text-muted-foreground line-through' : 'font-semibold'}`}>{fmtVND(item.askingPrice)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        {item.isOffer ? <HandCoins className="h-3 w-3 text-orange-400" /> : <Tag className="h-3 w-3 text-orange-400" />}
                        {item.isOffer ? tx('Offer chốt', 'Offer', '成約オファー') : tx('Đã bán', 'Sold for', '販売価格')}
                      </span>
                      <span className="whitespace-nowrap text-sm font-bold text-orange-400">{fmtVND(item.soldPrice)}</span>
                    </div>
                  </div>

                  {item.isOffer && (
                    <Badge className="w-full justify-center bg-orange-500/15 text-orange-300 hover:bg-orange-500/15">
                      {tx('Bán qua offer', 'Sold via offer', 'オファーで成約')}
                    </Badge>
                  )}

                  <p className="text-[10px] text-muted-foreground">{new Date(item.soldAt).toLocaleDateString(locale)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
