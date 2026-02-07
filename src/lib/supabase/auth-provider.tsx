"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { getSupabaseClient } from './client';
import type { User, Session, AuthError } from '@supabase/supabase-js';
import type { Tables, InsertTables } from './database.types';

type Profile = Tables<'profiles'>;

interface AuthContextType {
    user: User | null;
    profile: Profile | null;
    session: Session | null;
    isLoading: boolean;
    signInWithGoogle: () => Promise<void>;
    signInWithFacebook: () => Promise<void>;
    signInWithEmail: (email: string, password: string) => Promise<{ error: AuthError | null }>;
    signUpWithEmail: (email: string, password: string, displayName: string) => Promise<{ error: AuthError | null }>;
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
    children: ReactNode;
}

// Get singleton client outside component to ensure stability
const supabase = getSupabaseClient();

export function SupabaseAuthProvider({ children }: AuthProviderProps) {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Initialize auth state - run once on mount
    useEffect(() => {
        let mounted = true;
        let isProcessingProfile = false; // Guard against concurrent profile operations

        // Helper function to ensure profile exists (uses upsert to avoid duplicate key errors)
        const ensureProfile = async (authUser: User): Promise<Profile | null> => {
            if (isProcessingProfile) return null;
            isProcessingProfile = true;

            try {
                // First try to fetch existing profile
                const { data: existingProfile, error: fetchError } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', authUser.id)
                    .single();

                if (existingProfile) {
                    isProcessingProfile = false;
                    return existingProfile;
                }

                // Profile doesn't exist - use upsert to create (avoids race conditions)
                const profileData = {
                    id: authUser.id,
                    email: authUser.email || '',
                    display_name: authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'User',
                    profile_image_url: authUser.user_metadata?.avatar_url || null,
                };

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { error: upsertError } = await supabase
                    .from('profiles')
                    .upsert(profileData as any, { onConflict: 'id' });

                if (upsertError) {
                    console.error('Profile upsert error:', upsertError);
                    isProcessingProfile = false;
                    return null;
                }

                // Fetch the newly created profile
                const { data: newProfile } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', authUser.id)
                    .single();

                isProcessingProfile = false;
                return newProfile;
            } catch (error) {
                console.error('ensureProfile error:', error);
                isProcessingProfile = false;
                return null;
            }
        };

        const initAuth = async () => {
            try {
                const { data: { session: currentSession } } = await supabase.auth.getSession();

                if (currentSession?.user && mounted) {
                    setSession(currentSession);
                    setUser(currentSession.user);
                    // Set loading false early so UI shows user
                    setIsLoading(false);

                    // Fetch/create profile in background (non-blocking)
                    ensureProfile(currentSession.user).then((profileData) => {
                        if (mounted && profileData) {
                            setProfile(profileData);
                        }
                    });
                } else {
                    if (mounted) setIsLoading(false);
                }
            } catch (error) {
                console.error('Auth initialization error:', error);
                if (mounted) setIsLoading(false);
            }
        };

        initAuth();

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, currentSession) => {
                if (!mounted) return;

                // Skip processing for token refresh events
                if (event === 'TOKEN_REFRESHED') {
                    return;
                }

                setSession(currentSession);
                setUser(currentSession?.user ?? null);

                if (currentSession?.user) {
                    // Ensure profile exists (with deduplication guard)
                    const profileData = await ensureProfile(currentSession.user);
                    if (mounted && profileData) {
                        setProfile(profileData);
                    }
                } else {
                    setProfile(null);
                }

                setIsLoading(false);
            }
        );

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, []); // Empty deps - only run once

    // Memoized auth functions to prevent re-renders
    const signInWithGoogle = useCallback(async () => {
        const redirectUrl = process.env.NODE_ENV === 'production'
            ? 'https://cardversehub.com/auth/callback'
            : `${window.location.origin}/auth/callback`;
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectUrl,
            },
        });
        if (error) console.error('Google sign in error:', error);
    }, []);

    const signInWithFacebook = useCallback(async () => {
        const redirectUrl = process.env.NODE_ENV === 'production'
            ? 'https://cardversehub.com/auth/callback'
            : `${window.location.origin}/auth/callback`;
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'facebook',
            options: {
                redirectTo: redirectUrl,
            },
        });
        if (error) console.error('Facebook sign in error:', error);
    }, []);

    const signInWithEmail = useCallback(async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error };
    }, []);

    const signUpWithEmail = useCallback(async (email: string, password: string, displayName: string) => {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: displayName } },
        });

        if (!error && data.user) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await supabase.from('profiles').insert({
                id: data.user.id,
                email: data.user.email || '',
                display_name: displayName,
            } as any);
        }

        return { error };
    }, []);

    const signOut = useCallback(async () => {
        const { error } = await supabase.auth.signOut();
        if (error) console.error('Sign out error:', error);
        setUser(null);
        setProfile(null);
        setSession(null);
    }, []);

    const refreshProfile = useCallback(async () => {
        if (!user) return;
        const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();
        setProfile(data);
    }, [user]);

    // Memoize the entire context value to prevent re-renders
    const value = useMemo<AuthContextType>(() => ({
        user,
        profile,
        session,
        isLoading,
        signInWithGoogle,
        signInWithFacebook,
        signInWithEmail,
        signUpWithEmail,
        signOut,
        refreshProfile,
    }), [user, profile, session, isLoading, signInWithGoogle, signInWithFacebook, signInWithEmail, signUpWithEmail, signOut, refreshProfile]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

// Hooks
export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within a SupabaseAuthProvider');
    }
    return context;
}

export function useUser() {
    const { user, profile, isLoading } = useAuth();
    return { user, profile, isLoading };
}

// Return singleton supabase client
export function useSupabase() {
    return supabase;
}
