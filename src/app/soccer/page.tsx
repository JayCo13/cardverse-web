"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { SoccerCardItem, type SoccerCard } from "@/components/soccer-card-item";
import { useLocalization } from "@/context/localization-context";
import { getSupabaseClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SpinnerGap, SoccerBall, MagnifyingGlass, ArrowsClockwise, ArrowSquareOut } from "@phosphor-icons/react";
import { AdBanner } from "@/components/ad-banner";
import Image from "next/image";
import { useCurrency } from "@/contexts/currency-context";

interface EbayItem {
    itemId: string;
    title: string;
    price?: { value: string; currency: string };
    image?: { imageUrl: string };
    itemWebUrl?: string;
}

export default function SoccerPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { t } = useLocalization();
    const { currency, formatPrice } = useCurrency();

    // Initialize state from URL params
    const [cards, setCards] = useState<SoccerCard[]>([]);
    const [ebayResults, setEbayResults] = useState<EbayItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState(searchParams.get('q') || "");
    const [yearFilter, setYearFilter] = useState(searchParams.get('year') || "all");
    const [graderFilter, setGraderFilter] = useState(searchParams.get('grader') || "all");
    const [searchMode, setSearchMode] = useState<"database" | "ebay">(searchParams.get('mode') as "database" | "ebay" || "database");
    const [originalQuery, setOriginalQuery] = useState<string | null>(null);

    // Ref for aborting pending eBay requests
    const abortControllerRef = useRef<AbortController | null>(null);

    // Update URL when filters change
    useEffect(() => {
        const params = new URLSearchParams();
        if (searchTerm) params.set('q', searchTerm);
        if (yearFilter !== 'all') params.set('year', yearFilter);
        if (graderFilter !== 'all') params.set('grader', graderFilter);
        if (searchMode !== 'database') params.set('mode', searchMode);

        const newUrl = params.toString() ? `?${params.toString()}` : '/soccer';
        router.replace(newUrl, { scroll: false });
    }, [searchTerm, yearFilter, graderFilter, searchMode, router]);

    // Fetch from local database
    const fetchCards = useCallback(async () => {
        setLoading(true);
        setSearchMode("database");
        try {
            const supabase = getSupabaseClient();
            let query = supabase
                .from('crawled_cards')
                .select('*')
                .ilike('category', '%soccer%')  // Use ilike to match 'Soccer Cards'
                .not('year', 'is', null)
                // Only show numbered (/99, /50, /25, /10, /5, /1) or autograph cards
                .or('name.ilike.%auto%,name.ilike.%autograph%,name.ilike.%/99%,name.ilike.%/75%,name.ilike.%/50%,name.ilike.%/25%,name.ilike.%/10%,name.ilike.%/5%,name.ilike.%/1%,name.ilike.%numbered%');

            // Apply search
            if (searchTerm) {
                query = query.ilike('name', `%${searchTerm}%`);
            }

            // Apply year filter
            if (yearFilter !== "all") {
                query = query.eq('year', yearFilter);
            }

            // Apply grader filter
            if (graderFilter !== "all") {
                query = query.eq('grader', graderFilter);
            }

            const { data, error } = await query
                .order('year', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(60);

            if (error) throw error;

            setCards(data || []);
            setEbayResults([]);
        } catch (err) {
            console.error('Fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, [yearFilter, graderFilter]);

    // Normalize search text (handle accented characters like Mbappé → Mbappe)
    const normalizeSearch = (text: string): string => {
        const replacements: Record<string, string> = {
            'á': 'a', 'à': 'a', 'ã': 'a', 'â': 'a', 'ä': 'a',
            'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
            'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
            'ó': 'o', 'ò': 'o', 'õ': 'o', 'ô': 'o', 'ö': 'o',
            'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
            'ç': 'c', 'ñ': 'n', 'ø': 'o',
        };
        let result = text.toLowerCase();
        Object.entries(replacements).forEach(([key, value]) => {
            result = result.replace(new RegExp(key, 'g'), value);
        });
        return result;
    };

    // Helper to get high-res eBay image
    const getHighResImageUrl = (url: string) => {
        if (!url) return "";
        return url.replace(/s-l\d+\./, 's-l1600.');
    };

    // Smart search: local database first, fallback to eBay
    const handleSmartSearch = async (overrideTerm?: string, skipCache = false) => {
        const termToSearch = overrideTerm !== undefined ? overrideTerm : searchTerm;

        if (!termToSearch.trim()) {
            fetchCards();
            return;
        }

        // Check sessionStorage cache for eBay results first (unless skipCache is true)
        const cacheKey = `soccer_ebay_${termToSearch.toLowerCase().trim()}`;
        if (!skipCache) {
            try {
                const cachedData = sessionStorage.getItem(cacheKey);
                if (cachedData) {
                    const { results, timestamp } = JSON.parse(cachedData);
                    if (Date.now() - timestamp < 5 * 60 * 1000 && results.length > 0) {
                        console.log('Using cached eBay results for:', termToSearch);
                        setEbayResults(results);
                        setCards([]);
                        setSearchMode("ebay");
                        setSearchLoading(false);
                        return;
                    }
                }
            } catch (e) {
                console.error('Cache read error:', e);
            }
        }

        // Cancel any pending request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;

        setSearchLoading(true);
        setOriginalQuery(null);

        try {
            const supabase = getSupabaseClient();
            let effectiveTerm = termToSearch;

            // Check for non-ASCII characters to trigger translation
            const hasNonAscii = /[^\x00-\x7F]/.test(termToSearch);

            if (hasNonAscii) {
                try {
                    const { data, error } = await supabase.functions.invoke('translate-query', {
                        body: { query: termToSearch },
                    });

                    if (!error && data?.translatedQuery) {
                        console.log(`Translated: "${termToSearch}" -> "${data.translatedQuery}"`);
                        effectiveTerm = data.translatedQuery;
                        setOriginalQuery(termToSearch);
                    }
                } catch (translationError) {
                    console.error("Translation failed, using original term:", translationError);
                }
            }

            const normalizedTerm = normalizeSearch(effectiveTerm);

            // Step 1: Search local database first (faster & more reliable)
            const { data: localResults, error } = await supabase
                .from('crawled_cards')
                .select('*')
                .ilike('category', '%soccer%')
                .ilike('name', `%${normalizedTerm}%`)
                .order('price', { ascending: false })
                .limit(60);

            if (!error && localResults && localResults.length > 0) {
                setCards(localResults);
                setEbayResults([]);
                setSearchMode("database");
                setSearchLoading(false);
                return;
            }

            // Step 2: No local results - fallback to eBay
            setSearchMode("ebay");

            let validItems: EbayItem[] = [];
            let searchWords = effectiveTerm.split(" ").filter(w => w.trim() !== "");

            while (searchWords.length > 0) {
                const currentQuery = searchWords.join(" ");
                console.log("Fetching from eBay with matching fewer words logic:", currentQuery);

                const response = await fetch(
                    `/api/ebay-scrape?q=${encodeURIComponent(currentQuery + " soccer")}&limit=30`,
                    { signal: controller.signal }
                );

                if (!response.ok) break;

                const data = await response.json();

                if (data.items && data.items.length > 0) {
                    validItems = data.items.filter((item: EbayItem) => {
                        const price = parseFloat(item.price?.value || "0");
                        return price > 0;
                    });

                    if (validItems.length > 0) {
                        break;
                    }
                }

                searchWords.pop();
                await new Promise(resolve => setTimeout(resolve, 300));
            }

            setEbayResults(validItems);
            setCards([]);

            if (validItems.length > 0) {
                try {
                    sessionStorage.setItem(cacheKey, JSON.stringify({
                        results: validItems,
                        timestamp: Date.now()
                    }));
                } catch (e) {
                    console.error('Cache write error:', e);
                }
            }
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                return;
            }
            console.error('Search error:', err);
        } finally {
            if (abortControllerRef.current === controller) {
                setSearchLoading(false);
            }
        }
    };

    const handleEbayCardClick = (item: EbayItem) => {
        const price = parseFloat(item.price?.value || "0");
        const highResImage = item.image?.imageUrl ? getHighResImageUrl(item.image.imageUrl) : null;

        const cardData: SoccerCard = {
            id: item.itemId,
            name: item.title,
            image_url: highResImage,
            price: price,
            category: 'Soccer',
            year: null,
            grader: null,
            grade: null,
            set_name: null,
            player_name: null,
            ebay_id: item.itemId
        };

        sessionStorage.setItem('viewingSoccerCard', JSON.stringify(cardData));
        router.push(`/soccer/${item.itemId}`);
    };

    useEffect(() => {
        const initialQuery = searchParams.get('q');
        const mode = searchParams.get('mode');

        if (initialQuery) {
            const cacheKey = `soccer_ebay_${initialQuery.toLowerCase().trim()}`;
            try {
                const cachedData = sessionStorage.getItem(cacheKey);
                if (cachedData && mode === 'ebay') {
                    const { results, timestamp } = JSON.parse(cachedData);
                    if (Date.now() - timestamp < 5 * 60 * 1000 && results.length > 0) {
                        console.log('Restoring cached eBay results on initial load for:', initialQuery);
                        setEbayResults(results);
                        setCards([]);
                        setSearchMode("ebay");
                        setLoading(false);
                        return;
                    }
                }
            } catch (e) {
                console.error('Cache read error on load:', e);
            }

            handleSmartSearch(initialQuery);
        } else {
            fetchCards();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        handleSmartSearch();
    };

    const handleReset = () => {
        setSearchTerm("");
        setYearFilter("all");
        setGraderFilter("all");
        setSearchMode("database");
        fetchCards();
    };

    return (
        <div className="flex flex-col min-h-screen bg-[#050505]">
            <Header />
            <main className="flex-1 py-8 px-4">
                <div className="max-w-7xl mx-auto">
                    {/* Header */}
                    <div className="flex items-center gap-4 mb-8">
                        <div className="relative w-16 h-16 sm:w-20 sm:h-20 shrink-0">
                            <Image
                                src="/assets/soc-logo.png"
                                alt="Soccer Logo"
                                fill
                                className="object-contain drop-shadow-lg"
                            />
                        </div>
                        <div>
                            <h1 className="text-3xl sm:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 via-emerald-500 to-teal-500 font-headline tracking-wide">
                                {t('soccer_page_title')}
                            </h1>
                            <p className="text-white/50">{t('soccer_page_desc')}</p>
                        </div>
                    </div>

                    {/* Search and Filters — DB search only, no AI scan */}
                    <div className="flex flex-col sm:flex-row gap-4 mb-8">
                        <form onSubmit={handleSearch} className="flex-1 flex gap-2">
                            <div className="relative flex-1">
                                <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                                <Input
                                    type="search"
                                    placeholder={t('soccer_search_placeholder')}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-10 bg-white/5 border-white/10 h-12"
                                />
                            </div>
                            <Button type="submit" className="h-12 px-6 bg-green-600 hover:bg-green-700 font-bold tracking-wide">
                                {t('search_button')}
                            </Button>
                        </form>

                        <div className="flex gap-3">
                            <Select value={yearFilter} onValueChange={setYearFilter}>
                                <SelectTrigger className="w-[120px] bg-white/5 border-white/10 h-12">
                                    <SelectValue placeholder="Year" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Years</SelectItem>
                                    <SelectItem value="2024">2024</SelectItem>
                                    <SelectItem value="2023">2023</SelectItem>
                                    <SelectItem value="2022">2022</SelectItem>
                                    <SelectItem value="2021">2021</SelectItem>
                                    <SelectItem value="2020">2020</SelectItem>
                                </SelectContent>
                            </Select>

                            <Select value={graderFilter} onValueChange={setGraderFilter}>
                                <SelectTrigger className="w-[120px] bg-white/5 border-white/10 h-12">
                                    <SelectValue placeholder="Grader" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Graders</SelectItem>
                                    <SelectItem value="PSA">PSA</SelectItem>
                                    <SelectItem value="BGS">BGS</SelectItem>
                                    <SelectItem value="SGC">SGC</SelectItem>
                                    <SelectItem value="CGC">CGC</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Search Mode Indicator */}
                    {searchMode === "ebay" && (
                        <div className="flex items-center gap-2 mb-4">
                            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                                eBay Results
                            </Badge>
                            <Button onClick={handleReset} variant="ghost" size="sm" className="text-white/50 hover:text-white">
                                ← Back to database
                            </Button>
                        </div>
                    )}

                    {/* Results */}
                    {(loading || searchLoading) ? (
                        <div className="flex items-center justify-center py-20">
                            <SpinnerGap className="w-8 h-8 animate-spin text-green-500" weight="bold" />
                            <span className="ml-3 text-white/60">
                                {searchLoading ? "Searching eBay..." : t('loading_cards')}
                            </span>
                        </div>
                    ) : searchMode === "ebay" && ebayResults.length > 0 ? (
                        <>
                            <div className="flex items-center gap-2 mb-4 text-white/50">
                                <p>{ebayResults.length} eBay listings found</p>
                                {originalQuery && (
                                    <span className="text-xs bg-white/10 px-2 py-1 rounded-full text-green-400">
                                        Translated from &quot;{originalQuery}&quot;
                                    </span>
                                )}
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                {ebayResults.map((item) => (
                                    <Card
                                        key={item.itemId}
                                        className="overflow-hidden bg-card/80 hover:bg-card transition-all border-green-500/20 hover:border-green-500/40 cursor-pointer"
                                        onClick={() => handleEbayCardClick(item)}
                                    >
                                        <div className="relative aspect-square bg-gradient-to-br from-gray-900 to-gray-800">
                                            {item.image?.imageUrl && (
                                                <Image
                                                    src={getHighResImageUrl(item.image.imageUrl)}
                                                    alt={item.title}
                                                    fill
                                                    className="object-contain p-2"
                                                />
                                            )}
                                        </div>
                                        <div className="p-3">
                                            <p className="text-xs line-clamp-2 mb-2">{item.title}</p>
                                            <div className="flex items-center justify-between">
                                                <span className="text-green-400 font-bold">
                                                    {(() => {
                                                        const price = parseFloat(item.price?.value || "0");
                                                        const finalPrice = currency === 'VND' ? price / 2 : price;
                                                        return formatPrice(finalPrice);
                                                    })()}
                                                </span>
                                                <ArrowSquareOut className="w-4 h-4 text-white/30" />
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        </>
                    ) : cards.length > 0 ? (
                        <>
                            <p className="text-white/50 mb-4">{t('cards_found').replace('{count}', cards.length.toString())}</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                {cards.map((card) => (
                                    <SoccerCardItem key={card.id} card={card} />
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <SoccerBall className="w-16 h-16 text-green-500/30 mb-4" weight="fill" />
                            <p className="text-white/50">currently no sell price for this card</p>
                        </div>
                    )}
                </div>
            </main>

            {/* AdSense Banner — hidden for VIP Pro */}
            <div className="max-w-6xl mx-auto px-4 py-6">
                <AdBanner slot="soccer_list_bottom" format="auto" className="rounded-xl overflow-hidden" />
            </div>

            <Footer />
        </div>
    );
}
