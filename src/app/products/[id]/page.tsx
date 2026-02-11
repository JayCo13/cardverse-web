"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSupabase, useUser } from "@/lib/supabase";
import { useAuthModal } from "@/components/auth-modal";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
    ArrowLeft, TrendingUp, TrendingDown, DollarSign, Plus, Check,
    Package, Tag, Sparkles, Star, Loader2, Medal
} from "lucide-react";
import Image from "next/image";
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import { useCurrency } from "@/contexts/currency-context";
import { useLocalization } from "@/context/localization-context";
import { PSAGradedPrices } from "@/components/psa-graded-prices";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

interface ProductCard {
    product_id: number;
    title: string;
    image_url: string | null;
    market_price: number | null;
    low_price: number | null;
    mid_price: number | null;
    high_price: number | null;
    rarity: string | null;
    category: string | null;
    number: string | null;
}

interface PriceHistory {
    date: string;
    price: number;
}

const generateMockHistory = (currentPrice: number): PriceHistory[] => {
    const days = 30;
    const history: PriceHistory[] = [];
    const now = new Date();

    for (let i = days; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const variance = (Math.random() - 0.5) * 0.1;
        const price = currentPrice * (0.9 + (i / days) * 0.1 + variance);
        history.push({
            date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            price: Math.round(price * 100) / 100
        });
    }
    return history;
};

