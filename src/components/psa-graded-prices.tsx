"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Medal, ArrowSquareOut, TrendUp, ShoppingCart, Storefront, SpinnerGap, X, MagnifyingGlassPlus } from "@phosphor-icons/react";
import { useCurrency } from "@/contexts/currency-context";
import Image from "next/image";

interface PSACardResult {
    id: string;
    name: string;
    image_url: string | null;
    price: number;
    grader: string | null;
    grade: string | null;
    ebay_id: string | null;
    created_at: string;
}

interface PSAGradedPricesProps {
    cardNumber: string | null;
    setName: string | null;
    cardName: string;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export function PSAGradedPrices({ cardNumber, setName, cardName }: PSAGradedPricesProps) {
    const [psaCards, setPsaCards] = useState<PSACardResult[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [hasData, setHasData] = useState(false);
    const [selectedImage, setSelectedImage] = useState<{ url: string; name: string } | null>(null);
    const { formatPrice, currency } = useCurrency();

    // Get grader color
    const getGraderColor = (grader: string | null) => {
        switch (grader?.toUpperCase()) {
            case 'PSA': return 'bg-red-500 border-red-400';
            case 'BGS': return 'bg-blue-500 border-blue-400';
            case 'SGC': return 'bg-green-600 border-green-500';
            case 'CGC': return 'bg-purple-500 border-purple-400';
            default: return 'bg-gray-500 border-gray-400';
        }
    };

    // Upgrade eBay thumbnail URL to high resolution
    const getHighResImageUrl = (url: string | null) => {
        if (!url) return null;
        // eBay images often have size suffixes like s-l300, s-l500, s-l1600
        return url.replace(/s-l\d+/, 's-l1600').replace(/\$_\d+/, '$_57');
    };

    useEffect(() => {
        const fetchPSAPrices = async () => {
            // Reset state when props change
            setPsaCards([]);
            setHasData(false);
            setIsLoading(true);

            // Build search query - match by card number or partial name
            if (!cardNumber && !cardName) {
                setIsLoading(false);
                return;
            }

            try {
                let url = `${SUPABASE_URL}/rest/v1/crawled_cards?`;

                // Search by card number if available
                if (cardNumber) {
                    // Remove any "/" and format variations
                    const cleanNumber = cardNumber.replace(/[^0-9]/g, '');
                    url += `card_number=ilike.*${cleanNumber}*&`;
                }

                // Filter for graded cards only
                url += `grader=not.is.null&grade=not.is.null&`;
                url += `category=in.(pokemon,onepiece,pokemon_psa,onepiece_psa)&`;
                url += `order=grade.desc,created_at.desc&`;
                url += `limit=10`;

                const response = await fetch(url, {
                    headers: {
                        'apikey': SUPABASE_KEY,
                    }
                });

                if (response.ok) {
                    const data = await response.json();

                    if (data && data.length > 0) {
                        setPsaCards(data);
                        setHasData(true);
                    } else {
                        // Fallback: search by name if no card number matches
                        const nameWords = cardName.split(' ').slice(0, 2).join(' ');
                        const nameUrl = `${SUPABASE_URL}/rest/v1/crawled_cards?name=ilike.*${encodeURIComponent(nameWords)}*&grader=not.is.null&grade=not.is.null&order=grade.desc,created_at.desc&limit=10`;

                        const nameResponse = await fetch(nameUrl, {
                            headers: { 'apikey': SUPABASE_KEY }
                        });

                        if (nameResponse.ok) {
                            const nameData = await nameResponse.json();
                            if (nameData && nameData.length > 0) {
                                setPsaCards(nameData);
                                setHasData(true);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error fetching PSA prices:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchPSAPrices();
    }, [cardNumber, cardName, setName]);

    // Calculate average prices by grade
    const calculateGradePrices = () => {
        const gradeMap = new Map<string, { total: number; count: number }>();

        psaCards.forEach(card => {
            const key = `${card.grader} ${card.grade}`;
            const existing = gradeMap.get(key) || { total: 0, count: 0 };
            gradeMap.set(key, {
                total: existing.total + (card.price || 0),
                count: existing.count + 1
            });
        });

        return Array.from(gradeMap.entries())
            .map(([grade, { total, count }]) => ({
                grade,
                avgPrice: Math.round(total / count),
                count
            }))
            .sort((a, b) => {
                // Sort by grade number descending
                const aNum = parseInt(a.grade.split(' ')[1]) || 0;
                const bNum = parseInt(b.grade.split(' ')[1]) || 0;
                return bNum - aNum;
            });
    };

    const gradePrices = calculateGradePrices();

    // Generate external links
    const buildEbaySearchUrl = () => {
        const query = `${cardName} ${cardNumber || ''} PSA`.trim();
        return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;
    };

    const buildTcgplayerUrl = () => {
        return `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(cardName)}`;
    };

    const buildPwccUrl = () => {
        return `https://www.pwccmarketplace.com/search?q=${encodeURIComponent(cardName)}`;
    };

    if (isLoading) {
        return (
            <Card className="border-white/10 mt-6">
                <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                        <SpinnerGap className="h-5 w-5 animate-spin text-orange-500" weight="bold" />
                        <span className="text-sm text-muted-foreground">Loading PSA prices...</span>
                    </div>
                </CardHeader>
            </Card>
        );
    }

    return (
        <>
            <Card className="border-white/10 mt-6 bg-gradient-to-br from-white/5 to-transparent">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Medal className="h-5 w-5 text-red-500" weight="fill" />
                        Graded Card Prices
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Price by Grade Table */}
                    {hasData && gradePrices.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {gradePrices.map(({ grade, avgPrice, count }) => (
                                <div
                                    key={grade}
                                    className="bg-white/5 rounded-lg p-3 border border-white/10 hover:border-red-500/30 transition-colors"
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge className={`${getGraderColor(grade.split(' ')[0])} text-white text-[10px] px-1.5 py-0`}>
                                            {grade}
                                        </Badge>
                                    </div>
                                    <p className="text-lg font-bold text-white">
                                        {formatPrice(currency === 'VND' ? avgPrice / 2 : avgPrice)}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                        {count} sale{count > 1 ? 's' : ''}
                                    </p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-4 text-muted-foreground text-sm">
                            <p>No graded sales data available yet</p>
                            <p className="text-xs mt-1">Check marketplaces below for current prices</p>
                        </div>
                    )}

                    {/* Recent Sold Cards */}
                    {hasData && psaCards.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-xs text-muted-foreground uppercase tracking-wider">Recent Sales</p>
                            <div className="space-y-2 max-h-40 overflow-y-auto">
                                {psaCards.slice(0, 5).map((card) => (
                                    <div
                                        key={card.id}
                                        className="flex items-center gap-3 bg-white/5 rounded-lg p-2 hover:bg-white/10 transition-colors"
                                    >
                                        {card.image_url && (
                                            <div
                                                className="flex flex-col items-center gap-1 cursor-pointer group"
                                                onClick={() => setSelectedImage({ url: getHighResImageUrl(card.image_url) || card.image_url!, name: card.name })}
                                            >
                                                <div className="w-14 h-20 relative rounded overflow-hidden shrink-0 ring-2 ring-transparent group-hover:ring-orange-500/50 transition-all">
                                                    <Image src={getHighResImageUrl(card.image_url) || card.image_url} alt="" fill className="object-cover" />
                                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                                        <MagnifyingGlassPlus className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" weight="bold" />
                                                    </div>
                                                </div>
                                                <span className="text-[8px] text-muted-foreground group-hover:text-orange-400 transition-colors">Click to view</span>
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium truncate">{card.name}</p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <Badge className={`${getGraderColor(card.grader)} text-white text-[9px] px-1 py-0`}>
                                                    {card.grader} {card.grade}
                                                </Badge>
                                                <span className="text-xs text-muted-foreground">
                                                    {new Date(card.created_at).toLocaleDateString()}
                                                </span>
                                            </div>
                                        </div>
                                        <p className="text-sm font-bold text-green-400 shrink-0">
                                            {formatPrice(currency === 'VND' ? card.price / 2 : card.price)}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Marketplace Links */}
                    <div className="pt-2 border-t border-white/10">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">View on Marketplaces</p>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5 text-xs h-8 border-red-500/30 text-red-400 hover:bg-red-500/10"
                                onClick={() => window.open(buildEbaySearchUrl(), '_blank')}
                            >
                                <ShoppingCart className="h-3.5 w-3.5" weight="fill" />
                                eBay Sold
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5 text-xs h-8 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                                onClick={() => window.open(buildTcgplayerUrl(), '_blank')}
                            >
                                <Storefront className="h-3.5 w-3.5" weight="fill" />
                                TCGPlayer
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5 text-xs h-8 border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                                onClick={() => window.open(buildPwccUrl(), '_blank')}
                            >
                                <TrendUp className="h-3.5 w-3.5" weight="bold" />
                                PWCC
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Image Modal */}
            {
                selectedImage && (
                    <div
                        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
                        onClick={() => setSelectedImage(null)}
                    >
                        <div
                            className="relative max-w-2xl w-full bg-zinc-900 rounded-2xl p-4 border border-white/10"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                type="button"
                                className="absolute top-3 right-3 z-10 p-2 rounded-full bg-white/20 hover:bg-white/40 transition-colors cursor-pointer"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedImage(null);
                                }}
                            >
                                <X className="w-5 h-5 text-white" weight="bold" />
                            </button>
                            <div className="relative aspect-[3/4] w-full max-h-[70vh] rounded-xl overflow-hidden">
                                <Image
                                    src={selectedImage.url}
                                    alt={selectedImage.name}
                                    fill
                                    className="object-contain"
                                />
                            </div>
                            <p className="text-center text-sm text-muted-foreground mt-3 truncate px-8">
                                {selectedImage.name}
                            </p>
                        </div>
                    </div>
                )
            }
        </>
    );
}
