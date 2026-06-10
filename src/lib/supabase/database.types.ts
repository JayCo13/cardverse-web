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
                    seller_verified: boolean
                    seller_rating: number
                    seller_review_count: number
                    is_tester: boolean
                    address_province_id: number | null
                    address_province_name: string | null
                    address_district_id: number | null
                    address_district_name: string | null
                    address_ward_code: string | null
                    address_ward_name: string | null
                    address_detail: string | null
                    default_shipping_name: string | null
                    default_shipping_phone: string | null
                    default_shipping_address: string | null
                    default_shipping_province_id: number | null
                    default_shipping_province_name: string | null
                    default_shipping_district_id: number | null
                    default_shipping_district_name: string | null
                    default_shipping_ward_code: string | null
                    default_shipping_ward_name: string | null
                    default_shipping_detail: string | null
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
                    seller_verified?: boolean
                    seller_rating?: number
                    seller_review_count?: number
                    is_tester?: boolean
                    address_province_id?: number | null
                    address_province_name?: string | null
                    address_district_id?: number | null
                    address_district_name?: string | null
                    address_ward_code?: string | null
                    address_ward_name?: string | null
                    address_detail?: string | null
                    default_shipping_name?: string | null
                    default_shipping_phone?: string | null
                    default_shipping_address?: string | null
                    default_shipping_province_id?: number | null
                    default_shipping_province_name?: string | null
                    default_shipping_district_id?: number | null
                    default_shipping_district_name?: string | null
                    default_shipping_ward_code?: string | null
                    default_shipping_ward_name?: string | null
                    default_shipping_detail?: string | null
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
                    seller_verified?: boolean
                    seller_rating?: number
                    seller_review_count?: number
                    is_tester?: boolean
                    address_province_id?: number | null
                    address_province_name?: string | null
                    address_district_id?: number | null
                    address_district_name?: string | null
                    address_ward_code?: string | null
                    address_ward_name?: string | null
                    address_detail?: string | null
                    default_shipping_name?: string | null
                    default_shipping_phone?: string | null
                    default_shipping_address?: string | null
                    default_shipping_province_id?: number | null
                    default_shipping_province_name?: string | null
                    default_shipping_district_id?: number | null
                    default_shipping_district_name?: string | null
                    default_shipping_ward_code?: string | null
                    default_shipping_ward_name?: string | null
                    default_shipping_detail?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            shipping_addresses: {
                Row: {
                    id: string
                    user_id: string
                    recipient_name: string
                    phone: string
                    province_id: number
                    province_name: string
                    district_id: number
                    district_name: string
                    ward_code: string
                    ward_name: string
                    detail: string
                    is_default: boolean
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    recipient_name: string
                    phone: string
                    province_id: number
                    province_name: string
                    district_id: number
                    district_name: string
                    ward_code: string
                    ward_name: string
                    detail: string
                    is_default?: boolean
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    recipient_name?: string
                    phone?: string
                    province_id?: number
                    province_name?: string
                    district_id?: number
                    district_name?: string
                    ward_code?: string
                    ward_name?: string
                    detail?: string
                    is_default?: boolean
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
                    set_name: string | null
                    accept_offers: boolean
                    min_offer_percent: number
                    is_bundle: boolean
                    bundle_items: Json | null
                    quantity: number
                    reserved_until: string | null
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
                    set_name?: string | null
                    accept_offers?: boolean
                    min_offer_percent?: number
                    is_bundle?: boolean
                    bundle_items?: Json | null
                    quantity?: number
                    reserved_until?: string | null
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
                    set_name?: string | null
                    accept_offers?: boolean
                    min_offer_percent?: number
                    is_bundle?: boolean
                    bundle_items?: Json | null
                    quantity?: number
                    reserved_until?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            conversations: {
                Row: {
                    id: string
                    buyer_id: string
                    seller_id: string
                    card_id: string | null
                    offer_id: string | null
                    last_message_id: string | null
                    last_message_preview: string | null
                    last_message_at: string | null
                    buyer_last_read_at: string | null
                    seller_last_read_at: string | null
                    status: 'active' | 'archived' | 'blocked'
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    buyer_id: string
                    seller_id: string
                    card_id?: string | null
                    offer_id?: string | null
                    last_message_id?: string | null
                    last_message_preview?: string | null
                    last_message_at?: string | null
                    buyer_last_read_at?: string | null
                    seller_last_read_at?: string | null
                    status?: 'active' | 'archived' | 'blocked'
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    buyer_id?: string
                    seller_id?: string
                    card_id?: string | null
                    offer_id?: string | null
                    last_message_id?: string | null
                    last_message_preview?: string | null
                    last_message_at?: string | null
                    buyer_last_read_at?: string | null
                    seller_last_read_at?: string | null
                    status?: 'active' | 'archived' | 'blocked'
                    created_at?: string
                    updated_at?: string
                }
            }
            messages: {
                Row: {
                    id: string
                    conversation_id: string
                    sender_id: string
                    body: string
                    message_type: 'user' | 'system' | 'offer_auto' | 'safety_warning'
                    metadata: Json
                    flagged_terms: string[]
                    created_at: string
                    edited_at: string | null
                    deleted_at: string | null
                }
                Insert: {
                    id?: string
                    conversation_id: string
                    sender_id: string
                    body: string
                    message_type?: 'user' | 'system' | 'offer_auto' | 'safety_warning'
                    metadata?: Json
                    flagged_terms?: string[]
                    created_at?: string
                    edited_at?: string | null
                    deleted_at?: string | null
                }
                Update: {
                    id?: string
                    conversation_id?: string
                    sender_id?: string
                    body?: string
                    message_type?: 'user' | 'system' | 'offer_auto' | 'safety_warning'
                    metadata?: Json
                    flagged_terms?: string[]
                    created_at?: string
                    edited_at?: string | null
                    deleted_at?: string | null
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
                    conversation_id: string | null
                    transaction_id: string | null
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
                    conversation_id?: string | null
                    transaction_id?: string | null
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
                    conversation_id?: string | null
                    transaction_id?: string | null
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
            orders: {
                Row: {
                    id: string
                    card_id: string
                    seller_id: string
                    buyer_id: string
                    offer_id: string | null
                    amount: number
                    platform_fee: number
                    total_paid: number
                    shipping_fee: number
                    payment_method: string
                    payment_order_id: string | null
                    status: string
                    tracking_number: string | null
                    shipping_provider: string | null
                    shipping_address: string | null
                    ghn_order_code: string | null
                    ghn_shipping_fee: number | null
                    ghn_expected_delivery: string | null
                    ghn_status: string | null
                    to_province_id: number | null
                    to_province_name: string | null
                    to_district_id: number | null
                    to_district_name: string | null
                    to_ward_code: string | null
                    to_ward_name: string | null
                    to_address_detail: string | null
                    to_name: string | null
                    to_phone: string | null
                    buyer_confirmed_at: string | null
                    auto_complete_at: string | null
                    dispute_reason: string | null
                    dispute_evidence_url: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    card_id: string
                    seller_id: string
                    buyer_id: string
                    offer_id?: string | null
                    amount: number
                    platform_fee?: number
                    total_paid: number
                    shipping_fee?: number
                    payment_method: string
                    payment_order_id?: string | null
                    status?: string
                    tracking_number?: string | null
                    shipping_provider?: string | null
                    shipping_address?: string | null
                    ghn_order_code?: string | null
                    ghn_shipping_fee?: number | null
                    ghn_expected_delivery?: string | null
                    ghn_status?: string | null
                    to_province_id?: number | null
                    to_province_name?: string | null
                    to_district_id?: number | null
                    to_district_name?: string | null
                    to_ward_code?: string | null
                    to_ward_name?: string | null
                    to_address_detail?: string | null
                    to_name?: string | null
                    to_phone?: string | null
                    buyer_confirmed_at?: string | null
                    auto_complete_at?: string | null
                    dispute_reason?: string | null
                    dispute_evidence_url?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    card_id?: string
                    seller_id?: string
                    buyer_id?: string
                    offer_id?: string | null
                    amount?: number
                    platform_fee?: number
                    total_paid?: number
                    shipping_fee?: number
                    payment_method?: string
                    payment_order_id?: string | null
                    status?: string
                    tracking_number?: string | null
                    shipping_provider?: string | null
                    shipping_address?: string | null
                    ghn_order_code?: string | null
                    ghn_shipping_fee?: number | null
                    ghn_expected_delivery?: string | null
                    ghn_status?: string | null
                    to_province_id?: number | null
                    to_province_name?: string | null
                    to_district_id?: number | null
                    to_district_name?: string | null
                    to_ward_code?: string | null
                    to_ward_name?: string | null
                    to_address_detail?: string | null
                    to_name?: string | null
                    to_phone?: string | null
                    buyer_confirmed_at?: string | null
                    auto_complete_at?: string | null
                    dispute_reason?: string | null
                    dispute_evidence_url?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            seller_verifications: {
                Row: {
                    id: string
                    user_id: string
                    full_name: string
                    id_card_front_url: string
                    id_card_back_url: string
                    bank_name: string
                    bank_account_number: string
                    bank_account_name: string
                    bank_screenshot_url: string | null
                    phone_number: string | null
                    ai_cccd_name: string | null
                    ai_bank_name: string | null
                    ai_bank_number: string | null
                    ai_confidence: number | null
                    ai_name_match: boolean | null
                    ai_scan_id: string | null
                    phone_verified_at: string | null
                    status: string
                    reviewed_by: string | null
                    reviewed_at: string | null
                    rejection_reason: string | null
                    created_at: string | null
                    updated_at: string | null
                }
                Insert: {
                    id?: string
                    user_id: string
                    full_name: string
                    id_card_front_url: string
                    id_card_back_url: string
                    bank_name: string
                    bank_account_number: string
                    bank_account_name: string
                    bank_screenshot_url?: string | null
                    phone_number?: string | null
                    ai_cccd_name?: string | null
                    ai_bank_name?: string | null
                    ai_bank_number?: string | null
                    ai_confidence?: number | null
                    ai_name_match?: boolean | null
                    ai_scan_id?: string | null
                    phone_verified_at?: string | null
                    status?: string
                    reviewed_by?: string | null
                    reviewed_at?: string | null
                    rejection_reason?: string | null
                    created_at?: string | null
                    updated_at?: string | null
                }
                Update: {
                    id?: string
                    user_id?: string
                    full_name?: string
                    id_card_front_url?: string
                    id_card_back_url?: string
                    bank_name?: string
                    bank_account_number?: string
                    bank_account_name?: string
                    bank_screenshot_url?: string | null
                    phone_number?: string | null
                    ai_cccd_name?: string | null
                    ai_bank_name?: string | null
                    ai_bank_number?: string | null
                    ai_confidence?: number | null
                    ai_name_match?: boolean | null
                    ai_scan_id?: string | null
                    phone_verified_at?: string | null
                    status?: string
                    reviewed_by?: string | null
                    reviewed_at?: string | null
                    rejection_reason?: string | null
                    created_at?: string | null
                    updated_at?: string | null
                }
            }
            kyc_verification_scans: {
                Row: {
                    id: string
                    user_id: string
                    cccd_name: string | null
                    cccd_id_number: string | null
                    cccd_dob: string | null
                    is_valid_cccd: boolean
                    is_valid_cccd_back: boolean
                    bank_account_name_ai: string | null
                    bank_account_number_ai: string | null
                    bank_name_detected: string | null
                    is_valid_bank: boolean
                    ai_name_match: boolean
                    is_cccd_bank_match: boolean
                    is_cccd_user_match: boolean
                    confidence: number
                    issues: Json | null
                    raw_front_response: Json | null
                    raw_back_response: Json | null
                    raw_bank_response: Json | null
                    expires_at: string
                    used_at: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    cccd_name?: string | null
                    cccd_id_number?: string | null
                    cccd_dob?: string | null
                    is_valid_cccd?: boolean
                    is_valid_cccd_back?: boolean
                    bank_account_name_ai?: string | null
                    bank_account_number_ai?: string | null
                    bank_name_detected?: string | null
                    is_valid_bank?: boolean
                    ai_name_match?: boolean
                    is_cccd_bank_match?: boolean
                    is_cccd_user_match?: boolean
                    confidence?: number
                    issues?: Json | null
                    raw_front_response?: Json | null
                    raw_back_response?: Json | null
                    raw_bank_response?: Json | null
                    expires_at?: string
                    used_at?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    cccd_name?: string | null
                    cccd_id_number?: string | null
                    cccd_dob?: string | null
                    is_valid_cccd?: boolean
                    is_valid_cccd_back?: boolean
                    bank_account_name_ai?: string | null
                    bank_account_number_ai?: string | null
                    bank_name_detected?: string | null
                    is_valid_bank?: boolean
                    ai_name_match?: boolean
                    is_cccd_bank_match?: boolean
                    is_cccd_user_match?: boolean
                    confidence?: number
                    issues?: Json | null
                    raw_front_response?: Json | null
                    raw_back_response?: Json | null
                    raw_bank_response?: Json | null
                    expires_at?: string
                    used_at?: string | null
                    created_at?: string
                }
            }
            soccer_sets: {
                Row: {
                    id: number
                    brand: string
                    set_name: string
                    year: number
                    season: string | null
                    category: string
                    external_ids: Json
                    created_at: string
                }
                Insert: {
                    id?: number
                    brand: string
                    set_name: string
                    year: number
                    season?: string | null
                    category?: string
                    external_ids?: Json
                    created_at?: string
                }
                Update: {
                    id?: number
                    brand?: string
                    set_name?: string
                    year?: number
                    season?: string | null
                    category?: string
                    external_ids?: Json
                    created_at?: string
                }
            }
            soccer_cards: {
                Row: {
                    id: number
                    set_id: number | null
                    brand: string
                    year: number
                    set_name: string
                    player: string
                    card_number: string | null
                    parallel: string
                    print_run: number | null
                    is_rookie: boolean
                    is_autograph: boolean
                    is_memorabilia: boolean
                    tier: number
                    attributes: Json
                    external_ids: Json
                    search_name: string
                    player_norm: string
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: number
                    set_id?: number | null
                    brand: string
                    year: number
                    set_name: string
                    player: string
                    card_number?: string | null
                    parallel?: string
                    print_run?: number | null
                    is_rookie?: boolean
                    is_autograph?: boolean
                    is_memorabilia?: boolean
                    tier?: number
                    attributes?: Json
                    external_ids?: Json
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: number
                    set_id?: number | null
                    brand?: string
                    year?: number
                    set_name?: string
                    player?: string
                    card_number?: string | null
                    parallel?: string
                    print_run?: number | null
                    is_rookie?: boolean
                    is_autograph?: boolean
                    is_memorabilia?: boolean
                    tier?: number
                    attributes?: Json
                    external_ids?: Json
                    created_at?: string
                    updated_at?: string
                }
            }
            soccer_price_cache: {
                Row: {
                    card_id: number
                    market_price: number | null
                    low_price: number | null
                    mid_price: number | null
                    high_price: number | null
                    currency: string
                    sample_size: number
                    source: string
                    fetched_at: string
                    expires_at: string
                }
                Insert: {
                    card_id: number
                    market_price?: number | null
                    low_price?: number | null
                    mid_price?: number | null
                    high_price?: number | null
                    currency?: string
                    sample_size?: number
                    source?: string
                    fetched_at?: string
                    expires_at?: string
                }
                Update: {
                    card_id?: number
                    market_price?: number | null
                    low_price?: number | null
                    mid_price?: number | null
                    high_price?: number | null
                    currency?: string
                    sample_size?: number
                    source?: string
                    fetched_at?: string
                    expires_at?: string
                }
            }
            soccer_own_sales: {
                Row: {
                    id: number
                    card_id: number
                    order_id: string | null
                    price: number
                    currency: string
                    sold_at: string
                    created_at: string
                }
                Insert: {
                    id?: number
                    card_id: number
                    order_id?: string | null
                    price: number
                    currency?: string
                    sold_at?: string
                    created_at?: string
                }
                Update: {
                    id?: number
                    card_id?: number
                    order_id?: string | null
                    price?: number
                    currency?: string
                    sold_at?: string
                    created_at?: string
                }
            }
        }
        Views: {
            [_ in never]: never
        }
        Functions: {
            match_soccer_card: {
                Args: {
                    p_query: string
                    p_brand?: string | null
                    p_year?: number | null
                    p_card_number?: string | null
                    p_parallel?: string | null
                    p_limit?: number | null
                }
                Returns: {
                    id: number
                    player: string
                    set_name: string
                    parallel: string
                    card_number: string | null
                    year: number
                    tier: number
                    score: number
                }[]
            }
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
