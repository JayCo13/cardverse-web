"use client";

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendUp, Pulse, CurrencyDollar, SpinnerGap, ArrowsClockwise, MagnifyingGlass, Camera, Plus, Check, SoccerBall, Skull } from '@phosphor-icons/react';
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

    const [timeFrame, setTimeFrame] = useState('1M');
    const [product, setProduct] = useState<ProductData | null>(null);
    const [chartData, setChartData] = useState<Array<{ date: string; price: number }>>([]);
    const [fullChartData, setFullChartData] = useState<Array<{ date: string; price: number; dateObj: Date }>>([]);
    const [currentPrice, setCurrentPrice] = useState<number | null>(null);
    const [priceChange, setPriceChange] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [useMockData, setUseMockData] = useState(false);

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
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const scanInProgressRef = React.useRef(false); // Sync flag to prevent concurrent scans

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
                    category: product.set_name,
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
                .limit(30) as { data: PriceHistoryRecord[] | null };

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
                setChartData(adjustedMock.map(d => ({ date: d.date, price: d.price })));
                setPriceChange(0);
                setUseMockData(true);
            }

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
    const processScannedImage = async (imageBase64: string) => {
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

        try {
            // Single API call with 10 second timeout
            console.log('Identifying card with AI...');
            const aiController = new AbortController();
            const aiTimeoutId = setTimeout(() => aiController.abort(), 10000);

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

            if (!identifyResponse.ok) {
                const errorText = await identifyResponse.text();
                console.error('Identify API Error:', errorText);
                setSearchError('Could not identify card. Please try again with better lighting.');
                return;
            }

            const identification = await identifyResponse.json();
            console.log('Identification result:', identification);

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
            // Always use TCG search path - we primarily handle Pokemon cards
            console.log(`Category from AI: "${identification.category}" -> using TCG search`);
            {
                console.log('Step 3: Searching TCGCSV database for TCG card...');

                const isJapanese = language?.toLowerCase() === 'japanese';
                const categoryId = isJapanese ? CATEGORY_POKEMON_JAPANESE : CATEGORY_POKEMON_ENGLISH;

                // 5 second timeout
                const searchController = new AbortController();
                const searchTimeoutId = setTimeout(() => searchController.abort(), 5000);

                try {
                    // PRIORITY 1: Search by card_id (number) + set_code
                    if (cardNumber) {
                        let cleanNumber = cardNumber.replace(/[^\d/]/g, '').trim();
                        if (!cleanNumber.includes('/') && /^\d+$/.test(cleanNumber) && cleanNumber.length >= 4 && cleanNumber.length % 2 === 0) {
                            const midPoint = Math.floor(cleanNumber.length / 2);
                            cleanNumber = cleanNumber.substring(0, midPoint) + '/' + cleanNumber.substring(midPoint);
                        }

                        // Generate ALL number format variations (with/without leading zeros)
                        // Handles: 004/094, 4/94, 4/094, 004/94, 064/123, 64/123, etc.
                        const parts = cleanNumber.split('/');
                        const altFormats = new Set<string>([cleanNumber]); // Use Set to avoid duplicates

                        if (parts.length === 2) {
                            const collectorNum = parts[0]; // e.g., "004" or "64"
                            const setTotal = parts[1];     // e.g., "094" or "123"

                            // Parse to numbers
                            const collectorInt = parseInt(collectorNum, 10);
                            const setTotalInt = parseInt(setTotal, 10);

                            // Generate all padding variations
                            const collectorVariations = [
                                collectorInt.toString(),                    // No padding: "4" or "64"
                                collectorInt.toString().padStart(2, '0'),   // 2-digit: "04" or "64"
                                collectorInt.toString().padStart(3, '0'),   // 3-digit: "004" or "064"
                            ];

                            const setTotalVariations = [
                                setTotalInt.toString(),                     // No padding: "94" or "123"
                                setTotalInt.toString().padStart(2, '0'),    // 2-digit: "94" or "123" (unchanged if already 3+)
                                setTotalInt.toString().padStart(3, '0'),    // 3-digit: "094" or "123"
                            ];

                            // Generate all combinations
                            for (const col of collectorVariations) {
                                for (const total of setTotalVariations) {
                                    altFormats.add(col + '/' + total);
                                }
                            }
                        }

                        const altFormatsArray = Array.from(altFormats);

                        console.log(`TCGCSV: Searching by number formats: ${altFormatsArray.join(', ')} (category: ${categoryId})`);
                        if (setCode) console.log(`Set code: ${setCode}`);

                        // Build OR clause for all number formats
                        const numberClauses = altFormatsArray.map((n: string) => `number.eq.${encodeURIComponent(n)}`).join(',');
                        const restUrl = `${SUPABASE_URL}/rest/v1/tcgcsv_products?category_id=eq.${categoryId}&or=(${numberClauses})&select=product_id,name,image_url,set_name,rarity,market_price,low_price,mid_price,high_price,number,tcgplayer_url,extended_data,category_id&limit=20`;

                        const response = await fetch(restUrl, {
                            headers: {
                                'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
                                'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}`,
                            },
                            signal: searchController.signal,
                        });

                        if (response.ok) {
                            const products = await response.json();
                            if (products && products.length > 0) {
                                clearTimeout(searchTimeoutId);
                                console.log(`Found ${products.length} cards by number`);

                                // PRIORITY 1.5: Exact number match using any format variation
                                if (products.length > 1) {
                                    // Find exact match for any of our generated format variations
                                    const exactMatch = products.find((p: { number: string }) =>
                                        altFormatsArray.includes(p.number)
                                    );
                                    if (exactMatch && cardName) {
                                        // Verify with name match too
                                        const firstWord = cardName.toLowerCase().split(/[\s']/)[0];
                                        const nameMatches = exactMatch.name.toLowerCase().includes(firstWord);
                                        if (nameMatches) {
                                            console.log(`Exact number + name match: ${exactMatch.name} #${exactMatch.number}`);
                                            await displayProductResult(exactMatch);
                                            return;
                                        }
                                    }
                                }

                                // PRIORITY 2: Filter by set_code if provided
                                if (setCode && products.length > 1) {
                                    const setLower = setCode.toLowerCase();

                                    // Try exact/partial match first
                                    let setMatch = products.find((p: { set_name: string }) =>
                                        p.set_name?.toLowerCase().includes(setLower)
                                    );

                                    // If no match, try fuzzy match (common OCR errors)
                                    if (!setMatch) {
                                        // Create variations: 5 <-> s, 0 <-> o, 1 <-> i/l
                                        const fuzzySet = setLower
                                            .replace(/5/g, 's').replace(/0/g, 'o').replace(/1/g, 'i') // Number to letter
                                            .replace(/s/g, '5').replace(/o/g, '0').replace(/i/g, '1').replace(/l/g, '1'); // Letter to number

                                        // Also try specific known issue: m15 -> m1s
                                        const specificFix = setLower.replace('m15', 'm1s'); // Fix specific user reported issue

                                        setMatch = products.find((p: { set_name: string }) => {
                                            const dbSet = p.set_name?.toLowerCase() || '';
                                            return dbSet.includes(fuzzySet) || dbSet.includes(specificFix) ||
                                                fuzzySet.includes(dbSet) || specificFix.includes(dbSet);
                                        });

                                        if (setMatch) console.log(`Fuzzy set match: "${setCode}" -> matched "${setMatch.set_name}"`);
                                    }

                                    if (setMatch) {
                                        console.log(`Matched by set: ${setMatch.name} (${setMatch.set_name})`);
                                        await displayProductResult(setMatch);
                                        return;
                                    }
                                }

                                // PRIORITY 3: Filter by name if multiple results
                                if (cardName && products.length > 1) {
                                    console.log(`Multiple results, filtering by name: "${cardName}"`);

                                    // Try exact name match
                                    let match = products.find((p: { name: string }) =>
                                        p.name.toLowerCase().includes(cardName.toLowerCase())
                                    );

                                    // Try matching the first word/owner
                                    if (!match) {
                                        const firstWord = cardName.split(/['s\s]/)[0].toLowerCase();
                                        const ownerAliases: Record<string, string[]> = {
                                            'mc': ['emcee', 'mc'],
                                            'emcee': ['emcee', 'mc'],
                                        };
                                        const searchTerms = ownerAliases[firstWord] || [firstWord];

                                        match = products.find((p: { name: string }) => {
                                            const pFirstWord = p.name.split(/['s\s]/)[0].toLowerCase();
                                            return searchTerms.some(term => pFirstWord.includes(term) || term.includes(pFirstWord));
                                        });
                                    }

                                    // Try matching Pokemon name after "'s "
                                    if (!match && cardName.includes("'s ")) {
                                        const pokemonName = cardName.split("'s ").pop();
                                        match = products.find((p: { name: string }) => {
                                            const dbPokemonName = p.name.includes("'s ")
                                                ? p.name.split("'s ").pop()?.split(' - ')[0]
                                                : p.name.split(' - ')[0];
                                            return dbPokemonName?.toLowerCase().includes(pokemonName?.toLowerCase() || '');
                                        });
                                    }

                                    if (match) {
                                        console.log(`Matched by name: ${match.name}`);
                                        await displayProductResult(match);
                                        return;
                                    }
                                }

                                // Use first result if only one or no filters matched
                                console.log(`Using first result: ${products[0].name}`);
                                await displayProductResult(products[0]);
                                return;
                            }
                        }
                    }

                    // FALLBACK: Search by name
                    console.log(`TCGCSV: Searching by name: ${cardName}`);
                    const nameUrl = `${SUPABASE_URL}/rest/v1/tcgcsv_products?category_id=eq.${categoryId}&name=ilike.*${encodeURIComponent(cardName)}*&market_price=not.is.null&order=market_price.desc&select=product_id,name,image_url,set_name,rarity,market_price,low_price,mid_price,high_price,number,tcgplayer_url,extended_data,category_id&limit=5`;

                    const nameResponse = await fetch(nameUrl, {
                        headers: {
                            'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
                            'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}`,
                        },
                        signal: searchController.signal,
                    });

                    clearTimeout(searchTimeoutId);

                    if (nameResponse.ok) {
                        const nameProducts = await nameResponse.json();
                        if (nameProducts && nameProducts.length > 0) {
                            console.log(`Found ${nameProducts.length} cards by name`);
                            await displayProductResult(nameProducts[0]);
                            return;
                        }
                    }

                    setSearchError(`No cards found for "${cardName}"`);
                } catch (searchErr: unknown) {
                    clearTimeout(searchTimeoutId);
                    if (searchErr instanceof Error && searchErr.name === 'AbortError') {
                        console.log('Search timed out');
                        setSearchError('Search timed out. Please try again.');
                    } else {
                        console.error('Search error:', searchErr);
                        setSearchError('Search failed. Please try again.');
                    }
                }
            }

        } catch (error: unknown) {
            if (error instanceof Error && error.name === 'AbortError') {
                console.log('AI identification timed out');
                setSearchError('AI identification timed out. Please try again.');
            } else {
                console.error('Error processing scanned image:', error);
                setSearchError('Failed to scan card. Please try again.');
            }
        } finally {
            scanInProgressRef.current = false;
            setIsScanning(false);
            setIsLoading(false);
        }
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
        };

        setProduct(productData);
        setCurrentPrice(featured.market_price);
        setSearchError(null);

        // Fetch price history using REST API (faster than Supabase client)
        try {
            const historyUrl = `${SUPABASE_URL}/rest/v1/tcgcsv_price_history?product_id=eq.${featured.product_id}&order=recorded_at.asc&select=recorded_at,market_price&limit=30`;
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
                    // Use mock data if no history
                    const now = new Date();
                    const adjustedMock = MOCK_DATA.map((d, i) => ({
                        date: d.date,
                        price: Math.round(featured.market_price * (0.85 + (i / MOCK_DATA.length) * 0.15)),
                        dateObj: new Date(now.getTime() - (MOCK_DATA.length - i) * 2 * 24 * 60 * 60 * 1000),
                    }));
                    setFullChartData(adjustedMock);
                    setChartData(adjustedMock.map(d => ({ date: d.date, price: d.price })));
                    setPriceChange(0);
                    setUseMockData(true);
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
                setChartData(adjustedMock.map(d => ({ date: d.date, price: d.price })));
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

                // Only resize if too large (max 1500px - keep quality for card numbers)
                const maxWidth = 1500;
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

                // Convert to base64 (JPEG quality 95% - higher quality for small text)
                const enhancedBase64 = canvas.toDataURL('image/jpeg', 0.95);
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

    // Handle file selection for scan
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

            processScannedImage(enhancedBase64);
        };
        reader.readAsDataURL(file);
    };

    // Trigger file input click
    const handleScanClick = () => {
        fileInputRef.current?.click();
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
    const { formatPrice } = useCurrency();
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
            fetchFeaturedProduct(searchTerm.trim());
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

    return (
        <section className="py-16 md:py-24 bg-[#111111] relative overflow-hidden border-y border-white/5">
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
                            <DialogContent className="sm:max-w-lg bg-[#0a0a0a] border-white/10 text-white p-0 overflow-hidden shadow-2xl">
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

                        <div className="relative flex items-center bg-black/80 rounded-full border border-white/10 p-1.5 shadow-2xl">
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={t('search_placeholder_pokemon')}
                                className="w-full bg-transparent border-none text-white text-base md:text-lg px-6 py-2 focus:outline-none placeholder:text-gray-500 font-medium rounded-l-full"
                                disabled={isLoading || isScanning}
                            />
                            {/* Hidden file input for scan */}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onChange={handleFileSelect}
                                className="hidden"
                            />
                            {/* Scan button */}
                            <Button
                                onClick={handleScanClick}
                                disabled={isLoading || isScanning}
                                className="rounded-full bg-white/10 hover:bg-white/20 text-white h-10 w-10 md:h-11 md:w-11 p-0 flex items-center justify-center shrink-0 mr-2 transition-all"
                                title="Scan card with camera"
                            >
                                {isScanning ? (
                                    <SpinnerGap className="h-5 w-5 animate-spin" weight="bold" />
                                ) : (
                                    <Camera className="h-5 w-5" />
                                )}
                            </Button>
                            {/* Search button */}
                            <Button
                                onClick={handleSearch}
                                disabled={isLoading}
                                className="rounded-full bg-orange-500 hover:bg-orange-600 text-white h-10 w-10 md:h-11 md:w-11 p-0 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(249,115,22,0.5)] transition-transform active:scale-95 disabled:opacity-50"
                            >
                                {isLoading && !isScanning ? (
                                    <SpinnerGap className="h-5 w-5 animate-spin" weight="bold" />
                                ) : (
                                    <MagnifyingGlass className="h-5 w-5 md:h-6 md:w-6" />
                                )}
                            </Button>
                        </div>
                    </div>

                    {/* Error message */}
                    {searchError && (
                        <p className="text-sm text-red-400 mb-4">{searchError}</p>
                    )}

                    <p className="text-sm md:text-base text-gray-400 max-w-xl mx-auto">
                        Access comprehensive price history from major global marketplaces including eBay, TCGPlayer, and PWCC.
                    </p>
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
                                    <span className="px-2 py-1 bg-orange-500/20 text-orange-400 rounded border border-orange-500/30">1st Edition</span>
                                )}
                                {product?.rarity && (
                                    <span className="px-2 py-1 bg-white/5 rounded">{product.rarity}</span>
                                )}
                                {product?.isHolo && (
                                    <span className="px-2 py-1 bg-purple-500/20 text-purple-400 rounded border border-purple-500/30">Holo</span>
                                )}
                                {product?.set_name && (
                                    <span className="px-2 py-1 bg-white/5 rounded">{product.set_name}</span>
                                )}
                            </div>
                        </div>

                        {/* Card + Info Row */}
                        <div className="flex flex-row items-center justify-center gap-8 w-full">
                            {/* Card Image */}
                            <div className="relative perspective-1000 group shrink-0">
                                {/* Ambient Glow */}
                                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] h-[300px] bg-white/5 rounded-full blur-[60px] pointer-events-none" />

                                <div className="relative w-[220px] md:w-[280px] aspect-[3/4] transition-transform duration-500 ease-out transform group-hover:rotate-y-6 group-hover:scale-105 preserve-3d">
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
                            {/* Product Details (Right of Image) */}
                            <div className="flex flex-col gap-3 text-left max-w-[280px]">
                                {/* Market Price */}
                                <div className="space-y-0.5">
                                    <span className="text-gray-500 text-[10px] uppercase font-bold tracking-wider block">Market Price</span>
                                    {isLoading ? (
                                        <div className="h-8 w-32 bg-white/10 rounded animate-pulse" />
                                    ) : (
                                        <span className="text-green-400 text-2xl font-bold font-mono">
                                            {formatPrice(currentPrice || 0)}
                                        </span>
                                    )}
                                </div>

                                {/* Card Number */}
                                <div className="space-y-0.5">
                                    <span className="text-gray-500 text-[10px] uppercase font-bold tracking-wider block">Card Number</span>
                                    {isLoading ? (
                                        <div className="h-4 w-24 bg-white/10 rounded animate-pulse" />
                                    ) : (
                                        <span className="text-white text-sm font-medium">
                                            {product?.number || '-'}
                                        </span>
                                    )}
                                </div>

                                {/* Rarity */}
                                <div className="space-y-0.5">
                                    <span className="text-gray-500 text-[10px] uppercase font-bold tracking-wider block">Rarity</span>
                                    {isLoading ? (
                                        <div className="h-4 w-24 bg-white/10 rounded animate-pulse" />
                                    ) : (
                                        <span className="text-white text-sm font-medium">
                                            {product?.rarity || '-'}
                                        </span>
                                    )}
                                </div>

                                {/* Card Type / HP / Stage */}
                                <div className="space-y-0.5">
                                    <span className="text-gray-500 text-[10px] uppercase font-bold tracking-wider block">Card Type / HP / Stage</span>
                                    {isLoading ? (
                                        <div className="h-4 w-48 bg-white/10 rounded animate-pulse" />
                                    ) : (
                                        <span className="text-white text-sm font-medium">
                                            {product?.cardType || '-'} / {product?.hp || '-'} / {product?.stage || '-'}
                                        </span>
                                    )}
                                </div>

                                {/* Attack - Only show when loaded or if loading (placeholder) */}
                                {(isLoading || product?.attack1) && (
                                    <div className="space-y-0.5">
                                        <span className="text-gray-500 text-[10px] uppercase font-bold tracking-wider block">Attack</span>
                                        {isLoading ? (
                                            <div className="space-y-1">
                                                <div className="h-3 w-full bg-white/10 rounded animate-pulse" />
                                                <div className="h-3 w-5/6 bg-white/10 rounded animate-pulse" />
                                            </div>
                                        ) : (
                                            <span className="text-white text-xs font-medium leading-relaxed block"
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
                                        <span className="text-gray-500 text-[10px] uppercase font-bold tracking-wider block">Artist</span>
                                        {isLoading ? (
                                            <div className="h-4 w-24 bg-white/10 rounded animate-pulse" />
                                        ) : (
                                            <span className="text-white text-sm font-medium">{product?.artist}</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Add to Collection Button - Below Card Area */}
                        {!isLoading && product && (
                            <Button
                                onClick={addToCollection}
                                disabled={isAddingToCollection}
                                className={`mt-6 w-full max-w-[400px] mx-auto gap-2 transition-all text-lg py-6 ${addedToCollection
                                    ? 'bg-green-600 hover:bg-green-700 text-white'
                                    : 'bg-gradient-to-r from-primary to-orange-500 hover:from-primary/90 hover:to-orange-500/90'
                                    }`}
                            >
                                {isAddingToCollection ? (
                                    <>
                                        <SpinnerGap className="h-5 w-5 animate-spin" weight="bold" />
                                        Adding...
                                    </>
                                ) : addedToCollection ? (
                                    <>
                                        <Check className="h-5 w-5" />
                                        Added to Collection!
                                    </>
                                ) : (
                                    <>
                                        <Plus className="h-5 w-5" />
                                        Add to My Collection
                                    </>
                                )}
                            </Button>
                        )}
                    </div>

                    {/* Right Column: The Data */}
                    <div className="space-y-6 h-full flex flex-col justify-center">
                        {/* Chart Controls Row */}
                        <div className="flex flex-wrap items-center justify-between gap-4 w-full border-b border-white/5 pb-4">
                            <div className="flex flex-col items-start w-full md:w-auto md:flex-row md:items-baseline gap-1 md:gap-4 mb-2 md:mb-0">
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
                                        <span className={`text-sm md:text-lg font-bold font-mono ${(priceChange || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            {(priceChange || 0) >= 0 ? '▲' : '▼'} {Math.abs(priceChange || 0).toFixed(1)}%
                                        </span>
                                    </>
                                )}
                            </div>

                            <div className="flex w-full md:w-auto justify-center bg-white/5 p-1 rounded-lg">
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
                                            tickFormatter={(val) => `$${val} `}
                                            dx={10}
                                        />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '8px', color: '#fff' }}
                                            itemStyle={{ color: '#F97316' }}
                                            formatter={(value: number) => [`$${value.toLocaleString()} `, 'Price']}
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
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
                            <Card className="bg-white/5 border-white/10 p-4 flex flex-col items-start hover:border-orange-500/30 transition-colors group">
                                <span className="text-gray-500 text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1">
                                    <CurrencyDollar className="w-3 h-3" /> {t('low_price')}
                                </span>
                                {isLoading ? (
                                    <div className="h-7 w-20 bg-white/10 rounded animate-pulse" />
                                ) : (
                                    <span className="text-base md:text-xl font-bold text-white font-mono group-hover:text-orange-400 transition-colors">
                                        {product?.low_price ? formatPrice(product.low_price) : '-'}
                                    </span>
                                )}
                            </Card>
                            <Card className="bg-white/5 border-white/10 p-4 flex flex-col items-start hover:border-orange-500/30 transition-colors group">
                                <span className="text-gray-500 text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1">
                                    <TrendUp className="w-3 h-3" /> {t('price_change')}
                                </span>
                                {isLoading ? (
                                    <div className="h-7 w-20 bg-white/10 rounded animate-pulse" />
                                ) : (
                                    <span className={`text-base md:text-xl font-bold flex items-center gap-1 ${(priceChange || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                        {(priceChange || 0) >= 0 ? '+' : ''}{(priceChange || 0).toFixed(1)}%
                                    </span>
                                )}
                            </Card>
                            <Card className="bg-white/5 border-white/10 p-4 flex flex-col items-start hover:border-orange-500/30 transition-colors group">
                                <span className="text-gray-500 text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1">
                                    <Pulse className="w-3 h-3" /> {t('high_price')}
                                </span>
                                {isLoading ? (
                                    <div className="h-7 w-20 bg-white/10 rounded animate-pulse" />
                                ) : (
                                    <span className="text-base md:text-xl font-bold text-white font-mono">
                                        {product?.high_price ? formatPrice(product.high_price) : '-'}
                                    </span>
                                )}
                            </Card>
                        </div>
                    </div>
                </div>

                {/* PSA Graded Prices - Full width below chart and image */}
                {product && (
                    <div className="mt-6">
                        <PSAGradedPrices
                            cardNumber={product.number}
                            setName={product.set_name}
                            cardName={product.name}
                        />
                    </div>
                )}
            </div>
        </section>
    );
}
