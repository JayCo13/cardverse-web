"use client";

import React, { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
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

    // Prevent concurrent fetches
    const fetchingRef = useRef({ pokemon: false, soccer: false, onepiece: false });

    const fetchPokemon = useCallback(async (force = false) => {
        // Check cache validity
        if (!force && state.pokemon.length > 0 && Date.now() - state.pokemonLastFetch < CACHE_DURATION) {
            return;
        }
        if (fetchingRef.current.pokemon) return;
        fetchingRef.current.pokemon = true;

        setState(s => ({ ...s, pokemonLoading: true, pokemonError: null }));

        try {
            const supabase = getSupabaseClient();
            const { data, error } = await supabase
                .from('featured_pokemon_cards')
                .select('*');

            if (error) throw error;
            setState(s => ({
                ...s,
                pokemon: data || [],
                pokemonLoading: false,
                pokemonLastFetch: Date.now(),
            }));
        } catch (err) {
            console.error('Pokemon fetch error:', err);
            setState(s => ({ ...s, pokemonLoading: false, pokemonError: 'Failed to load' }));
        } finally {
            fetchingRef.current.pokemon = false;
        }
    }, [state.pokemon.length, state.pokemonLastFetch]);

    const fetchSoccer = useCallback(async (force = false) => {
        if (!force && state.soccer.length > 0 && Date.now() - state.soccerLastFetch < CACHE_DURATION) {
            return;
        }
        if (fetchingRef.current.soccer) return;
        fetchingRef.current.soccer = true;

        setState(s => ({ ...s, soccerLoading: true, soccerError: null }));

        try {
            const supabase = getSupabaseClient();
            const { data, error } = await supabase
                .from('featured_soccer_cards')
                .select('*');

            if (error) throw error;
            setState(s => ({
                ...s,
                soccer: data || [],
                soccerLoading: false,
                soccerLastFetch: Date.now(),
            }));
        } catch (err) {
            console.error('Soccer fetch error:', err);
            setState(s => ({ ...s, soccerLoading: false, soccerError: 'Failed to load' }));
        } finally {
            fetchingRef.current.soccer = false;
        }
    }, [state.soccer.length, state.soccerLastFetch]);

    const fetchOnepiece = useCallback(async (force = false) => {
        if (!force && state.onepiece.length > 0 && Date.now() - state.onepieceLastFetch < CACHE_DURATION) {
            return;
        }
        if (fetchingRef.current.onepiece) return;
        fetchingRef.current.onepiece = true;

        setState(s => ({ ...s, onepieceLoading: true, onepieceError: null }));

        try {
            const supabase = getSupabaseClient();
            const { data, error } = await supabase
                .from('featured_onepiece_cards')
                .select('*');

            if (error) throw error;
            setState(s => ({
                ...s,
                onepiece: data || [],
                onepieceLoading: false,
                onepieceLastFetch: Date.now(),
            }));
        } catch (err) {
            console.error('One Piece fetch error:', err);
            setState(s => ({ ...s, onepieceLoading: false, onepieceError: 'Failed to load' }));
        } finally {
            fetchingRef.current.onepiece = false;
        }
    }, [state.onepiece.length, state.onepieceLastFetch]);

    // Market Spotlight cache functions
    const setSpotlightCache = useCallback((data: Omit<SpotlightCache, 'timestamp'>) => {
        setState(s => ({
            ...s,
            spotlight: {
                ...data,
                timestamp: Date.now(),
            },
        }));
    }, []);

    const clearSpotlightCache = useCallback(() => {
        setState(s => ({ ...s, spotlight: null }));
    }, []);

    return (
        <CardCacheContext.Provider value={{
            ...state,
            fetchPokemon,
            fetchSoccer,
            fetchOnepiece,
            setSpotlightCache,
            clearSpotlightCache,
        }}>
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
