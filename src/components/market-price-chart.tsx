'use client';

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useCurrency } from '@/contexts/currency-context';
import { useLocalization } from '@/context/localization-context';

export function MarketPriceChart({ chartData }: { chartData: Array<{ date: string; price: number }> }) {
  const { formatPrice, convertPrice } = useCurrency();
  const { t } = useLocalization();
  return (
    <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
            <defs>
                <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
                </linearGradient>
            </defs>
            <XAxis
                dataKey="date"
                stroke="#333"
                tick={{ fill: '#666', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                dy={10}
            />
            <YAxis
                orientation="right"
                domain={['auto', 'auto']}
                stroke="#333"
                tick={{ fill: '#666', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(val) => {
                    const converted = convertPrice(val);
                    if (converted >= 1000000) return `${(converted / 1000000).toFixed(1)}M`;
                    if (converted >= 1000) return `${(converted / 1000).toFixed(0)}K`;
                    return formatPrice(val);
                }}
                dx={10}
            />
            <Tooltip
                contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '8px', color: '#fff' }}
                itemStyle={{ color: '#F97316' }}
                formatter={(value: number) => [formatPrice(value), t('price_label')]}
            />
            <Area
                type="monotone"
                dataKey="price"
                stroke="#F97316"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorPrice)"
            />
        </AreaChart>
    </ResponsiveContainer>
  );
}
