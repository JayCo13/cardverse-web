// Client-side exports only - do not import server.ts here as it uses next/headers
export { createClient, getSupabaseClient } from './client';
export { SupabaseAuthProvider, useAuth, useUser, useSupabase } from './auth-provider';
export type { Database, Tables, InsertTables, UpdateTables } from './database.types';

// For server components, import directly:
// import { createServerSupabaseClient } from '@/lib/supabase/server';
