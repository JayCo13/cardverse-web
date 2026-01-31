"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSupabase, useUser } from "@/lib/supabase";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
    ArrowLeft, TrendingUp, TrendingDown, DollarSign, Calendar,
    ExternalLink, Share2, Trash2, Edit, Package, Tag, Sparkles,
    Star, Shield, Zap, Heart
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart
} from "recharts";
import { useCurrency } from "@/contexts/currency-context";

// Types
interface CollectionCard {
    id: string;
    user_id: string;
    title: string;
    price: string | null;
    image_url: string | null;
    ebay_link: string | null;
    created_at: string;
    category: string | null;
    low_price: number | null;
    mid_price: number | null;
    high_price: number | null;
    market_price: number | null;
    rarity: string | null;
    album_id: string | null;
}

interface PriceHistory {
    date: string;
    price: number;
}

// Mock price history generator
const generateMockHistory = (currentPrice: number): PriceHistory[] => {
    const days = 30;
    const history: PriceHistory[] = [];
    const now = new Date();

    for (let i = days; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const variance = (Math.random() - 0.5) * 0.1; // ±5% variance
        const price = currentPrice * (0.9 + (i / days) * 0.1 + variance);
        history.push({
            date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            price: Math.round(price * 100) / 100
        });
    }
    return history;
};

