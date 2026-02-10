"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useMemo, type ReactNode } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";

// Types
interface PokemonCard {
    product_id: number;
    name: string;
    image_url: string | null;
    set_name: string | null;
    market_price: number | null;
    low_price: number | null;
}

interface SoccerCard {
    id: string;
    name: string;
    image_url: string | null;
    price: number | null;
    category: string | null;
    year: string | null;
    grader: string | null;
    grade: string | null;
    ebay_id: string | null;
}

interface OnePieceCard {
    product_id: number;
    name: string;
    image_url: string | null;
    set_name: string | null;
    market_price: number | null;
    low_price: number | null;
}

// Market Spotlight scan result (export for use in MarketSpotlight component)
export interface SpotlightProduct {
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

export interface SpotlightCache {
    product: SpotlightProduct | null;
    chartData: Array<{ date: string; price: number; dateObj: Date }>;
    currentPrice: number | null;
    priceChange: number | null;
    timestamp: number;
}

interface CardCacheState {
    pokemon: PokemonCard[];
    soccer: SoccerCard[];
    onepiece: OnePieceCard[];
    pokemonLoading: boolean;
    soccerLoading: boolean;
    onepieceLoading: boolean;
    pokemonError: string | null;
    soccerError: string | null;
    onepieceError: string | null;
    pokemonLastFetch: number;
    soccerLastFetch: number;
    onepieceLastFetch: number;
    // Market Spotlight cache
    spotlight: SpotlightCache | null;
}

interface CardCacheContextType extends CardCacheState {
    fetchPokemon: (force?: boolean) => Promise<void>;
    fetchSoccer: (force?: boolean) => Promise<void>;
    fetchOnepiece: (force?: boolean) => Promise<void>;
    // Market Spotlight cache functions
    setSpotlightCache: (data: Omit<SpotlightCache, 'timestamp'>) => void;
    clearSpotlightCache: () => void;
}

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

const CardCacheContext = createContext<CardCacheContextType | undefined>(undefined);

export function CardCacheProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<CardCacheState>({
        pokemon: [],
        soccer: [],
        onepiece: [],
        pokemonLoading: false,
        soccerLoading: false,
        onepieceLoading: false,
        pokemonError: null,
        soccerError: null,
        onepieceError: null,
        pokemonLastFetch: 0,
        soccerLastFetch: 0,
        onepieceLastFetch: 0,
        spotlight: null,
    });

    // Use ref to track current state for cache checks (avoids unstable useCallback deps)
    const stateRef = useRef(state);
    stateRef.current = state;

    // Prevent concurrent fetches
    const fetchingRef = useRef({ pokemon: false, soccer: false, onepiece: false });

    // STABLE function references — no state in deps, uses stateRef instead
    const fetchPokemon = useCallback(async (force = false) => {
        const s = stateRef.current;
        if (!force && s.pokemon.length > 0 && Date.now() - s.pokemonLastFetch < CACHE_DURATION) {
            return;
        }
        if (fetchingRef.current.pokemon) return;
        fetchingRef.current.pokemon = true;

        setState(prev => ({ ...prev, pokemonLoading: true, pokemonError: null }));

        try {
            const supabase = getSupabaseClient();
            const { data, error } = await supabase
                .from('featured_pokemon_cards')
                .select('*');

            if (error) throw error;
            setState(prev => ({
                ...prev,
                pokemon: data || [],
                pokemonLoading: false,
                pokemonLastFetch: Date.now(),
            }));
        } catch (err) {
            console.error('Pokemon fetch error:', err);
            setState(prev => ({ ...prev, pokemonLoading: false, pokemonError: 'Failed to load' }));
        } finally {
            fetchingRef.current.pokemon = false;
        }
    }, []); // Empty deps = stable reference

    const fetchSoccer = useCallback(async (force = false) => {
        const s = stateRef.current;
        if (!force && s.soccer.length > 0 && Date.now() - s.soccerLastFetch < CACHE_DURATION) {
            return;
        }
        if (fetchingRef.current.soccer) return;
        fetchingRef.current.soccer = true;

        setState(prev => ({ ...prev, soccerLoading: true, soccerError: null }));

        try {
            const supabase = getSupabaseClient();
            const { data, error } = await supabase
                .from('featured_soccer_cards')
                .select('*');

            if (error) throw error;
            setState(prev => ({
                ...prev,
                soccer: data || [],
                soccerLoading: false,
                soccerLastFetch: Date.now(),
            }));
        } catch (err) {
            console.error('Soccer fetch error:', err);
            setState(prev => ({ ...prev, soccerLoading: false, soccerError: 'Failed to load' }));
        } finally {
            fetchingRef.current.soccer = false;
        }
    }, []); // Empty deps = stable reference

    const fetchOnepiece = useCallback(async (force = false) => {
        const s = stateRef.current;
        if (!force && s.onepiece.length > 0 && Date.now() - s.onepieceLastFetch < CACHE_DURATION) {
            return;
        }
        if (fetchingRef.current.onepiece) return;
        fetchingRef.current.onepiece = true;

        setState(prev => ({ ...prev, onepieceLoading: true, onepieceError: null }));

        try {
            const supabase = getSupabaseClient();
            const { data, error } = await supabase
                .from('featured_onepiece_cards')
                .select('*');

            if (error) throw error;
            setState(prev => ({
                ...prev,
                onepiece: data || [],
                onepieceLoading: false,
                onepieceLastFetch: Date.now(),
            }));
        } catch (err) {
            console.error('One Piece fetch error:', err);
            setState(prev => ({ ...prev, onepieceLoading: false, onepieceError: 'Failed to load' }));
        } finally {
            fetchingRef.current.onepiece = false;
        }
    }, []); // Empty deps = stable reference

    // Market Spotlight cache functions
    const setSpotlightCache = useCallback((data: Omit<SpotlightCache, 'timestamp'>) => {
        setState(prev => ({
            ...prev,
            spotlight: {
                ...data,
                timestamp: Date.now(),
            },
        }));
    }, []);

    const clearSpotlightCache = useCallback(() => {
        setState(prev => ({ ...prev, spotlight: null }));
    }, []);

    // Memoize context value to prevent unnecessary re-renders of consumers
    const value = useMemo(() => ({
        ...state,
        fetchPokemon,
        fetchSoccer,
        fetchOnepiece,
        setSpotlightCache,
        clearSpotlightCache,
    }), [state, fetchPokemon, fetchSoccer, fetchOnepiece, setSpotlightCache, clearSpotlightCache]);

    return (
        <CardCacheContext.Provider value={value}>
            {children}
        </CardCacheContext.Provider>
    );
}

export function useCardCache() {
    const context = useContext(CardCacheContext);
    if (!context) {
        throw new Error('useCardCache must be used within CardCacheProvider');
    }
    return context;
}

export default CardCacheProvider;
