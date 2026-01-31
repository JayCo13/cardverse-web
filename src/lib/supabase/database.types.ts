export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            profiles: {
                Row: {
                    id: string
                    email: string
                    display_name: string | null
                    phone_number: string | null
                    address: string | null
                    city: string | null
                    profile_image_url: string | null
                    legit_rate: number
                    total_transactions: number
                    completed_transactions: number
                    cancelled_transactions: number
                    daily_cancellations: number
                    last_cancellation_date: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id: string
                    email: string
                    display_name?: string | null
                    phone_number?: string | null
                    address?: string | null
                    city?: string | null
                    profile_image_url?: string | null
                    legit_rate?: number
                    total_transactions?: number
                    completed_transactions?: number
                    cancelled_transactions?: number
                    daily_cancellations?: number
                    last_cancellation_date?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    email?: string
                    display_name?: string | null
                    phone_number?: string | null
                    address?: string | null
                    city?: string | null
                    profile_image_url?: string | null
                    legit_rate?: number
                    total_transactions?: number
                    completed_transactions?: number
                    cancelled_transactions?: number
                    daily_cancellations?: number
                    last_cancellation_date?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            cards: {
                Row: {
                    id: string
                    name: string
                    image_url: string | null
                    image_urls: string[] | null
                    category: string
                    condition: string | null
                    listing_type: 'sale' | 'auction' | 'razz'
                    price: number | null
                    current_bid: number | null
                    starting_bid: number | null
                    auction_ends: string | null
                    ticket_price: number | null
                    razz_entries: number | null
                    total_tickets: number | null
                    seller_id: string
                    description: string | null
                    last_sold_price: number | null
                    status: 'active' | 'sold' | 'expired' | 'in_transaction'
                    publisher: string | null
                    season: string | null
                    quantity: number
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    name: string
                    image_url?: string | null
                    image_urls?: string[] | null
                    category: string
                    condition?: string | null
                    listing_type: 'sale' | 'auction' | 'razz'
                    price?: number | null
                    current_bid?: number | null
                    starting_bid?: number | null
                    auction_ends?: string | null
                    ticket_price?: number | null
                    razz_entries?: number | null
                    total_tickets?: number | null
                    seller_id: string
                    description?: string | null
                    last_sold_price?: number | null
                    status?: 'active' | 'sold' | 'expired' | 'in_transaction'
                    publisher?: string | null
                    season?: string | null
                    quantity?: number
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    name?: string
                    image_url?: string | null
                    image_urls?: string[] | null
                    category?: string
                    condition?: string | null
                    listing_type?: 'sale' | 'auction' | 'razz'
                    price?: number | null
                    current_bid?: number | null
                    starting_bid?: number | null
                    auction_ends?: string | null
                    ticket_price?: number | null
                    razz_entries?: number | null
                    total_tickets?: number | null
                    seller_id?: string
                    description?: string | null
                    last_sold_price?: number | null
                    status?: 'active' | 'sold' | 'expired' | 'in_transaction'
                    publisher?: string | null
                    season?: string | null
                    quantity?: number
                    created_at?: string
                    updated_at?: string
                }
            }
            offers: {
                Row: {
                    id: string
                    card_id: string
                    buyer_id: string
                    price: number
                    message: string | null
                    status: 'pending' | 'accepted' | 'rejected' | 'chosen'
                    transaction_id: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    card_id: string
                    buyer_id: string
                    price: number
                    message?: string | null
                    status?: 'pending' | 'accepted' | 'rejected' | 'chosen'
                    transaction_id?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    card_id?: string
                    buyer_id?: string
                    price?: number
                    message?: string | null
                    status?: 'pending' | 'accepted' | 'rejected' | 'chosen'
                    transaction_id?: string | null
                    created_at?: string
                }
            }
            transactions: {
                Row: {
                    id: string
                    card_id: string
                    seller_id: string
                    buyer_id: string
                    offer_id: string | null
                    price: number
                    status: 'active' | 'completed' | 'cancelled' | 'auto_cancelled'
                    cancelled_by: 'seller' | 'buyer' | 'system' | null
                    cancellation_reason: string | null
                    expires_at: string
                    completed_at: string | null
                    cancelled_at: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    card_id: string
                    seller_id: string
                    buyer_id: string
                    offer_id?: string | null
                    price: number
                    status?: 'active' | 'completed' | 'cancelled' | 'auto_cancelled'
                    cancelled_by?: 'seller' | 'buyer' | 'system' | null
                    cancellation_reason?: string | null
                    expires_at: string
                    completed_at?: string | null
                    cancelled_at?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    card_id?: string
                    seller_id?: string
                    buyer_id?: string
                    offer_id?: string | null
                    price?: number
                    status?: 'active' | 'completed' | 'cancelled' | 'auto_cancelled'
                    cancelled_by?: 'seller' | 'buyer' | 'system' | null
                    cancellation_reason?: string | null
                    expires_at?: string
                    completed_at?: string | null
                    cancelled_at?: string | null
                    created_at?: string
                }
            }
            notifications: {
                Row: {
                    id: string
                    user_id: string
                    type: string
                    title: string
                    message: string
                    card_id: string | null
                    offer_id: string | null
                    read: boolean
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    type: string
                    title: string
                    message: string
                    card_id?: string | null
                    offer_id?: string | null
                    read?: boolean
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    type?: string
                    title?: string
                    message?: string
                    card_id?: string | null
                    offer_id?: string | null
                    read?: boolean
                    created_at?: string
                }
            }
            cancellations: {
                Row: {
                    id: string
                    user_id: string
                    transaction_id: string
                    reason: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    transaction_id: string
                    reason: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    transaction_id?: string
                    reason?: string
                    created_at?: string
                }
            }
        }
        Views: {
            [_ in never]: never
        }
        Functions: {
            [_ in never]: never
        }
        Enums: {
            [_ in never]: never
        }
    }
}

// Helper types
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type InsertTables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type UpdateTables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