export default function CardDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const supabase = useSupabase();
    const { user } = useUser();

    const [card, setCard] = useState<CollectionCard | null>(null);
    const [priceHistory, setPriceHistory] = useState<PriceHistory[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [priceChange, setPriceChange] = useState(0);

    // Use centralized currency formatting
    const { formatPrice } = useCurrency();

    // Fetch card data
    useEffect(() => {
        const fetchCard = async () => {
            if (!params.id || !user) {
                setIsLoading(false);
                return;
            }

            try {
                const { data, error } = await supabase
                    .from('user_collections')
                    .select('*')
                    .eq('id', params.id)
                    .eq('user_id', user.id)
                    .single();

                if (data && !error) {
                    const cardData = data as CollectionCard;
                    setCard(cardData);

                    // Generate mock price history based on current price
                    const currentPrice = cardData.market_price || 10;
                    const history = generateMockHistory(currentPrice);
                    setPriceHistory(history);

                    // Calculate price change
                    if (history.length >= 2) {
                        const first = history[0].price;
                        const last = history[history.length - 1].price;
                        const change = ((last - first) / first) * 100;
                        setPriceChange(Math.round(change * 10) / 10);
                    }
                }
            } catch (error) {
                console.error("Error fetching card:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchCard();
    }, [params.id, user, supabase]);

    if (isLoading) {
        return (
            <>
                <Header />
                <div className="container mx-auto px-4 py-8">
                    <Skeleton className="h-8 w-32 mb-6" />
                    <div className="grid md:grid-cols-2 gap-8">
                        <Skeleton className="aspect-[3/4] rounded-2xl" />
                        <div className="space-y-4">
                            <Skeleton className="h-10 w-3/4" />
                            <Skeleton className="h-6 w-1/2" />
                            <Skeleton className="h-64 rounded-xl" />
                        </div>
                    </div>
                </div>
                <Footer />
            </>
        );
    }

    if (!card) {
        return (
            <>
                <Header />
                <div className="container mx-auto px-4 py-16 text-center">
                    <Package className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                    <h1 className="text-2xl font-bold mb-2">Card Not Found</h1>
                    <p className="text-muted-foreground mb-6">
                        This card doesn't exist or you don't have access to it.
                    </p>
                    <Button asChild>
                        <Link href="/collection">Back to Collection</Link>
                    </Button>
                </div>
                <Footer />
            </>
        );
    }

    return (
        <>
            <Header />
            <main className="container mx-auto px-4 py-8">
                {/* Back Button */}
                <Button
                    variant="ghost"
                    className="mb-6 gap-2"
                    onClick={() => router.back()}
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Collection
                </Button>

                <div className="grid lg:grid-cols-2 gap-8">
                    {/* Card Image */}
                    <div className="relative">
                        <div className="sticky top-24">
                            <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-gradient-to-br from-primary/20 to-purple-500/20 border border-white/10">
                                {card.image_url ? (
                                    <Image
                                        src={card.image_url}
                                        alt={card.title}
                                        fill
                                        className="object-contain p-4"
                                        priority
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <Package className="h-24 w-24 text-muted-foreground" />
                                    </div>
                                )}
                            </div>

                            {/* Quick Actions */}
                            <div className="flex gap-2 mt-4">
                                {card.ebay_link && (
                                    <Button variant="outline" className="flex-1 gap-2" asChild>
                                        <a href={card.ebay_link} target="_blank" rel="noopener noreferrer">
                                            <ExternalLink className="h-4 w-4" />
                                            View on eBay
                                        </a>
                                    </Button>
                                )}
                                <Button variant="outline" size="icon">
                                    <Share2 className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="icon">
                                    <Edit className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="icon" className="text-destructive hover:bg-destructive/10">
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Card Details */}
                    <div className="space-y-6">
                        {/* Title & Badges */}
                        <div>
                            <div className="flex flex-wrap gap-2 mb-3">
                                {card.rarity && (
                                    <Badge className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 text-yellow-500 border-yellow-500/30">
                                        <Star className="h-3 w-3 mr-1" />
                                        {card.rarity}
                                    </Badge>
                                )}
                                {card.category && (
                                    <Badge variant="outline">
                                        <Tag className="h-3 w-3 mr-1" />
                                        {card.category}
                                    </Badge>
                                )}
                            </div>
                            <h1 className="text-3xl md:text-4xl font-bold mb-2">{card.title}</h1>
                            <p className="text-muted-foreground">
                                Added on {new Date(card.created_at).toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                })}
                            </p>
                        </div>

                        {/* Price Cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <Card className="bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
                                <CardContent className="p-4">
                                    <p className="text-xs text-muted-foreground mb-1">Market Price</p>
                                    <p className="text-xl font-bold text-green-500">
                                        {formatPrice(card.market_price)}
                                    </p>
                                </CardContent>
                            </Card>
                            <Card className="bg-white/5 border-white/10">
                                <CardContent className="p-4">
                                    <p className="text-xs text-muted-foreground mb-1">Low</p>
                                    <p className="text-xl font-bold">
                                        {formatPrice(card.low_price)}
                                    </p>
                                </CardContent>
                            </Card>
                            <Card className="bg-white/5 border-white/10">
                                <CardContent className="p-4">
                                    <p className="text-xs text-muted-foreground mb-1">Mid</p>
                                    <p className="text-xl font-bold">
                                        {formatPrice(card.mid_price)}
                                    </p>
                                </CardContent>
                            </Card>
                            <Card className="bg-white/5 border-white/10">
                                <CardContent className="p-4">
                                    <p className="text-xs text-muted-foreground mb-1">High</p>
                                    <p className="text-xl font-bold">
                                        {formatPrice(card.high_price)}
                                    </p>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Price Trend */}
                        <Card className="border-white/10">
                            <CardHeader className="pb-2">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <TrendingUp className="h-5 w-5 text-primary" />
                                        Price History
                                    </CardTitle>
                                    <div className={`flex items-center gap-1 text-sm font-medium ${priceChange >= 0 ? 'text-green-500' : 'text-red-500'
                                        }`}>
                                        {priceChange >= 0 ? (
                                            <TrendingUp className="h-4 w-4" />
                                        ) : (
                                            <TrendingDown className="h-4 w-4" />
                                        )}
                                        {priceChange >= 0 ? '+' : ''}{priceChange}%
                                        <span className="text-muted-foreground font-normal">30d</span>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={priceHistory}>
                                            <defs>
                                                <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={priceChange >= 0 ? "#22c55e" : "#ef4444"} stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor={priceChange >= 0 ? "#22c55e" : "#ef4444"} stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                                            <XAxis
                                                dataKey="date"
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fill: '#888', fontSize: 12 }}
                                                tickMargin={10}
                                            />
                                            <YAxis
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fill: '#888', fontSize: 12 }}
                                                tickFormatter={(value) => `$${value}`}
                                                width={60}
                                            />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: '#1a1a1a',
                                                    border: '1px solid #333',
                                                    borderRadius: '8px',
                                                    padding: '8px 12px'
                                                }}
                                                labelStyle={{ color: '#888' }}
                                                formatter={(value: number) => [`$${value.toFixed(2)}`, 'Price']}
                                            />
                                            <Area
                                                type="monotone"
                                                dataKey="price"
                                                stroke={priceChange >= 0 ? "#22c55e" : "#ef4444"}
                                                strokeWidth={2}
                                                fill="url(#priceGradient)"
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Card Stats */}
                        <Card className="border-white/10">
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Sparkles className="h-5 w-5 text-primary" />
                                    Card Information
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-3">
                                        <div>
                                            <p className="text-xs text-muted-foreground mb-1">Category</p>
                                            <p className="font-medium">{card.category || "N/A"}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground mb-1">Rarity</p>
                                            <p className="font-medium">{card.rarity || "N/A"}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground mb-1">Added</p>
                                            <p className="font-medium">
                                                {new Date(card.created_at).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        <div>
                                            <p className="text-xs text-muted-foreground mb-1">Purchase Price</p>
                                            <p className="font-medium">{card.price || "Not recorded"}</p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground mb-1">Current Value</p>
                                            <p className="font-medium text-green-500">
                                                {formatPrice(card.market_price)}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground mb-1">ROI</p>
                                            <p className={`font-medium ${priceChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                {priceChange >= 0 ? '+' : ''}{priceChange}%
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Market Analysis */}
                        <Card className="border-white/10">
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <DollarSign className="h-5 w-5 text-primary" />
                                    Market Analysis
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    <div>
                                        <div className="flex justify-between text-sm mb-2">
                                            <span className="text-muted-foreground">Price Range</span>
                                            <span>
                                                {formatPrice(card.low_price)} - {formatPrice(card.high_price)}
                                            </span>
                                        </div>
                                        <div className="relative h-2 bg-white/10 rounded-full overflow-hidden">
                                            <div
                                                className="absolute h-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500"
                                                style={{ width: '100%' }}
                                            />
                                            {card.market_price && card.low_price && card.high_price && (
                                                <div
                                                    className="absolute w-3 h-3 bg-white rounded-full -top-0.5 shadow-lg border-2 border-primary"
                                                    style={{
                                                        left: `${Math.min(100, Math.max(0, ((card.market_price - card.low_price) / (card.high_price - card.low_price)) * 100))}%`,
                                                        transform: 'translateX(-50%)'
                                                    }}
                                                />
                                            )}
                                        </div>
                                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                            <span>Low</span>
                                            <span>Market</span>
                                            <span>High</span>
                                        </div>
                                    </div>

                                    <div className="pt-4 border-t border-white/10">
                                        <p className="text-sm text-muted-foreground">
                                            {card.market_price && card.mid_price && card.market_price > card.mid_price ? (
                                                <span className="text-green-500">
                                                    ✓ Trading above mid-market price. Good time to sell.
                                                </span>
                                            ) : (
                                                <span className="text-yellow-500">
                                                    ⚡ Trading below mid-market. Consider holding.
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </main>
            <Footer />
        </>
    );
}
