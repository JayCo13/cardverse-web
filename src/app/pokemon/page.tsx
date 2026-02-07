"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PokemonCardItem } from "@/components/pokemon-card-item";
import { getSupabaseClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SpinnerGap, MagnifyingGlass, Funnel, ArrowsClockwise, SortAscending, X, Lightning } from "@phosphor-icons/react";
import { useLocalization } from "@/context/localization-context";
import Image from "next/image";
import type { PokemonCard } from "@/lib/types";

export default function PokemonPage() {
    const { t } = useLocalization();
    const searchParams = useSearchParams();
    const router = useRouter();

    // Initialize state from URL params
    const [cards, setCards] = useState<PokemonCard[]>([]);
    const [sets, setSets] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState(searchParams.get('q') || "");
    const [priceFilter, setPriceFilter] = useState(searchParams.get('price') || "all");
    const [rarityFilter, setRarityFilter] = useState(searchParams.get('rarity') || "all");
    const [setFilter, setSetFilter] = useState(searchParams.get('set') || "all");
    const [sortBy, setSortBy] = useState(searchParams.get('sort') || "price_desc");
    const [categoryFilter, setCategoryFilter] = useState(searchParams.get('cat') || "3"); // 3 = English, 85 = Japanese
    const [showFilters, setShowFilters] = useState(false);
    const [showSetDropdown, setShowSetDropdown] = useState(false);
    const hasFetched = useRef(false);

    // Update URL when filters change
    useEffect(() => {
        const params = new URLSearchParams();
        if (searchTerm) params.set('q', searchTerm);
        if (priceFilter !== 'all') params.set('price', priceFilter);
        if (rarityFilter !== 'all') params.set('rarity', rarityFilter);
        if (setFilter !== 'all') params.set('set', setFilter);
        if (sortBy !== 'price_desc') params.set('sort', sortBy);
        if (categoryFilter !== '3') params.set('cat', categoryFilter);

        const newUrl = params.toString() ? `?${params.toString()}` : '/pokemon';
        router.replace(newUrl, { scroll: false });
    }, [searchTerm, priceFilter, rarityFilter, setFilter, sortBy, categoryFilter, router]);

    // Fetch available sets from materialized view
    useEffect(() => {
        const fetchSets = async () => {
            try {
                const supabase = getSupabaseClient();
                const viewName = categoryFilter === "3" ? "pokemon_sets_en" : "pokemon_sets_jp";

                const { data, error } = await supabase
                    .from(viewName)
                    .select('set_name');

                if (error) throw error;

                const setNames = (data || []).map(d => d.set_name).filter(Boolean);
                setSets(setNames as string[]);
            } catch (err) {
                console.error('Failed to fetch sets:', err);
            }
        };
        fetchSets();
    }, [categoryFilter]);

    const fetchCards = useCallback(async () => {
        setLoading(true);
        try {
            const supabase = getSupabaseClient();
            let query = supabase
                .from('tcgcsv_products')
                .select('product_id, name, image_url, set_name, number, rarity, market_price, low_price, tcgplayer_url')
                .eq('category_id', parseInt(categoryFilter))
                .not('market_price', 'is', null)
                .gt('market_price', 0);

            // Apply search
            if (searchTerm) {
                query = query.ilike('name', `%${searchTerm}%`);
            }

            // Apply set filter
            if (setFilter !== "all") {
                query = query.eq('set_name', setFilter);
            }

            // Apply price filter
            if (priceFilter === "under5") {
                query = query.lt('market_price', 5);
            } else if (priceFilter === "5to20") {
                query = query.gte('market_price', 5).lt('market_price', 20);
            } else if (priceFilter === "20to50") {
                query = query.gte('market_price', 20).lt('market_price', 50);
            } else if (priceFilter === "50to100") {
                query = query.gte('market_price', 50).lt('market_price', 100);
            } else if (priceFilter === "100to500") {
                query = query.gte('market_price', 100).lt('market_price', 500);
            } else if (priceFilter === "over500") {
                query = query.gte('market_price', 500);
            }

            // Apply rarity filter
            if (rarityFilter !== "all") {
                query = query.ilike('rarity', `%${rarityFilter}%`);
            }

            // Apply sort
            if (sortBy === "price_desc") {
                query = query.order('market_price', { ascending: false });
            } else if (sortBy === "price_asc") {
                query = query.order('market_price', { ascending: true });
            } else if (sortBy === "name_asc") {
                query = query.order('name', { ascending: true });
            } else if (sortBy === "name_desc") {
                query = query.order('name', { ascending: false });
            } else if (sortBy === "newest") {
                query = query.order('product_id', { ascending: false });
            }

            const { data, error } = await query.limit(80);

            if (error) throw error;

            const transformedCards: PokemonCard[] = (data || []).map(item => ({
                id: item.product_id,
                productId: item.product_id,
                name: item.name,
                imageUrl: item.image_url || '',
                setName: item.set_name || '',
                number: item.number || '',
                rarity: item.rarity || '',
                marketPrice: item.market_price,
                lowPrice: item.low_price,
                midPrice: null,
                highPrice: null,
                tcgplayerUrl: item.tcgplayer_url,
                categoryId: parseInt(categoryFilter),
                groupId: 0,
            }));

            setCards(transformedCards);
        } catch (err) {
            console.error('Fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, [searchTerm, priceFilter, rarityFilter, setFilter, sortBy, categoryFilter]);

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchCards();
        }, hasFetched.current ? 0 : 100);
        hasFetched.current = true;
        return () => clearTimeout(timer);
    }, [fetchCards]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
    };

    const clearFilters = () => {
        setSearchTerm("");
        setPriceFilter("all");
        setRarityFilter("all");
        setSetFilter("all");
        setSortBy("price_desc");
        setCategoryFilter("3");
    };

    const hasActiveFilters = priceFilter !== "all" || rarityFilter !== "all" || setFilter !== "all" || searchTerm !== "";

    return (
        <div className="flex flex-col min-h-screen bg-[#050505]">
            <Header />
            <main className="flex-1 py-6 px-4">
                <div className="max-w-7xl mx-auto">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-4">
                            <div className="relative w-16 h-16 sm:w-20 sm:h-20 shrink-0">
                                <Image
                                    src="/assets/pok-logo.png"
                                    alt="Pokemon Logo"
                                    fill
                                    className="object-contain drop-shadow-lg"
                                />
                            </div>
                            <div>
                                <h1 className="text-2xl sm:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-orange-400 to-yellow-500 font-headline tracking-wide">
                                    {t('pokemon_page_title')}
                                </h1>
                                <p className="text-sm text-white/50">{t('pokemon_page_desc')}</p>
                            </div>
                        </div>

                        {/* Mobile filter toggle */}
                        <Button
                            onClick={() => setShowFilters(!showFilters)}
                            variant="outline"
                            className="sm:hidden border-white/10"
                        >
                            <Funnel className="w-5 h-5" />
                        </Button>
                    </div>

                    {/* Search Bar */}
                    <form onSubmit={handleSearch} className="mb-4">
                        <div className="relative">
                            <MagnifyingGlass className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                            <Input
                                type="search"
                                placeholder={t('pokemon_search_placeholder')}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-12 pr-4 bg-white/5 border-white/10 h-12 text-base rounded-xl focus:border-yellow-500/50 transition-colors"
                            />
                        </div>
                    </form>

                    {/* Filter Bar */}
                    <div className={`${showFilters ? 'flex' : 'hidden'} sm:flex flex-wrap gap-2 sm:gap-3 mb-6 items-center`}>
                        {/* Category - English/Japanese */}
                        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                            <SelectTrigger className="w-[130px] bg-white/5 border-white/10 h-10 text-sm">
                                <SelectValue placeholder="Language" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="3">🇺🇸 English</SelectItem>
                                <SelectItem value="85">🇯🇵 Japanese</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* Price Filter - More granular */}
                        <Select value={priceFilter} onValueChange={setPriceFilter}>
                            <SelectTrigger className="w-[130px] bg-white/5 border-white/10 h-10 text-sm">
                                <SelectValue placeholder="Price" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Prices</SelectItem>
                                <SelectItem value="under5">Under $5</SelectItem>
                                <SelectItem value="5to20">$5 - $20</SelectItem>
                                <SelectItem value="20to50">$20 - $50</SelectItem>
                                <SelectItem value="50to100">$50 - $100</SelectItem>
                                <SelectItem value="100to500">$100 - $500</SelectItem>
                                <SelectItem value="over500">Over $500</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* Set Filter - Searchable */}
                        <div className="relative w-[220px]">
                            <Input
                                type="text"
                                placeholder="Search sets..."
                                value={setFilter === "all" ? "" : setFilter}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    if (value === "") {
                                        setSetFilter("all");
                                        setShowSetDropdown(false);
                                    } else {
                                        setSetFilter(value);
                                        setShowSetDropdown(true);
                                    }
                                }}
                                onFocus={() => setShowSetDropdown(true)}
                                className="bg-white/5 border-white/10 h-10 text-sm pr-8"
                            />
                            {setFilter !== "all" && (
                                <button
                                    onClick={() => {
                                        setSetFilter("all");
                                        setShowSetDropdown(false);
                                    }}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}

                            {/* Dropdown list */}
                            {showSetDropdown && (
                                <>
                                    <div
                                        className="fixed inset-0 z-10"
                                        onClick={() => setShowSetDropdown(false)}
                                    />
                                    <div className="absolute z-20 w-full mt-1 max-h-80 overflow-y-auto bg-zinc-900 border border-white/10 rounded-lg shadow-xl">
                                        <div
                                            className="px-3 py-2 text-sm cursor-pointer hover:bg-white/10"
                                            onClick={() => {
                                                setSetFilter("all");
                                                setShowSetDropdown(false);
                                            }}
                                        >
                                            All Sets
                                        </div>
                                        {sets
                                            .filter(set =>
                                                setFilter === "all" ||
                                                set.toLowerCase().includes(setFilter.toLowerCase())
                                            )
                                            .slice(0, 50)
                                            .map((set) => (
                                                <div
                                                    key={set}
                                                    className="px-3 py-2 text-sm cursor-pointer hover:bg-white/10 border-t border-white/5"
                                                    onClick={() => {
                                                        setSetFilter(set);
                                                        setShowSetDropdown(false);
                                                    }}
                                                >
                                                    {set}
                                                </div>
                                            ))
                                        }
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Rarity Filter */}
                        <Select value={rarityFilter} onValueChange={setRarityFilter}>
                            <SelectTrigger className="w-[150px] bg-white/5 border-white/10 h-10 text-sm">
                                <SelectValue placeholder="Rarity" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Rarities</SelectItem>
                                <SelectItem value="Special Art">Special Art Rare</SelectItem>
                                <SelectItem value="Illustration">Illustration Rare</SelectItem>
                                <SelectItem value="Ultra Rare">Ultra Rare</SelectItem>
                                <SelectItem value="Full Art">Full Art</SelectItem>
                                <SelectItem value="Holo">Holo Rare</SelectItem>
                                <SelectItem value="Rare">Rare</SelectItem>
                                <SelectItem value="Uncommon">Uncommon</SelectItem>
                                <SelectItem value="Common">Common</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* Sort By */}
                        <Select value={sortBy} onValueChange={setSortBy}>
                            <SelectTrigger className="w-[150px] bg-white/5 border-white/10 h-10 text-sm">
                                <SortAscending className="w-4 h-4 mr-1" />
                                <SelectValue placeholder="Sort" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="price_desc">Price: High → Low</SelectItem>
                                <SelectItem value="price_asc">Price: Low → High</SelectItem>
                                <SelectItem value="name_asc">Name: A → Z</SelectItem>
                                <SelectItem value="name_desc">Name: Z → A</SelectItem>
                                <SelectItem value="newest">Newest First</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* Clear Filters */}
                        {hasActiveFilters && (
                            <Button
                                onClick={clearFilters}
                                variant="ghost"
                                size="sm"
                                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            >
                                <X className="w-4 h-4 mr-1" />
                                Clear
                            </Button>
                        )}

                        {/* Refresh */}
                        <Button onClick={fetchCards} variant="ghost" size="icon" className="text-yellow-400 hover:bg-yellow-500/10 ml-auto">
                            <ArrowsClockwise className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>

                    {/* Active Filters Display */}
                    {hasActiveFilters && (
                        <div className="flex flex-wrap gap-2 mb-4">
                            {searchTerm && (
                                <span className="px-3 py-1 text-xs bg-yellow-500/20 text-yellow-400 rounded-full border border-yellow-500/30">
                                    Search: "{searchTerm}"
                                </span>
                            )}
                            {priceFilter !== "all" && (
                                <span className="px-3 py-1 text-xs bg-green-500/20 text-green-400 rounded-full border border-green-500/30">
                                    {priceFilter.replace(/([a-z])([A-Z])/g, '$1 $2').replace('to', ' - $').replace('under', 'Under $').replace('over', 'Over $')}
                                </span>
                            )}
                            {rarityFilter !== "all" && (
                                <span className="px-3 py-1 text-xs bg-purple-500/20 text-purple-400 rounded-full border border-purple-500/30">
                                    {rarityFilter}
                                </span>
                            )}
                            {setFilter !== "all" && (
                                <span className="px-3 py-1 text-xs bg-blue-500/20 text-blue-400 rounded-full border border-blue-500/30">
                                    Set: {setFilter.length > 20 ? setFilter.slice(0, 20) + '...' : setFilter}
                                </span>
                            )}
                        </div>
                    )}

                    {/* Results Count */}
                    {!loading && (
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-sm text-white/50">
                                {t('cards_found').replace('{count}', cards.length.toString())}
                                {cards.length === 80 && t('showing_first_80')}
                            </p>
                        </div>
                    )}

                    {/* Results Grid */}
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <SpinnerGap className="w-8 h-8 animate-spin text-yellow-500" weight="bold" />
                            <span className="ml-3 text-white/60">{t('loading_cards')}</span>
                        </div>
                    ) : cards.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                            {cards.map((card) => (
                                <PokemonCardItem key={card.id} card={card} />
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <Lightning className="w-16 h-16 text-yellow-500/30 mb-4" weight="fill" />
                            <p className="text-white/50">{t('no_cards_found')}</p>
                            <p className="text-sm text-white/30 mt-1">{t('try_adjusting_filters_short')}</p>
                            <Button onClick={clearFilters} variant="outline" className="mt-4 border-yellow-500/30 text-yellow-400">
                                {t('clear_all_filters')}
                            </Button>
                        </div>
                    )}
                </div>
            </main>
            <Footer />
        </div>
    );
}