export default function ProductDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const supabase = useSupabase();
    const { user } = useUser();
    const { setOpen: setAuthModalOpen } = useAuthModal();
    const { t } = useLocalization();

    const [card, setCard] = useState<ProductCard | null>(null);
    const [priceHistory, setPriceHistory] = useState<PriceHistory[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [priceChange, setPriceChange] = useState(0);
    const [isAddingToCollection, setIsAddingToCollection] = useState(false);
    const [addedToCollection, setAddedToCollection] = useState(false);

    // Use centralized currency formatting
    const { formatPrice } = useCurrency();

    const addToCollection = async () => {
        if (!user) {
            setAuthModalOpen(true);
            return;
        }
        if (!card) return;

        setIsAddingToCollection(true);
        try {
            await supabase.from('user_collections').upsert({
                user_id: user.id,
                title: card.title,
                image_url: card.image_url,
                market_price: card.market_price,
                low_price: card.low_price,
                high_price: card.high_price,
                mid_price: card.mid_price,
                category: card.category,
                rarity: card.rarity,
            }, { onConflict: 'user_id,title' });

            setAddedToCollection(true);
            setTimeout(() => setAddedToCollection(false), 3000);
        } catch (err) {
            console.error('Error adding to collection:', err);
        } finally {
            setIsAddingToCollection(false);
        }
    };

    useEffect(() => {
        const fetchCard = async () => {
            const storedProduct = sessionStorage.getItem('viewingProduct');
            if (storedProduct) {
                try {
                    const parsed = JSON.parse(storedProduct);
                    setCard(parsed);
                    const history = generateMockHistory(parsed.market_price || 10);
                    setPriceHistory(history);
                    if (history.length >= 2) {
                        const first = history[0].price;
                        const last = history[history.length - 1].price;
                        setPriceChange(Math.round(((last - first) / first) * 1000) / 10);
                    }
                    setIsLoading(false);
                    return;
                } catch (e) {
                    console.error('Error parsing stored product:', e);
                }
            }

            if (!params.id) {
                setIsLoading(false);
                return;
            }

            try {
                const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
                const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

                const response = await fetch(
                    `${SUPABASE_URL}/rest/v1/tcgcsv_products?product_id=eq.${params.id}&select=product_id,name,image_url,set_name,rarity,market_price,low_price,mid_price,high_price,number`,
                    { headers: { 'apikey': SUPABASE_KEY } }
                );

                if (response.ok) {
                    const [data] = await response.json();
                    if (data) {
                        const cardData = {
                            product_id: data.product_id,
                            title: data.name,
                            image_url: data.image_url,
                            market_price: data.market_price,
                            low_price: data.low_price,
                            mid_price: data.mid_price,
                            high_price: data.high_price,
                            rarity: data.rarity,
                            category: data.set_name,
                            number: data.number,
                        };
                        setCard(cardData);
                        const history = generateMockHistory(data.market_price || 10);
                        setPriceHistory(history);
                        if (history.length >= 2) {
                            const first = history[0].price;
                            const last = history[history.length - 1].price;
                            setPriceChange(Math.round(((last - first) / first) * 1000) / 10);
                        }
                    }
                }
            } catch (error) {
                console.error("Error fetching product:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchCard();
    }, [params.id]);

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
                    <h1 className="text-2xl font-bold mb-2">{t('product_not_found')}</h1>
                    <p className="text-muted-foreground mb-6">{t('product_load_error')}</p>
                    <Button onClick={() => router.push('/')}>{t('go_home')}</Button>
                </div>
                <Footer />
            </>
        );
    }

    return (
        <>
            <Header />
            <main className="container mx-auto px-4 py-8">
                <Button variant="ghost" className="mb-6 gap-2" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" /> {t('back_button')}
                </Button>

                <div className="grid lg:grid-cols-2 gap-8">
                    <div className="relative">
                        <div className="sticky top-24 max-w-md mx-auto">
                            <div className="mb-6 text-center">
                                <div className="flex flex-wrap justify-center gap-2 mb-3">
                                    {card.rarity && (
                                        <Badge className="bg-orange-500 text-white border-orange-600">
                                            <Star className="h-3 w-3 mr-1" />{card.rarity}
                                        </Badge>
                                    )}
                                    {card.category && (
                                        <Badge variant="outline"><Tag className="h-3 w-3 mr-1" />{card.category}</Badge>
                                    )}
                                </div>
                                <h1 className="text-2xl md:text-3xl font-bold">{card.title}</h1>
                            </div>
                            <div className="relative aspect-square rounded-2xl overflow-hidden bg-gradient-to-br from-primary/20 to-purple-500/20 border border-white/10">
                                {card.image_url ? (
                                    <Image src={card.image_url} alt={card.title} fill className="object-contain p-4" priority />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <Package className="h-24 w-24 text-muted-foreground" />
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                                <Button
                                    onClick={addToCollection}
                                    disabled={isAddingToCollection}
                                    className={`w-full gap-2 transition-all ${addedToCollection ? 'bg-green-600 hover:bg-green-700' : ''}`}
                                >
                                    {isAddingToCollection ? (
                                        <><Loader2 className="h-4 w-4 animate-spin" /> {t('adding_to_collection')}</>
                                    ) : addedToCollection ? (
                                        <><Check className="h-4 w-4" /> {t('added_to_collection')}</>
                                    ) : (
                                        <><Plus className="h-4 w-4" /> {t('add_to_collection')}</>
                                    )}
                                </Button>

                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button variant="outline" className="w-full gap-2 border-orange-500/20 hover:bg-orange-500/10 hover:text-orange-500">
                                            <Medal className="h-4 w-4 text-orange-500" />
                                            View PSA Grade
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-[#0a0a0a] border-white/10">
                                        <DialogHeader>
                                            <DialogTitle className="flex items-center gap-2">
                                                <Medal className="h-5 w-5 text-orange-500" />
                                                PSA Graded Prices
                                            </DialogTitle>
                                        </DialogHeader>
                                        {card.product_id && (
                                            <PSAGradedPrices
                                                productId={card.product_id}
                                                productName={card.title}
                                                isScanned={true}
                                            />
                                        )}
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">


                        <div className="grid grid-cols-2 gap-3">
                            <Card className="bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
                                <CardContent className="p-4">
                                    <p className="text-xs text-muted-foreground mb-1">{t('market_price')}</p>
                                    <p className="text-xl font-bold text-green-500 break-words">{formatPrice(card.market_price)}</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-white/5 border-white/10">
                                <CardContent className="p-4">
                                    <p className="text-xs text-muted-foreground mb-1">{t('low_price')}</p>
                                    <p className="text-xl font-bold break-words">{formatPrice(card.low_price)}</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-white/5 border-white/10">
                                <CardContent className="p-4">
                                    <p className="text-xs text-muted-foreground mb-1">{t('mid_price')}</p>
                                    <p className="text-xl font-bold break-words">{formatPrice(card.mid_price)}</p>
                                </CardContent>
                            </Card>
                            <Card className="bg-white/5 border-white/10">
                                <CardContent className="p-4">
                                    <p className="text-xs text-muted-foreground mb-1">{t('high_price')}</p>
                                    <p className="text-xl font-bold break-words">{formatPrice(card.high_price)}</p>
                                </CardContent>
                            </Card>
                        </div>

                        <Card className="border-white/10">
                            <CardHeader className="pb-2">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <TrendingUp className="h-5 w-5 text-primary" /> {t('price_history_title')}
                                    </CardTitle>
                                    <div className={`flex items-center gap-1 text-sm font-medium ${priceChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                        {priceChange >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
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
                                            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#888', fontSize: 12 }} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#888', fontSize: 12 }} tickFormatter={(v) => `$${v}`} width={60} />
                                            <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px' }} formatter={(v: number) => [`$${v.toFixed(2)}`, 'Price']} />
                                            <Area type="monotone" dataKey="price" stroke={priceChange >= 0 ? "#22c55e" : "#ef4444"} strokeWidth={2} fill="url(#priceGradient)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
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
