"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendUp, Pulse, CurrencyDollar, SpinnerGap, ArrowsClockwise, MagnifyingGlass, Camera, Plus, Check, SoccerBall, Skull, UploadSimple, Crop as CropIcon, X, Medal, Lightning, Timer, Crown, CreditCard } from '@phosphor-icons/react';
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { getSupabaseClient } from '@/lib/supabase/client';
import { useUser, useSupabase } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { useCurrency } from '@/contexts/currency-context';
import { useLocalization } from '@/context/localization-context';
import { useScanLimit } from '@/hooks/useScanLimit';
import { ScanLimitModal } from '@/components/scan-limit-modal';
import { useCardCache } from '@/contexts/card-cache-context';
import { PSAGradedPrices } from '@/components/psa-graded-prices';

// Fallback mock data for when no real data exists
const MOCK_DATA = [
    { date: 'Jan 01', price: 1150 },
    { date: 'Jan 05', price: 1180 },
    { date: 'Jan 10', price: 1160 },
    { date: 'Jan 15', price: 1210 },
    { date: 'Jan 20', price: 1195 },
    { date: 'Jan 25', price: 1240 },
    { date: 'Jan 30', price: 1280 },
    { date: 'Feb 05', price: 1260 },
    { date: 'Feb 10', price: 1310 },
    { date: 'Feb 15', price: 1350 },
    { date: 'Feb 20', price: 1200 },
    { date: 'Feb 25', price: 1250 },
    { date: 'Mar 01', price: 1320 },
    { date: 'Mar 05', price: 1380 },
    { date: 'Mar 10', price: 1400 },
];

const TIME_FRAMES = ['1W', '1M', '1Y', 'ALL'];

// Supabase URL
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

interface ProductData {
    product_id: number;
    name: string;
    displayName: string;
    image_url: string | null;
    set_name: string | null;
    rarity: string | null;
    market_price: number;
    low_price: number | null;
    high_price: number | null;
    number: string | null;
    isFirstEdition: boolean;
    isHolo: boolean;
    tcgplayer_url: string | null;
    // Extended card details
    cardType: string | null;
    hp: string | null;
    stage: string | null;
    attack1: string | null;
    attack2: string | null;
    attack3: string | null;
    weakness: string | null;
    resistance: string | null;
    retreatCost: string | null;
    artist: string | null;
    category_id?: number; // For PSA price lookup (3=EN, 85=JP Pokemon)
}

interface FeaturedResponse {
    success: boolean;
    product: ProductData;
    chartData: Array<{ date: string; price: number }>;
    stats: {
        currentPrice: number;
        lowPrice: number | null;
        highPrice: number | null;
        dataPoints: number;
    };
}

// Database record type for tcgcsv_products
interface TcgcsvProduct {
    product_id: number;
    name: string;
    image_url: string | null;
    set_name: string | null;
    rarity: string | null;
    market_price: number;
    low_price: number | null;
    mid_price: number | null;
    high_price: number | null;
    number: string | null;
    tcgplayer_url: string | null;
    extended_data: unknown;
    category_id: number;
}

interface PriceHistoryRecord {
    recorded_at: string;
    market_price: number;
}

