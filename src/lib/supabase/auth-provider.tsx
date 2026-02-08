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
    signUpWithEmail: (email: string, password: string, displayName: string, locale?: string) => Promise<{ error: AuthError | null }>;
    verifyOtp: (email: string, token: string) => Promise<{ error: AuthError | null; session: Session | null }>;
    resendOtp: (email: string) => Promise<{ error: AuthError | null }>;
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
                    // Check if email is confirmed (OAuth users have confirmed_at set automatically)
                    const isEmailConfirmed = currentSession.user.email_confirmed_at != null;
                    const isOAuthUser = currentSession.user.app_metadata?.provider !== 'email';

                    if (isEmailConfirmed || isOAuthUser) {
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
                        // User exists but email not confirmed - don't log them in
                        if (mounted) setIsLoading(false);
                    }
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

                if (currentSession?.user) {
                    // Check if email is confirmed (OAuth users have confirmed_at set automatically)
                    const isEmailConfirmed = currentSession.user.email_confirmed_at != null;
                    const isOAuthUser = currentSession.user.app_metadata?.provider !== 'email';

                    if (isEmailConfirmed || isOAuthUser) {
                        setSession(currentSession);
                        setUser(currentSession.user);

                        // Ensure profile exists (with deduplication guard)
                        const profileData = await ensureProfile(currentSession.user);
                        if (mounted && profileData) {
                            setProfile(profileData);
                        }
                    } else {
                        // User exists but email not confirmed - don't log them in
                        setSession(null);
                        setUser(null);
                        setProfile(null);
                    }
                } else {
                    setSession(null);
                    setUser(null);
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
        // Always use current origin + /auth/callback for the redirect
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });
        if (error) console.error('Google sign in error:', error);
    }, []);

    const signInWithFacebook = useCallback(async () => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'facebook',
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });
        if (error) console.error('Facebook sign in error:', error);
    }, []);

    const signInWithEmail = useCallback(async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error };
    }, []);

    const signUpWithEmail = useCallback(async (email: string, password: string, displayName: string, locale: string = 'en') => {
        // Get the current origin for email redirect
        const redirectUrl = typeof window !== 'undefined'
            ? `${window.location.origin}/auth/callback`
            : process.env.NEXT_PUBLIC_SITE_URL
                ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`
                : 'https://cardverse.co/auth/callback';

        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: displayName,
                    locale: locale, // Pass locale for email templates
                },
                emailRedirectTo: redirectUrl,
            },
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

    const verifyOtp = useCallback(async (email: string, token: string) => {
        const { data, error } = await supabase.auth.verifyOtp({
            email,
            token,
            type: 'email',
        });
        return { error, session: data.session };
    }, []);

    const resendOtp = useCallback(async (email: string) => {
        const { error } = await supabase.auth.resend({
            type: 'signup',
            email,
        });
        return { error };
    }, []);

    const signOut = useCallback(async () => {
        try {
            // Clear local state first for immediate UI feedback
            setUser(null);
            setProfile(null);
            setSession(null);

            // Then sign out from Supabase (scope: 'global' signs out all sessions)
            const { error } = await supabase.auth.signOut({ scope: 'global' });
            if (error) {
                console.error('Sign out error:', error);
            }
        } catch (err) {
            console.error('Sign out exception:', err);
        }
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
        verifyOtp,
        resendOtp,
        signOut,
        refreshProfile,
    }), [user, profile, session, isLoading, signInWithGoogle, signInWithFacebook, signInWithEmail, signUpWithEmail, verifyOtp, resendOtp, signOut, refreshProfile]);

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
