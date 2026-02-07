"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { OnePieceCardItem, type OnePieceCard } from "@/components/onepiece-card-item";
import { useLocalization } from "@/context/localization-context";
import { getSupabaseClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SpinnerGap, MagnifyingGlass, ArrowsClockwise, Anchor } from "@phosphor-icons/react";
import Image from "next/image";

export default function OnePiecePage() {
    const { t } = useLocalization();
    const searchParams = useSearchParams();
    const router = useRouter();

    // Initialize state from URL params
    const [cards, setCards] = useState<OnePieceCard[]>([]);
    const [sets, setSets] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState(searchParams.get('q') || "");
    const [priceFilter, setPriceFilter] = useState(searchParams.get('price') || "all");
    const [rarityFilter, setRarityFilter] = useState(searchParams.get('rarity') || "all");
    const [setFilter, setSetFilter] = useState(searchParams.get('set') || "all");

    // Update URL when filters change
    useEffect(() => {
        const params = new URLSearchParams();
        if (searchTerm) params.set('q', searchTerm);
        if (priceFilter !== 'all') params.set('price', priceFilter);
        if (rarityFilter !== 'all') params.set('rarity', rarityFilter);
        if (setFilter !== 'all') params.set('set', setFilter);

        const newUrl = params.toString() ? `?${params.toString()}` : '/onepiece';
        router.replace(newUrl, { scroll: false });
    }, [searchTerm, priceFilter, rarityFilter, setFilter, router]);

    // Fetch available sets
    useEffect(() => {
        const fetchSets = async () => {
            const supabase = getSupabaseClient();
            try {
                // Fetch distinct set names
                // Note: unique() is not directly supported in this way by PostgREST, 
                // typically we just fetch enough items and dedup client side or use RPC.
                // For simplicity/speed, let's fetch a list of products and dedup.
                const { data } = await supabase
                    .from('tcgcsv_products')
                    .select('set_name')
                    .eq('category_id', 68)
                    .not('set_name', 'is', null)
                    .limit(1000); // Reasonable limit to get most active sets

                if (data) {
                    const uniqueSets = Array.from(new Set(data.map(item => item.set_name))).sort();
                    setSets(uniqueSets as string[]);
                }
            } catch (e) {
                console.error('Error fetching sets:', e);
            }
        };

        fetchSets();
    }, []);

    const fetchCards = useCallback(async () => {
        setLoading(true);
        try {
            const supabase = getSupabaseClient();
            let query = supabase
                .from('tcgcsv_products')
                .select('product_id, name, image_url, set_name, number, rarity, market_price, low_price, tcgplayer_url')
                .eq('category_id', 68) // One Piece category
                .not('market_price', 'is', null)
                .gt('market_price', 0);

            // Apply search
            if (searchTerm) {
                query = query.ilike('name', `%${searchTerm}%`);
            }

            // Apply price filter
            if (priceFilter === "under10") {
                query = query.lt('market_price', 10);
            } else if (priceFilter === "10to50") {
                query = query.gte('market_price', 10).lt('market_price', 50);
            } else if (priceFilter === "50to200") {
                query = query.gte('market_price', 50).lt('market_price', 200);
            } else if (priceFilter === "over200") {
                query = query.gte('market_price', 200);
            }

            // Apply rarity filter
            if (rarityFilter !== "all") {
                query = query.ilike('rarity', `%${rarityFilter}%`);
            }

            // Apply set filter
            if (setFilter !== "all") {
                query = query.eq('set_name', setFilter);
            }

            const { data, error } = await query
                .order('market_price', { ascending: false })
                .limit(60);

            if (error) throw error;

            setCards(data || []);
        } catch (err) {
            console.error('Fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, [searchTerm, priceFilter, rarityFilter, setFilter]);

    useEffect(() => {
        fetchCards();
    }, [fetchCards]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
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
                                src="/assets/one-logo.png"
                                alt="One Piece Logo"
                                fill
                                className="object-contain drop-shadow-lg"
                            />
                        </div>
                        <div>
                            <h1 className="text-3xl sm:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-red-400 via-rose-500 to-red-600 font-headline tracking-wide">
                                {t('onepiece_page_title')}
                            </h1>
                            <p className="text-white/50">{t('onepiece_page_desc')}</p>
                        </div>
                    </div>

                    {/* Search and Filters */}
                    <div className="flex flex-col sm:flex-row gap-4 mb-8">
                        <form onSubmit={handleSearch} className="flex-1">
                            <div className="relative">
                                <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                                <Input
                                    type="search"
                                    placeholder={t('onepiece_search_placeholder')}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-10 bg-white/5 border-white/10 h-12"
                                />
                            </div>
                        </form>

                        <div className="flex gap-3">
                            <Select value={priceFilter} onValueChange={setPriceFilter}>
                                <SelectTrigger className="w-[140px] bg-white/5 border-white/10 h-12">
                                    <SelectValue placeholder="Price" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Prices</SelectItem>
                                    <SelectItem value="under10">Under $10</SelectItem>
                                    <SelectItem value="10to50">$10 - $50</SelectItem>
                                    <SelectItem value="50to200">$50 - $200</SelectItem>
                                    <SelectItem value="over200">Over $200</SelectItem>
                                </SelectContent>
                            </Select>

                            <Select value={setFilter} onValueChange={setSetFilter}>
                                <SelectTrigger className="w-[180px] bg-white/5 border-white/10 h-12">
                                    <SelectValue placeholder="Set" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Sets</SelectItem>
                                    {sets.map((setName) => (
                                        <SelectItem key={setName} value={setName}>
                                            {setName}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Select value={rarityFilter} onValueChange={setRarityFilter}>
                                <SelectTrigger className="w-[140px] bg-white/5 border-white/10 h-12">
                                    <SelectValue placeholder="Rarity" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Rarities</SelectItem>
                                    <SelectItem value="Secret">Secret Rare</SelectItem>
                                    <SelectItem value="Super Rare">Super Rare</SelectItem>
                                    <SelectItem value="Leader">Leader</SelectItem>
                                    <SelectItem value="Rare">Rare</SelectItem>
                                    <SelectItem value="Common">Common</SelectItem>
                                </SelectContent>
                            </Select>

                            <Button onClick={fetchCards} variant="outline" className="h-12 px-4 border-red-500/30 text-red-400">
                                <ArrowsClockwise className="w-5 h-5" />
                            </Button>
                        </div>
                    </div>

                    {/* Results */}
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <SpinnerGap className="w-8 h-8 animate-spin text-red-500" weight="bold" />
                            <span className="ml-3 text-white/60">{t('loading_cards')}</span>
                        </div>
                    ) : cards.length > 0 ? (
                        <>
                            <p className="text-white/50 mb-4">{t('cards_found').replace('{count}', cards.length.toString())}</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                {cards.map((card) => (
                                    <OnePieceCardItem key={card.product_id} card={card} />
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <Anchor className="w-16 h-16 text-red-500/30 mb-4" weight="fill" />
                            <p className="text-white/50">{t('no_cards_found')}</p>
                            <p className="text-sm text-white/30 mt-1">{t('try_adjusting_filters_short')}</p>
                        </div>
                    )}
                </div>
            </main>
            <Footer />
        </div>
    );
}
