'use client';

import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';
import { getSupabaseClient } from '@/lib/supabase/client';

// "Giá thị trường VN" — aggregated from real completed CardVerse sales
// (vn_market_price view: 90-day median per catalog card). Renders nothing
// until there is at least one recorded sale, so it can sit safely next to
// the eBay price for any scanned card.

type VnPriceRow = {
    sale_count: number;
    median_price: number;
    min_price: number;
    max_price: number;
    last_sold_at: string;
};

const formatVND = (amount: number) => new Intl.NumberFormat('vi-VN').format(Math.round(amount)) + 'đ';

export function VnMarketPrice({ productId, soccerId }: { productId?: number | null; soccerId?: number | null }) {
    const [row, setRow] = useState<VnPriceRow | null>(null);

    useEffect(() => {
        setRow(null);
        if (!productId && !soccerId) return;

        let cancelled = false;
        (async () => {
            try {
                const supabase = getSupabaseClient();
                let query = supabase
                    .from('vn_market_price' as never)
                    .select('sale_count, median_price, min_price, max_price, last_sold_at');
                query = productId
                    ? query.eq('catalog_product_id', productId)
                    : query.eq('catalog_soccer_id', soccerId!);
                const { data } = await query;

                if (cancelled || !data || data.length === 0) return;
                // Aggregate across grading/finish buckets into one headline number.
                const rows = data as unknown as VnPriceRow[];
                const total = rows.reduce((sum, r) => sum + Number(r.sale_count), 0);
                const weightedMedian = rows.reduce((sum, r) => sum + Number(r.median_price) * Number(r.sale_count), 0) / total;
                const lastSold = rows.map(r => r.last_sold_at).sort().pop()!;
                setRow({
                    sale_count: total,
                    median_price: weightedMedian,
                    min_price: Math.min(...rows.map(r => Number(r.min_price))),
                    max_price: Math.max(...rows.map(r => Number(r.max_price))),
                    last_sold_at: lastSold,
                });
            } catch {
                // No VN price data — render nothing.
            }
        })();
        return () => { cancelled = true; };
    }, [productId, soccerId]);

    if (!row) return null;

    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
            <span className="font-semibold text-emerald-400">🇻🇳 Giá thị trường VN: {formatVND(row.median_price)}</span>
            <span className="text-xs text-muted-foreground">
                {row.sale_count} giao dịch · {formatVND(row.min_price)}–{formatVND(row.max_price)} · cập nhật{' '}
                {formatDistanceToNow(new Date(row.last_sold_at), { addSuffix: true, locale: vi })}
            </span>
        </div>
    );
}
