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
    ArrowLeft, Plus, Check,
    Package, Tag, Star, Loader2, Trophy, Medal, ExternalLink
} from "lucide-react";
import Image from "next/image";
import { useCurrency } from "@/contexts/currency-context";
import { useLocalization } from "@/context/localization-context";

interface SoccerCardData {
    id: string;
    name: string;
    image_url: string | null;
    price: number;
    category: string;
    year: string | null;
    grader: string | null;
    grade: string | null;
    set_name: string | null;
    player_name: string | null;
    ebay_id: string;
}

export default function SoccerCardDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const supabase = useSupabase();
    const { user } = useUser();
    const { setOpen: setAuthModalOpen } = useAuthModal();

    const [card, setCard] = useState<SoccerCardData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isAddingToCollection, setIsAddingToCollection] = useState(false);
    const [addedToCollection, setAddedToCollection] = useState(false);

    const { formatPrice, currency } = useCurrency();
    const { t } = useLocalization();

    // Get grader color
    const getGraderColor = (grader: string | null) => {
        switch (grader?.toUpperCase()) {
            case 'PSA': return 'from-red-500 to-red-600';
            case 'BGS': return 'from-blue-500 to-blue-600';
            case 'SGC': return 'from-green-500 to-green-600';
            case 'CGC': return 'from-purple-500 to-purple-600';
            default: return 'from-gray-500 to-gray-600';
        }
    };

    const getGraderBg = (grader: string | null) => {
        switch (grader?.toUpperCase()) {
            case 'PSA': return 'bg-red-500/10 border-red-500/30 text-red-400';
            case 'BGS': return 'bg-blue-500/10 border-blue-500/30 text-blue-400';
            case 'SGC': return 'bg-green-500/10 border-green-500/30 text-green-400';
            case 'CGC': return 'bg-purple-500/10 border-purple-500/30 text-purple-400';
            default: return 'bg-gray-500/10 border-gray-500/30 text-gray-400';
        }
    };

    const addToCollection = async () => {
        if (!user) {
            setAuthModalOpen(true);
            return;
        }
        if (!card) return;

        setIsAddingToCollection(true);
        try {
            const priceInUSD = currency === 'VND' ? card.price / 2 : card.price;

            const { error } = await supabase
                .from('user_collections')
                .insert({
                    user_id: user.id,
                    title: card.name,
                    image_url: card.image_url,
                    market_price: priceInUSD,
                    category: 'Soccer',
                    rarity: card.grader && card.grade ? `${card.grader} ${card.grade}` : null,
                });

            if (error) {
                if (error.code === '23505') {
                    setAddedToCollection(true);
                    setTimeout(() => setAddedToCollection(false), 3000);
                } else {
                    console.error('Failed to add to collection:', error);
                }
            } else {
                setAddedToCollection(true);
                setTimeout(() => setAddedToCollection(false), 3000);
            }
        } catch (err) {
            console.error('Error adding to collection:', err);
        } finally {
            setIsAddingToCollection(false);
        }
    };

    const handleViewOnEbay = () => {
        if (!card?.ebay_id) return;
        let cleanId = card.ebay_id;
        if (cleanId.includes('|')) {
            cleanId = cleanId.split('|')[1];
        }
        window.open(`https://www.ebay.com/itm/${cleanId}`, '_blank');
    };

    useEffect(() => {
        const fetchCard = async () => {
            let loadedCard: SoccerCardData | null = null;
            const storedCard = sessionStorage.getItem('viewingSoccerCard');
            if (storedCard) {
                try {
                    loadedCard = JSON.parse(storedCard);
                } catch (e) {
                    console.error('Error parsing stored soccer card:', e);
                }
            }

            if (!loadedCard && params.id) {
                try {
                    const { data, error } = await supabase
                        .from('crawled_cards')
                        .select('id, name, image_url, price, category, year, grader, grade, set_name, player_name, ebay_id')
                        .eq('id', params.id)
                        .single();

                    if (!error && data) {
                        loadedCard = data;
                    }
                } catch (error) {
                    // silently fail
                }
            }

            if (loadedCard) {
                setCard(loadedCard);
            }
            setIsLoading(false);
        };

        fetchCard();
    }, [params.id, supabase]);

    const displayPrice = card ? (currency === 'VND' ? card.price / 2 : card.price) : 0;

    if (isLoading) {
        return (
            <>
                <Header />
                <div className="container mx-auto px-4 py-6">
                    <Skeleton className="h-8 w-24 mb-4" />
                    <div className="flex flex-col md:flex-row gap-6">
                        <Skeleton className="w-full md:w-64 aspect-[3/4] rounded-xl" />
                        <div className="flex-1 space-y-4">
                            <Skeleton className="h-8 w-3/4" />
                            <Skeleton className="h-12 w-40" />
                            <Skeleton className="h-24 rounded-xl" />
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
                    <Trophy className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                    <h1 className="text-2xl font-bold mb-2">{t('card_not_found')}</h1>
                    <p className="text-muted-foreground mb-6">{t('card_load_error')}</p>
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
                {/* Back button */}
                <Button variant="ghost" className="mb-6 gap-2" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" /> {t('back_button')}
                </Button>

                <div className="grid lg:grid-cols-2 gap-8">
                    {/* Left: Sticky Image Container */}
                    <div className="relative">
                        <div className="sticky top-24 max-w-md mx-auto">
                            <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20">
                                {card.image_url ? (
                                    <Image src={card.image_url} alt={card.name} fill className="object-contain p-4" priority />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <Trophy className="h-24 w-24 text-green-500/30" />
                                    </div>
                                )}
                                
                                {card.year && (
                                    <Badge className="absolute top-4 left-4 bg-black/70 text-white backdrop-blur-md border-white/20">
                                        {card.year}
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right: Details & Charts */}
                    <div className="space-y-6">
                        {/* Title and Badges */}
                        <div>
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                                <Badge className="bg-green-500/10 text-green-400 border-green-500/30">
                                    <Trophy className="h-3 w-3 mr-1" /> {t('nav_soccer')}
                                </Badge>
                                {card.player_name && (
                                    <Badge variant="outline" className="border-yellow-500/30 text-yellow-400">
                                        <Star className="h-3 w-3 mr-1" /> {card.player_name}
                                    </Badge>
                                )}
                                {card.grader && card.grade && (
                                    <Badge variant="outline" className={`${getGraderBg(card.grader)}`}>
                                        <Medal className="h-3 w-3 mr-1" /> {card.grader} {card.grade}
                                    </Badge>
                                )}
                            </div>
                            <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold leading-tight">{card.name}</h1>
                            {card.set_name && (
                                <p className="text-base text-muted-foreground mt-2">{card.set_name}</p>
                            )}
                        </div>
                        {/* Price Details Grid & Actions */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Card className="bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
                                <CardContent className="p-6">
                                    <div className="flex flex-col justify-center h-full">
                                        <p className="text-sm text-muted-foreground mb-1 font-medium tracking-wide uppercase">{t('sold_price')}</p>
                                        <p className="text-4xl font-bold text-green-400 break-words">{formatPrice(displayPrice)}</p>
                                    </div>
                                </CardContent>
                            </Card>

                            <div className="flex flex-col gap-3 justify-center">
                                <Button
                                    onClick={addToCollection}
                                    disabled={isAddingToCollection}
                                    className={`w-full gap-2 h-14 text-lg transition-all ${addedToCollection ? 'bg-green-600 hover:bg-green-700' : 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500'}`}
                                >
                                    {isAddingToCollection ? (
                                        <><Loader2 className="h-5 w-5 animate-spin" /> {t('adding_to_collection')}</>
                                    ) : addedToCollection ? (
                                        <><Check className="h-5 w-5" /> {t('added_to_collection')}</>
                                    ) : (
                                        <><Plus className="h-5 w-5" /> {t('add_to_collection')}</>
                                    )}
                                </Button>
                                
                                <Button
                                    onClick={handleViewOnEbay}
                                    variant="outline"
                                    className="w-full gap-2 h-12 border-green-500/40 text-green-400 hover:bg-green-500/10"
                                >
                                    {t('view_on_ebay')} <ExternalLink className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        {/* Card Metadata Grid */}
                        <Card className="border-white/10">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Medal className="h-5 w-5 text-green-400" /> {t('card_details_title')}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0">
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    {card.player_name && (
                                        <div className="bg-white/5 rounded-xl p-4 transition-colors hover:bg-white/10">
                                            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{t('player_label')}</p>
                                            <p className="font-semibold text-yellow-400 text-sm">{card.player_name}</p>
                                        </div>
                                    )}
                                    {card.year && (
                                        <div className="bg-white/5 rounded-xl p-4 transition-colors hover:bg-white/10">
                                            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{t('year_label')}</p>
                                            <p className="font-semibold text-sm">{card.year}</p>
                                        </div>
                                    )}
                                    {card.grader && card.grade && (
                                        <div className="bg-white/5 rounded-xl p-4 transition-colors hover:bg-white/10">
                                            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{t('grade_label')}</p>
                                            <p className="font-semibold text-sm">
                                                <span className="text-muted-foreground mr-1">{card.grader}</span> 
                                                <span className="text-green-400">{card.grade}</span>
                                            </p>
                                        </div>
                                    )}
                                    <div className="bg-white/5 rounded-xl p-4 transition-colors hover:bg-white/10">
                                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{t('category_label')}</p>
                                        <p className="font-semibold text-sm">{card.category || t('nav_soccer')}</p>
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

