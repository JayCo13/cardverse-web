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
import { SpinnerGap, SoccerBall, MagnifyingGlass, ArrowsClockwise, ArrowSquareOut, Camera, UploadSimple, Crop as CropIcon, X } from "@phosphor-icons/react";
import Image from "next/image";
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { useCurrency } from "@/contexts/currency-context";
import { useScanLimit } from "@/hooks/useScanLimit";
import { ScanLimitModal } from "@/components/scan-limit-modal";
import { useUser } from "@/lib/supabase/auth-provider";

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
    const { user } = useUser();

    // Scan limit tracking
    const { canScan, scansUsed, scansLimit, scansRemaining, resetTime, incrementUsage, isLoading: scanLimitLoading } = useScanLimit();
    const [showLimitModal, setShowLimitModal] = useState(false);

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

    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // Ref for aborting pending eBay requests
    const abortControllerRef = useRef<AbortController | null>(null);
    const galleryInputRef = useRef<HTMLInputElement>(null);
    const cropImgRef = useRef<HTMLImageElement>(null);

    // Image crop state
    const [showCropModal, setShowCropModal] = useState(false);
    const [cropImageSrc, setCropImageSrc] = useState<string>('');
    const [crop, setCrop] = useState<Crop>();

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
                .not('year', 'is', null);

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
        // Replace suffix like s-l225, s-l300, etc. with s-l1600 (max res)
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
                    // Use cache if less than 5 minutes old
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

            // Check for non-ASCII characters (Vietnamese, Japanese, etc.) to trigger translation
            // This regex matches any character that is NOT standard ASCII (A-Z, a-z, 0-9, common punctuation)
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
                // Found local results - use them
                setCards(localResults);
                setEbayResults([]);
                setSearchMode("database");
                setSearchLoading(false);
                return;
            }

            // Step 2: No local results - fallback to eBay
            setSearchMode("ebay");

            const response = await fetch(
                `/api/ebay-scrape?q=${encodeURIComponent(effectiveTerm + " soccer card")}&limit=30`,
                { signal: controller.signal }
            );
            const data = await response.json();

            if (data.items) {
                const validItems = data.items.filter((item: EbayItem) => {
                    const price = parseFloat(item.price?.value || "0");
                    return price > 0;
                });
                setEbayResults(validItems);
                setCards([]);

                // Cache the eBay results
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
        // Convert EbayItem to SoccerCard format for details page
        const price = parseFloat(item.price?.value || "0");
        const highResImage = item.image?.imageUrl ? getHighResImageUrl(item.image.imageUrl) : null;

        const cardData: SoccerCard = {
            id: item.itemId,
            name: item.title,
            image_url: highResImage,
            price: price,
            category: 'Soccer',
            year: null, // AI or parsing could perform better here but null is safe
            grader: null, // Could parse from title if desired
            grade: null,
            set_name: null,
            player_name: null, // Title parsing could extract this
            ebay_id: item.itemId
        };

        sessionStorage.setItem('viewingSoccerCard', JSON.stringify(cardData));
        router.push(`/soccer/${item.itemId}`);
    };

    // Helper function to process scanned image with AI
    const processScannedCard = async (base64String: string) => {
        setIsAnalyzing(true);
        try {
            const supabase = getSupabaseClient();
            const { data, error } = await supabase.functions.invoke('identify-soccer-card', {
                body: { image: base64String },
            });

            if (error) throw error;
            if (data?.error) throw new Error(data.error);

            // Construct search query
            const queryParts = [];
            if (data.cardName && data.cardName !== "Unknown") queryParts.push(data.cardName);
            if (data.year) queryParts.push(data.year);
            if (data.brand) queryParts.push(data.brand);
            if (data.cardSet) queryParts.push(data.cardSet);
            if (data.variant && data.variant !== "Base") queryParts.push(data.variant);

            const query = queryParts.join(" ");
            console.log("AI Identified:", data);
            console.log("Search Query:", query);

            setSearchTerm(query);
            handleSmartSearch(query);
        } catch (error) {
            console.error("Identification failed:", error);
            alert("Could not identify card. Please try again.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    // Handle gallery upload (opens crop modal)
    const handleGallerySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            setCropImageSrc(base64);
            setShowCropModal(true);
            setCrop(undefined);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    // Initialize crop when image loads
    const onCropImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        const { width, height } = e.currentTarget;
        const newCrop = centerCrop(
            makeAspectCrop({ unit: '%', width: 80 }, 3 / 4, width, height),
            width,
            height
        );
        setCrop(newCrop);
    }, []);

    // Complete crop and process
    const handleCropComplete = useCallback(async () => {
        if (!crop || !cropImgRef.current) return;

        const image = cropImgRef.current;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const scaleX = image.naturalWidth / image.width;
        const scaleY = image.naturalHeight / image.height;

        const cropX = (crop.x / 100) * image.width * scaleX;
        const cropY = (crop.y / 100) * image.height * scaleY;
        const cropWidth = (crop.width / 100) * image.width * scaleX;
        const cropHeight = (crop.height / 100) * image.height * scaleY;

        canvas.width = cropWidth;
        canvas.height = cropHeight;

        ctx.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

        const croppedBase64 = canvas.toDataURL('image/jpeg', 0.95);
        const base64Data = croppedBase64.split(',')[1];

        setShowCropModal(false);
        setCropImageSrc('');

        if (!canScan) {
            setShowLimitModal(true);
            return;
        }

        await incrementUsage();
        processScannedCard(base64Data);
    }, [crop, canScan, incrementUsage]);

    // Use original without cropping
    const handleUseOriginal = useCallback(async () => {
        if (!cropImageSrc) return;

        const base64Data = cropImageSrc.split(',')[1];

        setShowCropModal(false);
        setCropImageSrc('');

        if (!canScan) {
            setShowLimitModal(true);
            return;
        }

        await incrementUsage();
        processScannedCard(base64Data);
    }, [cropImageSrc, canScan, incrementUsage]);

    useEffect(() => {
        // If there's a search term in URL, check cache first to avoid re-searching
        const initialQuery = searchParams.get('q');
        const mode = searchParams.get('mode');

        if (initialQuery) {
            // Check for cached eBay results to prevent re-fetching
            const cacheKey = `soccer_ebay_${initialQuery.toLowerCase().trim()}`;
            try {
                const cachedData = sessionStorage.getItem(cacheKey);
                if (cachedData && mode === 'ebay') {
                    const { results, timestamp } = JSON.parse(cachedData);
                    // Use cache if less than 5 minutes old
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

            // Cache miss or stale - run the search
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

                    {/* Search and Filters */}
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
                                <input
                                    type="file"
                                    ref={galleryInputRef}
                                    onChange={handleGallerySelect}
                                    accept="image/*"
                                    className="hidden"
                                />
                            </div>
                            <Button
                                type="button"
                                onClick={() => galleryInputRef.current?.click()}
                                disabled={isAnalyzing}
                                className="h-12 w-12 px-0 bg-white/10 hover:bg-white/20 border border-white/10"
                                title="Scan Image"
                            >
                                {isAnalyzing ? (
                                    <SpinnerGap className="w-5 h-5 animate-spin" />
                                ) : (
                                    <UploadSimple className="w-5 h-5 text-white/70" />
                                )}
                            </Button>
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

                            <Button onClick={handleReset} variant="outline" className="h-12 px-4 border-green-500/30 text-green-400">
                                <ArrowsClockwise className="w-5 h-5" />
                            </Button>
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
                                        Translated from "{originalQuery}"
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
                            <p className="text-white/50">{t('no_cards_found')}</p>
                            <p className="text-sm text-white/30 mt-1">{t('try_adjusting_filters_short')}</p>
                        </div>
                    )}
                </div>
            </main>
            <Footer />

            {/* Image Crop Modal */}
            {showCropModal && (
                <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col items-center justify-center p-4 overflow-hidden">
                    {/* Header */}
                    <div className="w-full max-w-2xl flex items-center justify-between mb-4">
                        <h3 className="text-white text-lg font-semibold flex items-center gap-2">
                            <CropIcon className="w-5 h-5" />
                            {t('crop_image_title')}
                        </h3>
                        <Button
                            onClick={() => {
                                setShowCropModal(false);
                                setCropImageSrc('');
                            }}
                            variant="ghost"
                            className="text-white hover:bg-white/10 rounded-full h-10 w-10 p-0"
                        >
                            <X className="w-5 h-5" />
                        </Button>
                    </div>

                    {/* Crop area */}
                    <div className="relative w-full max-w-2xl flex-1 flex items-center justify-center overflow-hidden rounded-lg">
                        <ReactCrop
                            crop={crop}
                            onChange={(_, percentCrop) => setCrop(percentCrop)}
                            aspect={3 / 4}
                            minWidth={50}
                            className="max-h-full"
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                ref={cropImgRef}
                                src={cropImageSrc}
                                alt="Crop preview"
                                onLoad={onCropImageLoad}
                                style={{ maxHeight: '60vh', maxWidth: '100%', objectFit: 'contain' }}
                            />
                        </ReactCrop>
                    </div>

                    {/* Instructions */}
                    <p className="text-gray-400 text-sm mt-4 text-center">
                        {t('crop_image_instructions')}
                    </p>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-3 mt-6 justify-center">
                        <Button
                            onClick={() => {
                                setShowCropModal(false);
                                setCropImageSrc('');
                            }}
                            variant="outline"
                            className="bg-transparent border-white/20 text-white hover:bg-white/10"
                        >
                            {t('crop_cancel')}
                        </Button>
                        <Button
                            onClick={handleUseOriginal}
                            variant="outline"
                            className="bg-transparent border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
                        >
                            <Camera className="w-4 h-4 mr-2" />
                            {t('crop_use_original')}
                        </Button>
                        <Button
                            onClick={handleCropComplete}
                            className="bg-green-600 hover:bg-green-700 text-white"
                            disabled={!crop}
                        >
                            <CropIcon className="w-4 h-4 mr-2" />
                            {t('crop_scan_cropped')}
                        </Button>
                    </div>
                </div>
            )}

            {/* Scan Limit Modal */}
            <ScanLimitModal
                isOpen={showLimitModal}
                onClose={() => setShowLimitModal(false)}
                resetTime={resetTime}
                scansUsed={scansUsed}
                scansLimit={scansLimit}
                isAnonymous={!user}
            />
        </div>
    );
}