export function MarketSpotlight() {
    const router = useRouter();
    const { user } = useUser();
    const supabase = useSupabase();
    const { setOpen: setAuthModalOpen } = useAuthModal();
    // Cache removed - always fetch fresh data
    // const { spotlight, setSpotlightCache } = useCardCache();

    const [timeFrame, setTimeFrame] = useState('1M');
    // No cache - always start fresh
    const [product, setProduct] = useState<ProductData | null>(null);
    const [chartData, setChartData] = useState<Array<{ date: string; price: number }>>([]);
    const [fullChartData, setFullChartData] = useState<Array<{ date: string; price: number; dateObj: Date }>>([]);
    const [currentPrice, setCurrentPrice] = useState<number | null>(null);
    const [priceChange, setPriceChange] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [useMockData, setUseMockData] = useState(false);
    const [isScannedResult, setIsScannedResult] = useState(false);

    // Filter chart data based on selected timeframe
    const filterChartDataByTimeframe = React.useCallback((data: Array<{ date: string; price: number; dateObj: Date }>, tf: string) => {
        if (data.length === 0) return [];

        const now = new Date();
        let startDate: Date;

        switch (tf) {
            case '1W':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '1M':
                startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                break;
            case '1Y':
                startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
                break;
            case 'ALL':
            default:
                startDate = new Date(0); // Beginning of time
                break;
        }

        const filtered = data.filter(d => d.dateObj >= startDate);
        return filtered.map(d => ({ date: d.date, price: d.price }));
    }, []);

    // Update chart when timeframe changes
    React.useEffect(() => {
        if (fullChartData.length > 0) {
            const filtered = filterChartDataByTimeframe(fullChartData, timeFrame);
            setChartData(filtered.length > 0 ? filtered : fullChartData.slice(-7).map(d => ({ date: d.date, price: d.price })));

            // Recalculate price change for the filtered period
            if (filtered.length >= 2) {
                const first = filtered[0]?.price || 0;
                const last = filtered[filtered.length - 1]?.price || 0;
                const change = first > 0 ? ((last - first) / first * 100) : 0;
                setPriceChange(parseFloat(change.toFixed(1)));
            }
        }
    }, [timeFrame, fullChartData, filterChartDataByTimeframe]);

    // Search state
    const [searchTerm, setSearchTerm] = useState('');
    const [isScanning, setIsScanning] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null); // Camera capture
    const galleryInputRef = React.useRef<HTMLInputElement>(null); // Gallery upload
    const scanInProgressRef = React.useRef(false); // Sync flag to prevent concurrent scans

    const [showCropModal, setShowCropModal] = useState(false);
    const [cropImageSrc, setCropImageSrc] = useState<string>('');

    // Scan limit tracking
    const { canScan, scansUsed, scansLimit, scansRemaining, resetTime, incrementUsage, isLoading: scanLimitLoading, scanType, subscription: scanSub } = useScanLimit();
    const [showLimitModal, setShowLimitModal] = useState(false);
    const [crop, setCrop] = useState<Crop>();
    const cropImgRef = useRef<HTMLImageElement>(null);

    // Top 5 scan results dialog state
    type ScoredResult = { product: TcgcsvProduct; score: number; breakdown: string };
    const [scanResults, setScanResults] = useState<ScoredResult[]>([]);
    const [showScanResultsDialog, setShowScanResultsDialog] = useState(false);
    const [scanStatus, setScanStatus] = useState<string>('');

    // Collection state
    const [isAddingToCollection, setIsAddingToCollection] = useState(false);
    const [addedToCollection, setAddedToCollection] = useState(false);

    // Add to collection function using Supabase client
    const addToCollection = async () => {
        if (!user) {
            setAuthModalOpen(true);
            return;
        }

        if (!product) return;

        setIsAddingToCollection(true);
        try {
            const { error } = await supabase
                .from('user_collections')
                .insert({
                    user_id: user.id,
                    title: product.displayName || product.name,
                    image_url: product.image_url,
                    market_price: product.market_price,
                    low_price: product.low_price,
                    high_price: product.high_price,
                    category: 'Pokemon',
                    rarity: product.rarity,
                });

            if (error) {
                // If duplicate, still show success
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

    // TCGCSV Category IDs (from mobile app's app_constants.dart)
    const CATEGORY_POKEMON_ENGLISH = 3;
    const CATEGORY_POKEMON_JAPANESE = 85;

    // Search Pokemon cards directly from database (like mobile app's tcg_repository.dart)
    // Supports both English and Japanese cards
    const fetchFeaturedProduct = async (query: string = '', cardNumber?: string, language?: string) => {
        setIsLoading(true);
        setSearchError(null);

        // Fallback product data
        const FALLBACK_PRODUCT: ProductData = {
            product_id: 0,
            name: 'Charizard ex - 223/191',
            displayName: 'Charizard ex',
            image_url: 'https://tcgplayer-cdn.tcgplayer.com/product/519909_200w.jpg',
            set_name: 'Surging Sparks',
            rarity: 'Special Art Rare',
            market_price: 250,
            low_price: 200,
            high_price: 300,
            number: '223/191',
            isFirstEdition: false,
            isHolo: true,
            tcgplayer_url: null,
            cardType: null, hp: null, stage: null, attack1: null, attack2: null, attack3: null, weakness: null, resistance: null, retreatCost: null, artist: null
        };

        try {
            const supabase = getSupabaseClient();

            // OPTIMIZED: For initial load (no query), fetch a high-value card via REST API
            if (!query) {
                console.log('Fetching featured card via REST API...');

                // 5 second timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                try {
                    const restUrl = `${SUPABASE_URL}/rest/v1/tcgcsv_products?category_id=in.(3,85)&image_url=not.is.null&market_price=not.is.null&market_price=gt.100&order=market_price.desc&select=product_id,name,image_url,set_name,rarity,market_price,low_price,mid_price,high_price,number,tcgplayer_url,extended_data,category_id&limit=1`;

                    const response = await fetch(restUrl, {
                        headers: {
                            'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
                        },
                        signal: controller.signal,
                    });

                    clearTimeout(timeoutId);

                    if (!response.ok) {
                        console.log('Database error, using fallback');
                        setProduct(FALLBACK_PRODUCT);
                        setCurrentPrice(FALLBACK_PRODUCT.market_price);
                        setChartData(MOCK_DATA);
                        setUseMockData(true);
                        setIsLoading(false);
                        return;
                    }

                    const data = await response.json();

                    if (data && data.length > 0) {
                        await displayProductResult(data[0]);
                    } else {
                        setProduct(FALLBACK_PRODUCT);
                        setCurrentPrice(FALLBACK_PRODUCT.market_price);
                        setChartData(MOCK_DATA);
                        setUseMockData(true);
                    }
                    setIsLoading(false);
                    return;
                } catch (fetchErr: unknown) {
                    clearTimeout(timeoutId);
                    console.log('Featured card fetch failed, using fallback');
                    setProduct(FALLBACK_PRODUCT);
                    setCurrentPrice(FALLBACK_PRODUCT.market_price);
                    setChartData(MOCK_DATA);
                    setUseMockData(true);
                    setIsLoading(false);
                    return;
                }
            }

            const cleanName = query.trim();

            if (!cleanName) {
                setSearchError('Please enter a card name');
                return;
            }

            // Determine category based on language (like mobile app)
            const isJapanese = language?.toLowerCase() === 'japanese';
            const categoryId = isJapanese ? CATEGORY_POKEMON_JAPANESE : null; // null = search all

            console.log(`Searching TCGCSV: "${cleanName}" (number: ${cardNumber || 'none'}, language: ${language || 'any'}, category: ${categoryId || 'all'})`);

            // Build query - match mobile app's tcg_repository.dart logic
            let dbQuery = supabase
                .from('tcgcsv_products')
                .select('product_id, name, image_url, set_name, rarity, market_price, low_price, mid_price, high_price, number, tcgplayer_url, extended_data, category_id')
                .not('number', 'is', null)
                .ilike('name', `%${cleanName}%`);

            // Filter by category if language is known
            if (categoryId) {
                dbQuery = dbQuery.eq('category_id', categoryId);
            } else {
                dbQuery = dbQuery.in('category_id', [CATEGORY_POKEMON_ENGLISH, CATEGORY_POKEMON_JAPANESE]);
            }

            const { data: products, error } = await dbQuery
                .limit(20) as { data: TcgcsvProduct[] | null; error: unknown };

            if (error) {
                console.error('Database query error:', error);
                setSearchError('Search failed. Please try again.');
                return;
            }

            if (!products || products.length === 0) {
                console.log('No products found in database');
                setSearchError(`No cards found for "${query}"`);
                return;
            }

            console.log(`Found ${products.length} cards in database`);

            // Sort by card number match (like mobile app)
            let sortedProducts = products;
            if (cardNumber) {
                const cleanNumber = cardNumber.replace(/[^\d/]/g, '').trim();
                sortedProducts = [...products].sort((a, b) => {
                    const aNum = (a.number || '').replace(/[^\d/]/g, '');
                    const bNum = (b.number || '').replace(/[^\d/]/g, '');

                    const aMatches = aNum === cleanNumber;
                    const bMatches = bNum === cleanNumber;

                    if (aMatches && !bMatches) return -1;
                    if (!aMatches && bMatches) return 1;

                    return (b.market_price || 0) - (a.market_price || 0);
                });
                console.log(`Sorted by card number match, best: ${sortedProducts[0]?.name} #${sortedProducts[0]?.number}`);
            }

            const featured = sortedProducts[0];

            // Parse extended_data for card details (like get-featured-product edge function)
            let cardDetails: Record<string, string> = {};
            try {
                const extData = typeof featured.extended_data === 'string'
                    ? JSON.parse(featured.extended_data)
                    : featured.extended_data;
                if (Array.isArray(extData)) {
                    for (const item of extData) {
                        if (item.name && item.value) {
                            cardDetails[item.name] = item.value;
                        }
                    }
                }
            } catch (e) {
                console.log('Error parsing extended_data:', e);
            }

            // Build product data matching ProductData interface
            const isFirstEdition = featured.name?.toLowerCase().includes('1st edition') || false;
            const isHolo = featured.name?.toLowerCase().includes('holo') || false;
            const displayName = featured.name?.replace(/\s*-?\s*(holo|holofoil|1st edition)/gi, '').trim() || featured.name;

            const productData: ProductData = {
                product_id: featured.product_id,
                name: featured.name,
                displayName,
                image_url: featured.image_url,
                set_name: featured.set_name,
                rarity: featured.rarity,
                market_price: featured.market_price,
                low_price: featured.low_price,
                high_price: featured.high_price,
                number: featured.number,
                isFirstEdition,
                isHolo,
                tcgplayer_url: featured.tcgplayer_url,
                cardType: cardDetails['Card Type'] || null,
                hp: cardDetails['HP'] || null,
                stage: cardDetails['Stage'] || null,
                attack1: cardDetails['Attack 1'] || null,
                attack2: cardDetails['Attack 2'] || null,
                attack3: cardDetails['Attack 3'] || null,
                weakness: cardDetails['Weakness'] || null,
                resistance: cardDetails['Resistance'] || null,
                retreatCost: cardDetails['RetreatCost'] || null,
                artist: cardDetails['Artist'] || null,
            };

            setProduct(productData);
            setCurrentPrice(featured.market_price);
            setSearchError(null);

            // Fetch price history from database
            const { data: history } = await supabase
                .from('tcgcsv_price_history')
                .select('recorded_at, market_price')
                .eq('product_id', featured.product_id)
                .order('recorded_at', { ascending: true })
                .limit(365) as { data: PriceHistoryRecord[] | null };

            // DEBUG: Log price history data (search path)
            console.log(`[PRICE HISTORY - SEARCH] Product ID: ${featured.product_id}`);
            console.log(`[PRICE HISTORY - SEARCH] Records found: ${history?.length || 0}`);
            console.log('[PRICE HISTORY - SEARCH] Data:', history);

            if (history && history.length > 0) {
                const chartDataWithDates = history.map(h => ({
                    date: new Date(h.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    price: h.market_price || 0,
                    dateObj: new Date(h.recorded_at),
                }));
                setFullChartData(chartDataWithDates);

                // Initial filtering based on current timeframe
                const filteredData = filterChartDataByTimeframe(chartDataWithDates, timeFrame);
                setChartData(filteredData.length > 0 ? filteredData : chartDataWithDates.map(d => ({ date: d.date, price: d.price })));

                // Calculate price change
                const dataToUse = filteredData.length > 0 ? filteredData : chartDataWithDates;
                if (dataToUse.length >= 2) {
                    const first = dataToUse[0]?.price || featured.market_price;
                    const last = dataToUse[dataToUse.length - 1]?.price || featured.market_price;
                    const change = first > 0 ? ((last - first) / first * 100) : 0;
                    setPriceChange(parseFloat(change.toFixed(1)));
                } else {
                    setPriceChange(0);
                }
                setUseMockData(false);
            } else {
                // Use mock chart adjusted to current price
                const now = new Date();
                const adjustedMock = MOCK_DATA.map((d, i) => ({
                    date: d.date,
                    price: Math.round(featured.market_price * (0.85 + (i / MOCK_DATA.length) * 0.15)),
                    dateObj: new Date(now.getTime() - (MOCK_DATA.length - i) * 2 * 24 * 60 * 60 * 1000),
                }));
                setFullChartData(adjustedMock);
                setChartData(adjustedMock.map((d: { date: string; price: number }) => ({ date: d.date, price: d.price })));
                setPriceChange(0);
                setUseMockData(true);
            }
            // Cache removed
            // if (history && history.length > 0) {
            //     const chartDataWithDates = history.map(h => ({
            //         date: new Date(h.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            //         price: h.market_price || 0,
            //         dateObj: new Date(h.recorded_at),
            //     }));
            //     setSpotlightCache({
            //         product: productData,
            //         chartData: chartDataWithDates,
            //         currentPrice: featured.market_price,
            //         priceChange: chartDataWithDates.length >= 2
            //             ? parseFloat((((chartDataWithDates[chartDataWithDates.length - 1]?.price || 0) - (chartDataWithDates[0]?.price || 0)) / (chartDataWithDates[0]?.price || 1) * 100).toFixed(1))
            //             : 0,
            //     });
            // }

        } catch (error) {
            console.error('Error searching database:', error);
            setSearchError('Search failed. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    /**
     * Process scanned image using AI Vision (matching mobile app's scanner_provider.dart)
     * OPTIMIZED: identify-card returns category, so we skip separate classify-card call
     * Flow:
     * 1. Identify card with AI (get name, number, language, category)
     * 2. For Pokemon: search TCGCSV database with correct category
     * 3. Display results
     */
    const processScannedImage = async (imageBase64: string, shouldIncrementUsage = true) => {
        if (!SUPABASE_URL) {
            console.log('Supabase URL not configured');
            return;
        }

        // Prevent concurrent scans - use ref for synchronous check
        if (scanInProgressRef.current) {
            console.log('Scan already in progress, ignoring...');
            return;
        }

        scanInProgressRef.current = true;
        setIsScanning(true);
        setIsLoading(true);
        setSearchError(null);
        setScanStatus('Identifying card...');

        try {
            setIsScannedResult(true);

            // Automatic retry with exponential backoff
            const RETRY_TIMEOUTS = [12000, 15000, 18000]; // 12s, 15s, 18s (reduced for speed)
            const RETRY_DELAYS = [0, 1000, 1500]; // 0s, 1s, 1.5s delay before retry
            const STATUS_MESSAGES = [
                'Identifying card...',
                'Still working... retrying...',
                'Almost there... one more try...',
            ];

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let identification: any = null;
            let lastError: Error | null = null;

            for (let attempt = 0; attempt < RETRY_TIMEOUTS.length; attempt++) {
                // Wait before retry (skip delay on first attempt)
                if (attempt > 0) {
                    setScanStatus(STATUS_MESSAGES[attempt]);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
                }

                const timeout = RETRY_TIMEOUTS[attempt];
                console.log(`AI identify attempt ${attempt + 1}/${RETRY_TIMEOUTS.length} (timeout: ${timeout / 1000}s)`);

                const aiController = new AbortController();
                const aiTimeoutId = setTimeout(() => aiController.abort(), timeout);

                try {
                    const identifyResponse = await fetch(
                        `${SUPABASE_URL}/functions/v1/identify-card`,
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}`,
                            },
                            body: JSON.stringify({ image: imageBase64 }),
                            signal: aiController.signal,
                        }
                    );

                    clearTimeout(aiTimeoutId);

                    if (identifyResponse.ok) {
                        identification = await identifyResponse.json();
                        console.log('Identification result:', identification);
                        break; // Success — exit retry loop
                    }

                    // Non-retryable client errors (4xx except 429)
                    if (identifyResponse.status >= 400 && identifyResponse.status < 500 && identifyResponse.status !== 429) {
                        const errorText = await identifyResponse.text();
                        console.error(`Identify API client error (${identifyResponse.status}):`, errorText);
                        lastError = new Error(`Client error: ${identifyResponse.status}`);
                        break; // Don't retry 4xx errors
                    }

                    // Server error (5xx) or rate limit (429) — retryable
                    const errorText = await identifyResponse.text();
                    console.warn(`Identify API error (${identifyResponse.status}), attempt ${attempt + 1}:`, errorText);
                    lastError = new Error(`Server error: ${identifyResponse.status}`);
                    // Continue to next retry

                } catch (fetchErr) {
                    clearTimeout(aiTimeoutId);
                    if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
                        console.warn(`AI identification timed out on attempt ${attempt + 1} (${timeout / 1000}s)`);
                        lastError = new Error('timeout');
                        // Continue to next retry
                    } else {
                        console.error(`Network error on attempt ${attempt + 1}:`, fetchErr);
                        lastError = fetchErr instanceof Error ? fetchErr : new Error('Network error');
                        // Continue to next retry
                    }
                }
            }

            // All retries exhausted or non-retryable error
            if (!identification) {
                const errorMsg = lastError?.message || 'unknown';
                if (errorMsg === 'timeout') {
                    setSearchError('AI took too long. Try with a clearer, well-lit photo.');
                } else if (errorMsg.startsWith('Server error')) {
                    setSearchError('Server is busy. Please try again in a moment.');
                } else if (errorMsg.startsWith('Client error')) {
                    setSearchError('Could not process image. Try a different photo.');
                } else {
                    setSearchError('Connection issue. Check your internet and try again.');
                }
                return;
            }

            // Automatic card detection: reject non-card images without charging credits
            if (identification.is_card === false) {
                console.log('AI detected image is NOT a Pokemon card');
                setSearchError(t('scan_not_a_card') || 'This doesn\'t look like a Pokemon card. Please upload a clear photo of a Pokemon trading card.');
                return;
            }

            setScanStatus('Card identified! Searching database...');

            // NOTE: incrementUsage is now called AFTER successful DB results found
            // to avoid charging credits when no cards are found

            // Get category from identification response (default to pokemon)
            const category = (identification.category || 'pokemon').toLowerCase();

            // Extract fields from new JSON format
            // New format: raw_jp_name, official_en_name, card_id, set_code, hp, language, category
            const cardName = identification.official_en_name || identification.cardName || identification.name;
            const cardNumber = identification.card_id || identification.cardNumber || identification.number;
            const language = identification.language; // 'Japanese' or 'English'
            const rawJpName = identification.raw_jp_name;
            const setCode = identification.set_code;

            if (!cardNumber && (!cardName || cardName === 'Unknown')) {
                console.log('AI Vision failed to identify card');
                setSearchError('Could not identify card. Please try with a clearer image.');
                return;
            }

            // Log the identification (translation is now done by identify-card)
            console.log(`Identified: "${cardName}" #${cardNumber || 'N/A'} (${language || 'unknown'})`);
            if (rawJpName) console.log(`Japanese: "${rawJpName}"`);
            if (setCode) console.log(`Set: ${setCode}`);

            setSearchTerm(cardName + (cardNumber ? ` #${cardNumber}` : ''));

            // Step 3: Search TCGCSV database using REST API
            // UNIFIED SCORING: Gather candidates from multiple search strategies,
            // then score them ALL together for the best possible match
            console.log(`Category from AI: "${identification.category}" -> using TCG search`);
            {
                console.log('Step 3: Searching TCGCSV database for TCG card...');

                const isJapanese = language?.toLowerCase() === 'japanese';
                const categoryId = isJapanese ? CATEGORY_POKEMON_JAPANESE : CATEGORY_POKEMON_ENGLISH;
                const altCategoryId = isJapanese ? CATEGORY_POKEMON_ENGLISH : CATEGORY_POKEMON_JAPANESE;

                // 10 second timeout (reduced for speed)
                const searchController = new AbortController();
                const searchTimeoutId = setTimeout(() => searchController.abort(), 10000);

                const searchFetch = (url: string) => fetch(url, {
                    headers: {
                        'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
                        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}`,
                    },
                    signal: searchController.signal,
                });

                const buildNameUrl = (name: string, catId: number, limit = 10) =>
                    `${SUPABASE_URL}/rest/v1/tcgcsv_products?category_id=eq.${catId}&name=ilike.*${encodeURIComponent(name)}*&market_price=not.is.null&order=market_price.desc&select=product_id,name,image_url,set_name,rarity,market_price,low_price,mid_price,high_price,number,tcgplayer_url,extended_data,category_id&limit=${limit}`;

                // --- REUSABLE SCORING FUNCTION ---
                // Scores a candidate product against ALL AI-provided signals
                type ScoredProduct = { product: TcgcsvProduct; score: number; breakdown: string };

                const scoreProduct = (p: { name: string; number: string | null; set_name: string | null; market_price: number }, numberFormats: string[]): ScoredProduct => {
                    let score = 0;
                    const reasons: string[] = [];

                    // --- NUMBER SCORE (0-30) ---
                    if (p.number && numberFormats.length > 0 && numberFormats.includes(p.number)) {
                        score += 30;
                        reasons.push(`num:exact(30)`);
                    } else if (p.number && cardNumber) {
                        const pNum = p.number.split('/')[0]?.replace(/^0+/, '');
                        const aiNum = cardNumber.replace(/[^\d/]/g, '').split('/')[0]?.replace(/^0+/, '');
                        if (pNum && aiNum && pNum === aiNum) {
                            score += 20;
                            reasons.push(`num:partial(20)`);
                        }
                    }

                    // --- NAME SCORE (0-40) ---
                    if (cardName) {
                        const pNameLower = p.name.toLowerCase();
                        const aiNameLower = cardName.toLowerCase();
                        const aiBaseName = aiNameLower.replace(/\s*(ex|v|gx|vmax|vstar)\s*$/i, '').trim();

                        if (pNameLower === aiNameLower || pNameLower.split(' - ')[0].trim() === aiNameLower) {
                            score += 40;
                            reasons.push(`name:exact(40)`);
                        } else if (pNameLower.includes(aiNameLower) || pNameLower.includes(aiBaseName)) {
                            score += 30;
                            reasons.push(`name:contains(30)`);
                        } else {
                            const aiFirstWord = aiNameLower.split(/[\s']/)[0];
                            const pFirstWord = pNameLower.split(/[\s']/)[0];
                            const ownerAliases: Record<string, string[]> = {
                                'mc': ['emcee', 'mc'], 'emcee': ['emcee', 'mc'],
                            };
                            const aiTerms = ownerAliases[aiFirstWord] || [aiFirstWord];

                            if (aiTerms.some(t => pFirstWord.includes(t) || t.includes(pFirstWord))) {
                                score += 20;
                                reasons.push(`name:firstWord(20)`);
                            } else if (aiNameLower.includes("'s ")) {
                                const pokemonPart = aiNameLower.split("'s ").pop() || '';
                                if (pNameLower.includes(pokemonPart)) {
                                    score += 15;
                                    reasons.push(`name:pokemon(15)`);
                                }
                            } else {
                                const aiWords = aiNameLower.split(/\s+/).filter((w: string) => w.length > 2);
                                const matchingWords = aiWords.filter((w: string) => pNameLower.includes(w));
                                if (matchingWords.length > 0) {
                                    const wordScore = Math.min(10, matchingWords.length * 5);
                                    score += wordScore;
                                    reasons.push(`name:words(${wordScore})`);
                                }
                            }
                        }
                    }

                    // --- SET SCORE (0-30) ---
                    if (setCode && p.set_name) {
                        const setLower = setCode.toLowerCase();
                        const dbSetLower = p.set_name.toLowerCase();

                        if (dbSetLower.includes(setLower) || setLower.includes(dbSetLower)) {
                            score += 30;
                            reasons.push(`set:exact(30)`);
                        } else {
                            const fuzzyVariants = [
                                setLower,
                                setLower.replace(/5/g, 's'),
                                setLower.replace(/s/g, '5'),
                                setLower.replace(/0/g, 'o'),
                                setLower.replace(/o/g, '0'),
                                setLower.replace(/1/g, 'l'),
                                setLower.replace(/l/g, '1'),
                                setLower.replace('m15', 'm1s'),
                                setLower.replace('m1s', 'm15'),
                            ];
                            const fuzzyMatch = fuzzyVariants.some(v => dbSetLower.includes(v) || v.includes(dbSetLower));
                            if (fuzzyMatch) {
                                score += 20;
                                reasons.push(`set:fuzzy(20)`);
                            }
                        }
                    }

                    return { product: p as TcgcsvProduct, score, breakdown: reasons.join(' ') };
                };

                try {
                    // --- GATHER ALL CANDIDATES from multiple search strategies ---
                    const allCandidates: TcgcsvProduct[] = [];
                    const seenIds = new Set<number>(); // Deduplicate by product_id

                    const addCandidates = (products: TcgcsvProduct[]) => {
                        for (const p of products) {
                            if (!seenIds.has(p.product_id)) {
                                seenIds.add(p.product_id);
                                allCandidates.push(p);
                            }
                        }
                    };

                    // Build number format variations
                    let altFormatsArray: string[] = [];
                    if (cardNumber) {
                        let cleanNumber = cardNumber.replace(/[^\d/]/g, '').trim();
                        if (!cleanNumber.includes('/') && /^\d+$/.test(cleanNumber) && cleanNumber.length >= 4 && cleanNumber.length % 2 === 0) {
                            const midPoint = Math.floor(cleanNumber.length / 2);
                            cleanNumber = cleanNumber.substring(0, midPoint) + '/' + cleanNumber.substring(midPoint);
                        }

                        const parts = cleanNumber.split('/');
                        const altFormats = new Set<string>([cleanNumber]);

                        if (parts.length === 2) {
                            const collectorInt = parseInt(parts[0], 10);
                            const setTotalInt = parseInt(parts[1], 10);

                            const collectorVariations = [
                                collectorInt.toString(),
                                collectorInt.toString().padStart(2, '0'),
                                collectorInt.toString().padStart(3, '0'),
                            ];
                            const setTotalVariations = [
                                setTotalInt.toString(),
                                setTotalInt.toString().padStart(2, '0'),
                                setTotalInt.toString().padStart(3, '0'),
                            ];

                            for (const col of collectorVariations) {
                                for (const total of setTotalVariations) {
                                    altFormats.add(col + '/' + total);
                                }
                            }
                        }
                        altFormatsArray = Array.from(altFormats);
                    }

                    // Helper: fetch both categories in parallel for a given URL builder
                    const searchBothCategories = async (buildUrl: (catId: number) => string, label: string) => {
                        const results = await Promise.allSettled(
                            [categoryId, altCategoryId].map(async (catId) => {
                                const response = await searchFetch(buildUrl(catId));
                                if (response.ok) {
                                    const products = await response.json();
                                    if (products?.length > 0) {
                                        console.log(`  Found ${products.length} by ${label} (cat: ${catId})`);
                                        return products;
                                    }
                                }
                                return [];
                            })
                        );
                        for (const r of results) {
                            if (r.status === 'fulfilled' && r.value.length > 0) addCandidates(r.value);
                        }
                    };

                    // --- SEARCH STRATEGY 1: By card number (both categories in parallel) ---
                    if (altFormatsArray.length > 0) {
                        const numberClauses = altFormatsArray.map((n: string) => `number.eq.${encodeURIComponent(n)}`).join(',');
                        console.log(`TCGCSV: Number search: ${altFormatsArray.join(', ')}`);
                        await searchBothCategories(
                            (catId) => `${SUPABASE_URL}/rest/v1/tcgcsv_products?category_id=eq.${catId}&or=(${numberClauses})&select=product_id,name,image_url,set_name,rarity,market_price,low_price,mid_price,high_price,number,tcgplayer_url,extended_data,category_id&limit=20`,
                            'number'
                        );
                    }

                    // --- SEARCH STRATEGIES 2 & 3: By name + base name (all in parallel) ---
                    if (cardName) {
                        const baseName = cardName.replace(/\s*(ex|EX|Ex|V|GX|Gx|VMAX|Vmax|VSTAR|Vstar)\s*$/i, '').trim();
                        const nameSearches: Promise<void>[] = [];

                        // Strategy 2: Full name search (both categories)
                        console.log(`TCGCSV: Name search: "${cardName}"`);
                        nameSearches.push(searchBothCategories((catId) => buildNameUrl(cardName, catId, 10), 'name'));

                        // Strategy 3: Base name search (both categories, only if different)
                        if (baseName && baseName !== cardName) {
                            console.log(`TCGCSV: Base name search: "${baseName}"`);
                            nameSearches.push(searchBothCategories((catId) => buildNameUrl(baseName, catId, 10), 'base name'));
                        }

                        // Run strategies 2 & 3 simultaneously
                        await Promise.allSettled(nameSearches);
                    }

                    // --- SEARCH STRATEGY 4: Word-split fallback for compound names ---
                    // e.g. AI returns "KochiKing ex" but DB has "Kochiking ex" or different transliteration
                    if (cardName && allCandidates.length === 0) {
                        // Split camelCase/PascalCase compound names (e.g. "KochiKing" -> ["Kochi", "King"])
                        const splitCamel = cardName.replace(/([a-z])([A-Z])/g, '$1 $2');
                        // Also strip suffixes like ex/V/GX for broader search
                        const cleanedName = splitCamel.replace(/\s*(ex|EX|Ex|V|GX|Gx|VMAX|Vmax|VSTAR|Vstar)\s*$/i, '').trim();
                        const words = cleanedName.split(/\s+/).filter((w: string) => w.length >= 3);

                        if (words.length > 0 && (splitCamel !== cardName || words.length > 1)) {
                            console.log(`TCGCSV: Word-split fallback: [${words.join(', ')}]`);
                            for (const word of words) {
                                for (const catId of [categoryId, altCategoryId]) {
                                    try {
                                        const response = await searchFetch(buildNameUrl(word, catId, 15));
                                        if (response.ok) {
                                            const products = await response.json();
                                            if (products?.length > 0) {
                                                console.log(`  Found ${products.length} by word '${word}' (cat: ${catId})`);
                                                addCandidates(products);
                                            }
                                        }
                                    } catch { /* continue */ }
                                }
                            }
                        }
                    }

                    clearTimeout(searchTimeoutId);

                    // --- SCORE ALL CANDIDATES TOGETHER ---
                    if (allCandidates.length > 0) {
                        console.log(`\nScoring ${allCandidates.length} total candidates:`);

                        const scored = allCandidates.map(p => scoreProduct(p, altFormatsArray));
                        scored.sort((a, b) => b.score - a.score || (b.product.market_price || 0) - (a.product.market_price || 0));

                        // Log top 5 for debugging
                        scored.slice(0, 5).forEach((s, i) => {
                            console.log(`  ${i + 1}. [${s.score}pts] ${s.product.name} #${s.product.number} (${s.product.set_name}) — ${s.breakdown}`);
                        });

                        const bestMatch = scored[0];
                        console.log(`\n✅ Best match: ${bestMatch.product.name} #${bestMatch.product.number} (score: ${bestMatch.score}/100)`);

                        await displayProductResult(bestMatch.product);
                        // Store top 5 for the selection dialog
                        setScanResults(scored.slice(0, 5));
                        setShowScanResultsDialog(true);

                        // Only count scan usage when results were found
                        if (shouldIncrementUsage) {
                            await incrementUsage();
                        }
                    } else {
                        setSearchError(`No cards found for "${cardName}"`);
                    }
                } catch (searchErr: unknown) {
                    clearTimeout(searchTimeoutId);
                    if (searchErr instanceof Error && searchErr.name === 'AbortError') {
                        console.log('Search timed out');
                        setSearchError('Database search timed out. Please try again.');
                    } else {
                        console.error('Search error:', searchErr);
                        setSearchError('Database search failed. Please try again.');
                    }
                }
            }

        } catch (error: unknown) {
            console.error('Error processing scanned image:', error);
            setSearchError('Failed to scan card. Please try again.');
        } finally {
            scanInProgressRef.current = false;
            setIsScanning(false);
            setIsLoading(false);
            setScanStatus('');

        }
    };

    // Handle selecting a card from the top 5 results dialog
    const handleSelectScanResult = async (result: ScoredResult) => {
        setShowScanResultsDialog(false);
        setIsLoading(true);
        await displayProductResult(result.product);
        setIsLoading(false);
    };

    // Helper function to display a product result (extracted from fetchFeaturedProduct)
    const displayProductResult = async (featured: TcgcsvProduct) => {
        // Parse extended_data for card details
        let cardDetails: Record<string, string> = {};
        try {
            const extData = typeof featured.extended_data === 'string'
                ? JSON.parse(featured.extended_data)
                : featured.extended_data;
            if (Array.isArray(extData)) {
                for (const item of extData as Array<{ name: string; value: string }>) {
                    if (item.name && item.value) {
                        cardDetails[item.name] = item.value;
                    }
                }
            }
        } catch (e) {
            console.log('Error parsing extended_data:', e);
        }

        const isFirstEdition = featured.name?.toLowerCase().includes('1st edition') || false;
        const isHolo = featured.name?.toLowerCase().includes('holo') || false;
        const displayName = featured.name?.replace(/\s*-?\s*(holo|holofoil|1st edition)/gi, '').trim() || featured.name;

        const productData: ProductData = {
            product_id: featured.product_id,
            name: featured.name,
            displayName,
            image_url: featured.image_url,
            set_name: featured.set_name,
            rarity: featured.rarity,
            market_price: featured.market_price,
            low_price: featured.low_price,
            high_price: featured.high_price,
            number: featured.number,
            isFirstEdition,
            isHolo,
            tcgplayer_url: featured.tcgplayer_url,
            cardType: cardDetails['Card Type'] || null,
            hp: cardDetails['HP'] || null,
            stage: cardDetails['Stage'] || null,
            attack1: cardDetails['Attack 1'] || null,
            attack2: cardDetails['Attack 2'] || null,
            attack3: cardDetails['Attack 3'] || null,
            weakness: cardDetails['Weakness'] || null,
            resistance: cardDetails['Resistance'] || null,
            retreatCost: cardDetails['RetreatCost'] || null,
            artist: cardDetails['Artist'] || null,
            category_id: featured.category_id,
        };

        setProduct(productData);
        setCurrentPrice(featured.market_price);
        setSearchError(null);

        // Fetch price history using REST API (faster than Supabase client)
        try {
            const historyUrl = `${SUPABASE_URL}/rest/v1/tcgcsv_price_history?product_id=eq.${featured.product_id}&order=recorded_at.asc&select=recorded_at,market_price&limit=365`;
            const historyResponse = await fetch(historyUrl, {
                headers: {
                    'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
                },
            });

            if (historyResponse.ok) {
                const history = await historyResponse.json();

                // DEBUG: Log price history data
                console.log(`[PRICE HISTORY] Product ID: ${featured.product_id}`);
                console.log(`[PRICE HISTORY] Records found: ${history?.length || 0}`);
                console.log('[PRICE HISTORY] Data:', history);

                if (history && history.length > 0) {
                    const chartDataWithDates = history.map((h: PriceHistoryRecord) => ({
                        date: new Date(h.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                        price: h.market_price || 0,
                        dateObj: new Date(h.recorded_at),
                    }));
                    setFullChartData(chartDataWithDates);

                    // Initial filtering based on current timeframe
                    const filteredData = filterChartDataByTimeframe(chartDataWithDates, timeFrame);
                    setChartData(filteredData.length > 0 ? filteredData : chartDataWithDates.map((d: { date: string; price: number; dateObj: Date }) => ({ date: d.date, price: d.price })));

                    // Calculate price change
                    const dataToUse = filteredData.length > 0 ? filteredData : chartDataWithDates;
                    if (dataToUse.length >= 2) {
                        const first = dataToUse[0]?.price || featured.market_price;
                        const last = dataToUse[dataToUse.length - 1]?.price || featured.market_price;
                        const change = first > 0 ? ((last - first) / first * 100) : 0;
                        setPriceChange(parseFloat(change.toFixed(1)));
                    } else {
                        setPriceChange(0);
                    }
                    setUseMockData(false);
                    // Cache removed
                    // setSpotlightCache({
                    //     product: productData,
                    //     chartData: chartDataWithDates,
                    //     currentPrice: featured.market_price,
                    //     priceChange: chartDataWithDates.length >= 2
                    //         ? parseFloat((((chartDataWithDates[chartDataWithDates.length - 1]?.price || 0) - (chartDataWithDates[0]?.price || 0)) / (chartDataWithDates[0]?.price || 1) * 100).toFixed(1))
                    //         : 0,
                    // });
                } else {
                    // Use mock data if no history
                    const now = new Date();
                    const adjustedMock = MOCK_DATA.map((d, i) => ({
                        date: d.date,
                        price: Math.round(featured.market_price * (0.85 + (i / MOCK_DATA.length) * 0.15)),
                        dateObj: new Date(now.getTime() - (MOCK_DATA.length - i) * 2 * 24 * 60 * 60 * 1000),
                    }));
                    setFullChartData(adjustedMock);
                    setChartData(adjustedMock.map((d: { date: string; price: number }) => ({ date: d.date, price: d.price })));
                    setPriceChange(0);
                    setUseMockData(true);
                    // Cache removed
                    // setSpotlightCache({
                    //     product: productData,
                    //     chartData: adjustedMock,
                    //     currentPrice: featured.market_price,
                    //     priceChange: 0,
                    // });
                }
            } else {
                // Fallback to mock data on error
                const now = new Date();
                const adjustedMock = MOCK_DATA.map((d, i) => ({
                    date: d.date,
                    price: Math.round(featured.market_price * (0.85 + (i / MOCK_DATA.length) * 0.15)),
                    dateObj: new Date(now.getTime() - (MOCK_DATA.length - i) * 2 * 24 * 60 * 60 * 1000),
                }));
                setFullChartData(adjustedMock);
                setChartData(adjustedMock.map((d: { date: string; price: number }) => ({ date: d.date, price: d.price })));
                setPriceChange(0);
                setUseMockData(true);
            }
        } catch (e) {
            // Fallback to mock data on error
            const adjustedMock = MOCK_DATA.map((d, i) => ({
                ...d,
                price: Math.round(featured.market_price * (0.85 + (i / MOCK_DATA.length) * 0.15))
            }));
            setChartData(adjustedMock);
            setPriceChange(0);
            setUseMockData(true);
        }
    };

    /**
     * Preprocess image for AI recognition (like mobile app's ImagePreprocessor)
     * Note: Mobile skips preprocessing for gallery images - they're already clean
     * For web uploads, we only resize to reduce processing time
     */
    const preprocessImage = (imageBase64: string): Promise<string> => {
        return new Promise((resolve) => {
            const img = document.createElement('img') as HTMLImageElement;
            img.onload = () => {
                // Create canvas
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(imageBase64);
                    return;
                }

                // Only resize if too large (max 1024px for speed — AI doesn't need higher)
                const maxWidth = 1024;
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    const ratio = maxWidth / width;
                    width = maxWidth;
                    height = Math.round(height * ratio);
                }

                canvas.width = width;
                canvas.height = height;

                // Draw image (no contrast/brightness changes - preserve original quality)
                ctx.drawImage(img, 0, 0, width, height);

                // Convert to base64 (JPEG quality 85% — balanced quality/speed)
                const enhancedBase64 = canvas.toDataURL('image/jpeg', 0.85);
                const base64Data = enhancedBase64.split(',')[1];

                console.log(`Image resized: ${img.width}x${img.height} -> ${width}x${height}`);
                resolve(base64Data);
            };

            img.onerror = () => {
                console.log('Image load failed, using original');
                resolve(imageBase64);
            };

            img.src = `data:image/jpeg;base64,${imageBase64}`;
        });
    };

    // Handle file selection for CAMERA capture (direct scan, no crop)
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64 = reader.result as string;
            // Remove data URL prefix if present
            const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;

            // Preprocess image for better AI recognition
            console.log('Preprocessing image for AI...');
            const enhancedBase64 = await preprocessImage(base64Data);

            // Check scan limit before processing
            if (!canScan) {
                setShowLimitModal(true);
                return;
            }

            processScannedImage(enhancedBase64, true);
        };
        reader.readAsDataURL(file);
    };

    // Handle file selection for GALLERY upload (opens crop modal)
    const handleGallerySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            setCropImageSrc(base64);
            setShowCropModal(true);
            // Reset crop to undefined so a new one is created on image load
            setCrop(undefined);
        };
        reader.readAsDataURL(file);
        // Reset input so same file can be selected again
        e.target.value = '';
    };

    // Initialize crop when image loads in crop modal
    const onCropImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        const { width, height } = e.currentTarget;
        // Create a centered crop with 3:4 aspect ratio (card portrait)
        const newCrop = centerCrop(
            makeAspectCrop({ unit: '%', width: 80 }, 3 / 4, width, height),
            width,
            height
        );
        setCrop(newCrop);
    }, []);

    // Complete crop and process the cropped image
    const handleCropComplete = useCallback(async () => {
        if (!crop || !cropImgRef.current) return;

        const image = cropImgRef.current;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Calculate crop dimensions in pixels
        const scaleX = image.naturalWidth / image.width;
        const scaleY = image.naturalHeight / image.height;

        const cropX = (crop.x / 100) * image.width * scaleX;
        const cropY = (crop.y / 100) * image.height * scaleY;
        const cropWidth = (crop.width / 100) * image.width * scaleX;
        const cropHeight = (crop.height / 100) * image.height * scaleY;

        canvas.width = cropWidth;
        canvas.height = cropHeight;

        ctx.drawImage(
            image,
            cropX,
            cropY,
            cropWidth,
            cropHeight,
            0,
            0,
            cropWidth,
            cropHeight
        );

        // Convert to base64
        const croppedBase64 = canvas.toDataURL('image/jpeg', 0.95);
        const base64Data = croppedBase64.split(',')[1];

        // Close modal
        setShowCropModal(false);
        setCropImageSrc('');

        // Preprocess and scan
        console.log('Cropped image, preprocessing for AI...');
        const enhancedBase64 = await preprocessImage(base64Data);
        // Check scan limit before processing
        if (!canScan) {
            setShowLimitModal(true);
            return;
        }

        processScannedImage(enhancedBase64, true);
    }, [crop, processScannedImage, canScan]);

    // Use original image without cropping
    const handleUseOriginal = useCallback(async () => {
        if (!cropImageSrc) return;

        // Extract base64 data from the data URL
        const base64Data = cropImageSrc.split(',')[1];

        // Close modal
        setShowCropModal(false);
        setCropImageSrc('');

        // Preprocess and scan original image
        console.log('Using original image, preprocessing for AI...');
        const enhancedBase64 = await preprocessImage(base64Data);
        // Check scan limit before processing
        if (!canScan) {
            setShowLimitModal(true);
            return;
        }

        processScannedImage(enhancedBase64, true);
    }, [cropImageSrc, processScannedImage, canScan]);

    // Trigger camera input click
    const handleScanClick = () => {
        fileInputRef.current?.click();
    };

    // Trigger gallery input click
    const handleUploadClick = () => {
        galleryInputRef.current?.click();
    };

    useEffect(() => {
        // Pre-warm the REST API connection with a lightweight query
        const prewarmConnection = async () => {
            try {
                await fetch(`${SUPABASE_URL}/rest/v1/tcgcsv_products?select=product_id&limit=1`, {
                    headers: {
                        'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
                    },
                });
                console.log('Database connection pre-warmed');
            } catch (e) {
                // Ignore errors - this is just a pre-warm
            }
        };

        // Pre-warm the identify-card Edge Function
        const prewarmIdentifyFunction = async () => {
            try {
                await fetch(`${SUPABASE_URL}/functions/v1/identify-card`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}`,
                    },
                    body: JSON.stringify({ ping: true }),
                });
                console.log('Identify function pre-warmed');
            } catch (e) {
                // Ignore errors - this is just a pre-warm
            }
        };

        // Pre-warm the translate-jp Edge Function
        const prewarmTranslateFunction = async () => {
            try {
                await fetch(`${SUPABASE_URL}/functions/v1/translate-jp`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}`,
                    },
                    body: JSON.stringify({ ping: true }),
                });
                console.log('Translate function pre-warmed');
            } catch (e) {
                // Ignore errors - this is just a pre-warm
            }
        };

        prewarmConnection();
        prewarmIdentifyFunction();
        prewarmTranslateFunction();
        fetchFeaturedProduct();
    }, []);

    // Use centralized currency formatting from context
    const { formatPrice, convertPrice } = useCurrency();
    const { t } = useLocalization();

    // Get display image - use TCG image or fallback
    const getDisplayImage = () => {
        if (product?.image_url) {
            return product.image_url;
        }
        // Fallback placeholder
        return 'https://images.unsplash.com/photo-1613771404721-1f92d799e49f?q=80&w=1000&auto=format&fit=crop';
    };

    const handleSearch = () => {
        if (searchTerm.trim()) {
            setIsScannedResult(false);
            fetchFeaturedProduct(searchTerm.trim());
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

    return (
        <section id="market-spotlight" className="py-16 md:py-24 bg-[#111111] relative overflow-hidden border-y border-white/5">
            {/* Ambient Background Glows */}
            <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-green-500/10 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none" />

            <div className="container mx-auto px-4">
                {/* Search Section */}
                <div className="text-center mb-16 md:mb-24 px-2">
                    <h2 className="text-2xl md:text-5xl font-bold mb-3 text-white tracking-tight break-words" style={{ fontFamily: "'Orbitron', sans-serif" }}>
                        {t('collection_worth_pokemon_title')}
                    </h2>
                    <p className="text-lg md:text-2xl font-normal text-orange-500 font-sans mb-8 break-words">
                        {t('collection_worth_pokemon_subtitle')}
                    </p>

                    {/* CTA for other categories */}
                    <div className="flex justify-center mb-8">
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button
                                    variant="outline"
                                    className="bg-white/5 border-white/20 hover:bg-white/10 text-white/80 hover:text-white rounded-full px-6 py-2 h-auto text-sm md:text-base font-medium transition-all hover:scale-105 hover:border-white/40 whitespace-normal text-center"
                                >
                                    {t('other_tcg_button')} <ArrowsClockwise className="ml-2 w-4 h-4" />
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-lg w-[95vw] max-w-[500px] bg-[#0a0a0a] border-white/10 text-white p-0 overflow-hidden shadow-2xl [&>button]:w-10 [&>button]:h-10 [&>button]:bg-transparent [&>button]:text-white/80 [&>button]:hover:text-red-500 [&>button]:hover:bg-transparent [&>button]:rounded-full [&>button]:z-50 [&>button]:top-4 [&>button]:right-4 [&>button_svg]:w-6 [&>button_svg]:h-6 [&>button_svg]:stroke-[3]">
                                <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
                                <DialogHeader className="px-6 pt-6 pb-2 relative z-10">
                                    <DialogTitle className="text-2xl font-bold text-center tracking-tight font-display">{t('select_category_title')}</DialogTitle>
                                    <p className="text-center text-gray-400 text-sm">{t('select_category_desc')}</p>
                                </DialogHeader>
                                <div className="grid grid-cols-2 gap-4 p-6 relative z-10">
                                    <Button
                                        onClick={() => router.push('/soccer')}
                                        className="h-48 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-emerald-950 to-green-950 hover:from-emerald-900 hover:to-green-900 border border-emerald-500/20 hover:border-emerald-400/50 transition-all group relative overflow-hidden rounded-xl"
                                    >
                                        <div className="absolute inset-0 bg-[url('/assets/pattern-soccer.png')] opacity-10 bg-repeat" />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

                                        <div className="relative w-24 h-24 transition-transform duration-300 group-hover:scale-110 drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                                            <Image
                                                src="/assets/soc-logo.png"
                                                alt="Soccer"
                                                fill
                                                className="object-contain"
                                            />
                                        </div>
                                        <div className="relative text-center">
                                            <span className="font-bold text-xl text-emerald-100 block tracking-wide">{t('nav_soccer')}</span>
                                            <span className="text-xs text-emerald-400/80 font-medium uppercase tracking-wider mt-1 block">Sports Market</span>
                                        </div>
                                    </Button>

                                    <Button
                                        onClick={() => router.push('/onepiece')}
                                        className="h-48 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-red-950 to-pink-950 hover:from-red-900 hover:to-pink-900 border border-red-500/20 hover:border-red-400/50 transition-all group relative overflow-hidden rounded-xl"
                                    >
                                        <div className="absolute inset-0 bg-[url('/assets/pattern-onepiece.png')] opacity-10 bg-repeat" />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

                                        <div className="relative w-24 h-24 transition-transform duration-300 group-hover:scale-110 drop-shadow-[0_0_15px_rgba(239,68,68,0.3)]">
                                            <Image
                                                src="/assets/one-logo.png"
                                                alt="One Piece"
                                                fill
                                                className="object-contain"
                                            />
                                        </div>
                                        <div className="relative text-center">
                                            <span className="font-bold text-xl text-red-100 block tracking-wide">{t('nav_onepiece')}</span>
                                            <span className="text-xs text-red-400/80 font-medium uppercase tracking-wider mt-1 block">Anime TCG</span>
                                        </div>
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>

                    <div className="max-w-2xl mx-auto relative mb-6 group">
                        {/* Glow effect */}
                        <div className="absolute -inset-1 bg-gradient-to-r from-orange-600 to-amber-600 rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>

                        <div
                            className="relative flex items-center bg-black/80 rounded-full border border-white/10 p-1.5 shadow-2xl cursor-pointer hover:bg-black/90 transition-colors"
                            onClick={handleUploadClick}
                        >
                            <div className="w-full bg-transparent border-none text-gray-400 text-base md:text-lg px-6 py-2 font-medium rounded-l-full flex items-center">
                                {t('scan_pokemon_card')}
                            </div>
                            {/* Hidden file input for image selection (camera or gallery) */}
                            <input
                                ref={galleryInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleGallerySelect}
                                className="hidden"
                            />
                            {/* Smart Scan Status Badge — adapts to subscription type */}
                            {user && (() => {
                                // Calculate hours left for Day Pass
                                const hoursLeft = scanSub?.expires_at
                                    ? Math.max(0, Math.ceil((new Date(scanSub.expires_at).getTime() - Date.now()) / (1000 * 60 * 60)))
                                    : 0;

                                if (scanType === 'day_pass') {
                                    return (
                                        <div className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full bg-gradient-to-r from-cyan-500/20 to-blue-500/10 border border-cyan-500/30 text-cyan-50 text-[11px] sm:text-xs font-semibold mr-1 sm:mr-2 backdrop-blur-md shadow-[inset_0_1px_4px_rgba(255,255,255,0.1)] transition-all">
                                            <Timer className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.8)]" weight="fill" />
                                            <span className="hidden sm:inline-block tracking-wide">
                                                {t('scan_daypass_nolimit', { hours: hoursLeft.toString() })}
                                            </span>
                                            <span className="sm:hidden tracking-wide whitespace-nowrap">
                                                {t('scan_daypass_nolimit_short', { hours: hoursLeft.toString() })}
                                            </span>
                                        </div>
                                    );
                                }

                                if (scanType === 'unlimited') {
                                    return (
                                        <div className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full bg-gradient-to-r from-purple-500/20 to-violet-500/10 border border-purple-500/30 text-purple-50 text-[11px] sm:text-xs font-semibold mr-1 sm:mr-2 backdrop-blur-md shadow-[inset_0_1px_4px_rgba(255,255,255,0.1)] transition-all">
                                            <Crown className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-purple-400 drop-shadow-[0_0_6px_rgba(168,85,247,0.8)]" weight="fill" />
                                            <span className="hidden sm:inline-block tracking-wide">
                                                {t('scan_vip_unlimited')}
                                            </span>
                                            <span className="sm:hidden tracking-wide whitespace-nowrap">
                                                {t('scan_vip_unlimited_short')}
                                            </span>
                                        </div>
                                    );
                                }

                                if (scanType === 'credit') {
                                    return (
                                        <div className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full bg-gradient-to-r from-emerald-500/20 to-green-500/10 border border-emerald-500/30 text-emerald-50 text-[11px] sm:text-xs font-semibold mr-1 sm:mr-2 backdrop-blur-md shadow-[inset_0_1px_4px_rgba(255,255,255,0.1)] transition-all">
                                            <CreditCard className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.8)]" weight="fill" />
                                            <span className="hidden sm:inline-block tracking-wide">
                                                {t('scan_credits_left', { remaining: scansRemaining.toString() })}
                                            </span>
                                            <span className="sm:hidden tracking-wide whitespace-nowrap">
                                                {t('scan_credits_left_short', { remaining: scansRemaining.toString() })}
                                            </span>
                                        </div>
                                    );
                                }

                                // Free user — default orange badge
                                return (
                                    <div className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full bg-gradient-to-r from-orange-500/20 to-amber-500/10 border border-orange-500/30 text-orange-50 text-[11px] sm:text-xs font-semibold mr-1 sm:mr-2 backdrop-blur-md shadow-[inset_0_1px_4px_rgba(255,255,255,0.1)] transition-all">
                                        <Lightning className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-orange-400 drop-shadow-[0_0_6px_rgba(249,115,22,0.8)]" weight="fill" />
                                        <span className="hidden sm:inline-block tracking-wide">
                                            {t('scan_remaining', { remaining: scansRemaining.toString() })}
                                        </span>
                                        <span className="sm:hidden tracking-wide whitespace-nowrap">
                                            {t('scan_remaining_short', { remaining: scansRemaining.toString() })}
                                        </span>
                                    </div>
                                );
                            })()}
                            {/* Upload/Camera button - opens image picker with crop */}
                            <Button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleUploadClick();
                                }}
                                disabled={isLoading || isScanning}
                                className="relative rounded-full bg-orange-500 hover:bg-orange-600 text-white h-10 w-10 md:h-11 md:w-11 p-0 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(249,115,22,0.5)] transition-transform active:scale-95 disabled:opacity-50"
                                title="Upload or take photo"
                            >
                                {isScanning ? (
                                    <SpinnerGap className="h-5 w-5 animate-spin" weight="bold" />
                                ) : (
                                    <Camera className="h-5 w-5 md:h-6 md:w-6" />
                                )}
                            </Button>
                        </div>
                    </div>

                    {/* Scan progress status */}
                    {isScanning && scanStatus && (
                        <div className="flex items-center justify-center gap-2 mb-4 animate-in fade-in duration-300">
                            <SpinnerGap className="w-4 h-4 animate-spin text-orange-400" weight="bold" />
                            <p className="text-sm text-orange-400 font-medium">{scanStatus}</p>
                        </div>
                    )}

                    {/* Error message */}
                    {searchError && !isScanning && (
                        <p className="text-sm text-red-400 mb-4">{searchError}</p>
                    )}

                    <div className="max-w-max mx-auto px-4 sm:px-5 py-2 mt-4 bg-gradient-to-r from-orange-500/10 via-amber-500/5 to-transparent backdrop-blur-md border border-orange-500/20 rounded-full flex items-center shadow-[0_0_20px_rgba(249,115,22,0.1)] transition-all hover:bg-orange-500/10">
                        <Timer className="w-4 h-4 text-orange-400 mr-2 sm:mr-3 shrink-0" weight="duotone" />
                        <p className="text-[11px] sm:text-xs md:text-sm text-orange-200/90 font-medium tracking-wide">
                            {t('content_update_time')}
                        </p>
                    </div>

                    {/* Top 5 Scan Results Dialog */}
                    <Dialog open={showScanResultsDialog} onOpenChange={setShowScanResultsDialog}>
                        <DialogContent className="bg-zinc-950 border-white/10 text-white max-w-md sm:max-w-lg p-0 rounded-2xl overflow-hidden">
                            <DialogHeader className="px-5 pt-5 pb-3 border-b border-white/10">
                                <DialogTitle className="text-lg font-bold flex items-center gap-2">
                                    <MagnifyingGlass className="w-5 h-5 text-yellow-400" weight="bold" />
                                    {t('scan_select_card') || 'Select Your Card'}
                                </DialogTitle>
                                <p className="text-xs text-white/50 mt-1">{t('scan_top_matches') || 'Top matches from scan — tap to select'}</p>
                            </DialogHeader>
                            <div className="px-3 py-3 max-h-[60vh] overflow-y-auto space-y-2">
                                {scanResults.map((result, index) => (
                                    <button
                                        key={result.product.product_id}
                                        onClick={() => handleSelectScanResult(result)}
                                        className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] ${
                                            index === 0
                                                ? 'bg-gradient-to-r from-yellow-500/15 to-orange-500/10 border border-yellow-500/40 shadow-[0_0_15px_rgba(234,179,8,0.1)]'
                                                : 'bg-white/5 border border-white/5 hover:border-white/20 hover:bg-white/10'
                                        }`}
                                    >
                                        {/* Rank */}
                                        <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                                            index === 0 ? 'bg-yellow-500 text-black' : 'bg-white/10 text-white/60'
                                        }`}>
                                            {index + 1}
                                        </div>

                                        {/* Image */}
                                        <div className="relative w-12 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-black/40">
                                            {result.product.image_url ? (
                                                <Image
                                                    src={result.product.image_url}
                                                    alt={result.product.name}
                                                    fill
                                                    className="object-contain p-0.5"
                                                    sizes="48px"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-xl">⚡</div>
                                            )}
                                        </div>

                                        {/* Card Info */}
                                        <div className="flex-1 min-w-0">
                                            <p className={`text-sm font-semibold truncate ${index === 0 ? 'text-yellow-300' : 'text-white'}`}>
                                                {result.product.name}
                                            </p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                {result.product.set_name && (
                                                    <span className="text-[10px] text-white/40 truncate max-w-[120px]">
                                                        {result.product.set_name}
                                                    </span>
                                                )}
                                                {result.product.number && (
                                                    <span className="text-[10px] text-white/30 font-mono">
                                                        #{result.product.number}
                                                    </span>
                                                )}
                                            </div>
                                            {/* Match score bar */}
                                            <div className="flex items-center gap-2 mt-1.5">
                                                <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all ${
                                                            result.score >= 60 ? 'bg-green-500' : result.score >= 30 ? 'bg-yellow-500' : 'bg-orange-500'
                                                        }`}
                                                        style={{ width: `${Math.min(100, result.score)}%` }}
                                                    />
                                                </div>
                                                <span className="text-[9px] text-white/30 font-mono w-8 text-right">{result.score}%</span>
                                            </div>
                                        </div>

                                        {/* Price */}
                                        <div className="flex-shrink-0 text-right">
                                            <p className={`text-sm font-bold ${index === 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                                                {formatPrice(result.product.market_price)}
                                            </p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>

                <div className="grid lg:grid-cols-2 gap-8 items-center">

                    {/* Left Column: The Asset */}
                    <div className="flex flex-col space-y-6 items-start text-left w-full">
                        {/* Info Header */}
                        <div className="space-y-3 w-full">
                            <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="text-green-400 border-green-400/30 px-3 py-1 w-fit whitespace-normal h-auto text-center">{t('market_spotlight')}</Badge>
                                {useMockData && (
                                    <Badge variant="outline" className="text-orange-400 border-orange-400/30 px-2 py-0.5 text-[10px] whitespace-normal h-auto text-center">{t('chart_demo')}</Badge>
                                )}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => fetchFeaturedProduct()}
                                    className="h-6 px-2 text-gray-400 hover:text-white"
                                >
                                    <ArrowsClockwise className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                                </Button>
                            </div>

                            <h2 className="text-xl md:text-2xl lg:text-3xl font-bold text-white font-mono tracking-tight leading-tight">
                                {isLoading ? (
                                    <span className="animate-pulse bg-white/10 rounded h-10 w-64 inline-block" />
                                ) : (
                                    <>
                                        {product?.displayName || 'Charizard Base Set'}
                                    </>
                                )}
                            </h2>

                            <div className="flex flex-wrap gap-2 text-sm text-gray-400 font-medium">
                                {product?.isFirstEdition && (
                                    <span className="px-2 py-1 bg-orange-500/20 text-orange-400 rounded border border-orange-500/30">{t('first_edition')}</span>
                                )}
                                {product?.rarity && (
                                    <span className="px-2 py-1 bg-white/5 rounded">{product.rarity}</span>
                                )}
                                {product?.isHolo && (
                                    <span className="px-2 py-1 bg-purple-500/20 text-purple-400 rounded border border-purple-500/30">{t('holo')}</span>
                                )}
                                {product?.set_name && (
                                    <span className="px-2 py-1 bg-white/5 rounded">{product.set_name}</span>
                                )}
                            </div>
                        </div>

                        {/* Card + Info Row */}
                        <div className="flex flex-row items-center justify-center gap-4 md:gap-8 w-full">
                            {/* Card Image */}
                            <div className="relative perspective-1000 group shrink-0">
                                {/* Ambient Glow */}
                                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[150px] md:w-[200px] h-[220px] md:h-[300px] bg-white/5 rounded-full blur-[40px] md:blur-[60px] pointer-events-none" />

                                <div className="relative w-[140px] xs:w-[160px] md:w-[280px] aspect-[3/4] transition-transform duration-500 ease-out transform group-hover:rotate-y-6 group-hover:scale-105 preserve-3d">
                                    {/* Card Glow */}
                                    <div className="absolute inset-0 bg-gradient-to-tr from-green-500/40 to-blue-500/40 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                                    {/* The Card Image */}
                                    <div className="absolute inset-0 rounded-xl overflow-hidden shadow-2xl border border-white/10 bg-[#1a1a1a]">
                                        {isLoading ? (
                                            <div className="w-full h-full animate-pulse bg-white/10" />
                                        ) : (
                                            <Image
                                                src={getDisplayImage()}
                                                alt={product?.name || 'Featured Card'}
                                                fill
                                                className="object-contain bg-[#1a1a1a]"
                                                unoptimized
                                            />
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Product Details (Right of Image) */}
                            <div className="flex flex-col gap-2 md:gap-3 text-left w-full max-w-[160px] xs:max-w-[180px] md:max-w-none">
                                {/* Market Price */}
                                <div className="space-y-0.5">
                                    <span className="text-gray-500 text-[9px] md:text-[10px] uppercase font-bold tracking-wider block">{t('market_price')}</span>
                                    {isLoading ? (
                                        <div className="h-6 md:h-8 w-24 md:w-32 bg-white/10 rounded animate-pulse" />
                                    ) : (
                                        <span className="text-green-400 text-xl md:text-2xl font-bold font-mono">
                                            {formatPrice(currentPrice || 0)}
                                        </span>
                                    )}
                                </div>

                                {/* Card Number */}
                                <div className="space-y-0.5">
                                    <span className="text-gray-500 text-[9px] md:text-[10px] uppercase font-bold tracking-wider block">{t('card_number')}</span>
                                    {isLoading ? (
                                        <div className="h-3 md:h-4 w-16 md:w-24 bg-white/10 rounded animate-pulse" />
                                    ) : (
                                        <span className="text-white text-xs md:text-sm font-medium break-words">
                                            {product?.number || '-'}
                                        </span>
                                    )}
                                </div>

                                {/* Rarity */}
                                <div className="space-y-0.5">
                                    <span className="text-gray-500 text-[9px] md:text-[10px] uppercase font-bold tracking-wider block">{t('filter_rarity')}</span>
                                    {isLoading ? (
                                        <div className="h-3 md:h-4 w-16 md:w-24 bg-white/10 rounded animate-pulse" />
                                    ) : (
                                        <span className="text-white text-xs md:text-sm font-medium break-words">
                                            {product?.rarity || '-'}
                                        </span>
                                    )}
                                </div>

                                {/* Card Type / HP / Stage */}
                                <div className="space-y-0.5">
                                    <span className="text-gray-500 text-[9px] md:text-[10px] uppercase font-bold tracking-wider block">{t('type_hp_stage')}</span>
                                    {isLoading ? (
                                        <div className="h-3 md:h-4 w-32 md:w-48 bg-white/10 rounded animate-pulse" />
                                    ) : (
                                        <span className="text-white text-xs md:text-sm font-medium break-words leading-tight block">
                                            {product?.cardType || '-'} / {product?.hp || '-'} / {product?.stage || '-'}
                                        </span>
                                    )}
                                </div>

                                {/* Attack - Only show when loaded or if loading (placeholder) */}
                                {(isLoading || product?.attack1) && (
                                    <div className="space-y-0.5">
                                        <span className="text-gray-500 text-[9px] md:text-[10px] uppercase font-bold tracking-wider block">{t('attack')}</span>
                                        {isLoading ? (
                                            <div className="space-y-1">
                                                <div className="h-2.5 md:h-3 w-full bg-white/10 rounded animate-pulse" />
                                                <div className="h-2.5 md:h-3 w-5/6 bg-white/10 rounded animate-pulse" />
                                            </div>
                                        ) : (
                                            <span className="text-white text-[10px] md:text-xs font-medium leading-relaxed block line-clamp-2 md:line-clamp-none"
                                                dangerouslySetInnerHTML={{
                                                    __html: product?.attack1?.replace(/\\r\\n/g, ' ').replace(/<br>/g, ' ') || ''
                                                }}
                                            />
                                        )}
                                    </div>
                                )}

                                {/* Artist */}
                                {(isLoading || product?.artist) && (
                                    <div className="space-y-0.5">
                                        <span className="text-gray-500 text-[9px] md:text-[10px] uppercase font-bold tracking-wider block">{t('artist')}</span>
                                        {isLoading ? (
                                            <div className="h-3 md:h-4 w-16 md:w-24 bg-white/10 rounded animate-pulse" />
                                        ) : (
                                            <span className="text-white text-xs md:text-sm font-medium truncate">{product?.artist}</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>



                        {/* Add to Collection Button - Below Card Area */}
                        {/* Action Buttons Row */}
                        {!isLoading && product && (
                            <div className="mt-6 flex flex-col sm:flex-row gap-3 w-full max-w-[500px] mx-auto">
                                {/* Add to Collection Button */}
                                <Button
                                    onClick={addToCollection}
                                    disabled={isAddingToCollection}
                                    className={`flex-1 gap-2 transition-all text-base py-6 ${addedToCollection
                                        ? 'bg-green-600 hover:bg-green-700 text-white'
                                        : 'bg-gradient-to-r from-primary to-orange-500 hover:from-primary/90 hover:to-orange-500/90'
                                        }`}
                                >
                                    {isAddingToCollection ? (
                                        <>
                                            <SpinnerGap className="h-5 w-5 animate-spin" weight="bold" />
                                            {t('adding_to_collection')}
                                        </>
                                    ) : addedToCollection ? (
                                        <>
                                            <Check className="h-5 w-5" />
                                            {t('added_to_collection')}
                                        </>
                                    ) : (
                                        <>
                                            <Plus className="h-5 w-5" />
                                            {t('add_to_collection')}
                                        </>
                                    )}
                                </Button>

                                {/* View PSA Button - Only for Pokemon */}
                                {(product.category_id === 3 || product.category_id === 85) && (
                                    <Dialog>
                                        <DialogTrigger asChild>
                                            <Button
                                                variant="outline"
                                                className="flex-1 gap-2 border-white/10 hover:bg-white/5 hover:text-white text-gray-300 py-6 text-base"
                                            >
                                                <Medal className="h-5 w-5 text-yellow-500" weight="duotone" />
                                                {t('view_psa')}
                                            </Button>
                                        </DialogTrigger>
                                        <DialogContent className="sm:max-w-[700px] bg-[#0a0a0a] border-white/10 text-white max-h-[90vh] overflow-y-auto">
                                            <DialogHeader>
                                                <DialogTitle className="flex items-center justify-center gap-2 text-xl w-full">
                                                    <Medal className="h-6 w-6 text-yellow-500" weight="fill" />
                                                    {t('psa_graded_prices')}
                                                </DialogTitle>
                                            </DialogHeader>
                                            <div className="mt-0">
                                                <PSAGradedPrices
                                                    productId={product.product_id}
                                                    productName={product.name}
                                                    isScanned={isScannedResult}
                                                    hideHeader={true}
                                                />
                                            </div>
                                        </DialogContent>
                                    </Dialog>
                                )}
                            </div>
                        )}

                    </div>

                    {/* Right Column: The Data */}
                    <div className="space-y-6 h-full flex flex-col justify-center">
                        {/* Chart Controls Row */}
                        <div className="flex flex-wrap items-center justify-between gap-4 w-full border-b border-white/5 pb-4">
                            <div className="flex items-center gap-4">
                                {isLoading ? (
                                    <div className="flex items-center gap-4">
                                        <div className="h-9 w-40 bg-white/10 rounded animate-pulse" />
                                        <div className="h-7 w-24 bg-white/10 rounded animate-pulse" />
                                    </div>
                                ) : (
                                    <>
                                        <span className="text-2xl md:text-3xl font-bold text-white font-mono tracking-tighter">
                                            {formatPrice(currentPrice || 0)}
                                        </span>
                                        <span className={`text-base md:text-lg font-bold font-mono ${(priceChange || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            {(priceChange || 0) >= 0 ? '▲' : '▼'} {Math.abs(priceChange || 0).toFixed(1)}%
                                        </span>
                                    </>
                                )}
                            </div>

                            <div className="flex bg-white/5 p-1 rounded-lg">
                                {TIME_FRAMES.map((tf) => (
                                    <button
                                        key={tf}
                                        onClick={() => setTimeFrame(tf)}
                                        className={`px-3 py-1 text-[10px] sm:text-xs font-bold rounded-md transition-all ${timeFrame === tf
                                            ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                                            : 'text-gray-400 hover:text-white hover:bg-white/10'
                                            }`}
                                    >
                                        {tf}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Main Chart Area */}
                        <div className="w-full bg-white/5 rounded-xl p-4 border border-white/10 backdrop-blur-sm relative h-[350px]">
                            {isLoading ? (
                                <div className="w-full h-full flex items-center justify-center">
                                    <SpinnerGap className="w-8 h-8 animate-spin text-orange-500" weight="bold" />
                                </div>
                            ) : (
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
                            )}
                        </div>

                        {/* Data Grid */}
                        <div className="grid grid-cols-3 gap-2 md:gap-4">
                            <Card className="bg-white/5 border-white/10 p-2 md:p-4 flex flex-col items-start hover:border-orange-500/30 transition-colors group">
                                <span className="text-gray-500 text-[9px] md:text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1">
                                    <CurrencyDollar className="w-3 h-3" /> {t('low_price')}
                                </span>
                                {isLoading ? (
                                    <div className="h-7 w-20 bg-white/10 rounded animate-pulse" />
                                ) : (
                                    <span className="text-lg md:text-xl font-bold text-white group-hover:text-orange-400 transition-colors break-all">
                                        {product?.low_price ? formatPrice(product.low_price) : '-'}
                                    </span>
                                )}
                            </Card>
                            <Card className="bg-white/5 border-white/10 p-2 md:p-4 flex flex-col items-start hover:border-orange-500/30 transition-colors group">
                                <span className="text-gray-500 text-[9px] md:text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1">
                                    <TrendUp className="w-3 h-3" /> {t('price_change')}
                                </span>
                                {isLoading ? (
                                    <div className="h-7 w-20 bg-white/10 rounded animate-pulse" />
                                ) : (
                                    <span className={`text-lg md:text-xl font-bold flex items-center gap-1 ${(priceChange || 0) >= 0 ? 'text-green-400' : 'text-red-400'} break-all`}>
                                        {(priceChange || 0) >= 0 ? '+' : ''}{(priceChange || 0).toFixed(1)}%
                                    </span>
                                )}
                            </Card>
                            <Card className="bg-white/5 border-white/10 p-2 md:p-4 flex flex-col items-start hover:border-orange-500/30 transition-colors group">
                                <span className="text-gray-500 text-[9px] md:text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1">
                                    <Pulse className="w-3 h-3" /> {t('high_price')}
                                </span>
                                {isLoading ? (
                                    <div className="h-7 w-20 bg-white/10 rounded animate-pulse" />
                                ) : (
                                    <span className="text-lg md:text-xl font-bold text-blue-400 break-all">
                                        {product?.high_price ? formatPrice(product.high_price) : '-'}
                                    </span>
                                )}
                            </Card>
                        </div>


                    </div>
                </div>
            </div>

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

                    {/* Crop area - improved sizing for full image display */}
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
                            className="bg-orange-500 hover:bg-orange-600 text-white"
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
        </section>
    );
}
