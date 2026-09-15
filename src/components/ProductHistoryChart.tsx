"use client";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
export default function ProductHistoryChart({ priceHistory, priceChange }: { priceChange: number; priceHistory: { date: string; price: number }[] }) {
  return (<ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={priceHistory}>
                                                <defs>
                                                    <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor={priceChange >= 0 ? "#22c55e" : "#ef4444"} stopOpacity={0.3} />
                                                        <stop offset="95%" stopColor={priceChange >= 0 ? "#22c55e" : "#ef4444"} stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#888', fontSize: 12 }} />
                                                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#888', fontSize: 12 }} tickFormatter={(v) => `$${v}`} width={60} />
                                                <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px' }} formatter={(v: number) => [`$${v.toFixed(2)}`, 'Price']} />
                                                <Area type="monotone" dataKey="price" stroke={priceChange >= 0 ? "#22c55e" : "#ef4444"} strokeWidth={2} fill="url(#priceGradient)" />
                                            </AreaChart>
                                        </ResponsiveContainer>);
}
