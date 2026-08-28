export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

type FinancialSystemStateRow = {
    singleton: boolean
    maintenance_active: boolean
    cutoff_at: string | null
    generation: number
    reason: string | null
    changed_by: string | null
    changed_at: string
}

type WalletFundSourceRow = {
    id: string
    user_id: string
    wallet_id: string
    source_type: 'payos_deposit' | 'marketplace_sale' | 'refund' | 'legacy_reconciliation' | 'withdrawal_return' | 'compensation'
    source_id: string
    original_amount: number
    remaining_amount: number
    verification_status: 'verified' | 'review_required' | 'blocked' | 'revoked'
    credits_wallet: boolean
    evidence: Json
    occurred_at: string
    created_at: string
    updated_at: string
}

type WalletFundAllocationRow = {
    id: string
    fund_source_id: string
    user_id: string
    purpose_type: 'wallet_purchase' | 'withdrawal'
    purpose_id: string
    amount: number
    status: 'reserved' | 'consumed' | 'released'
    idempotency_key: string
    group_idempotency_key: string | null
    occurred_at: string
    created_at: string
    consumed_at: string | null
    released_at: string | null
}

type WalletReconciliationRecordRow = {
    id: string
    user_id: string
    wallet_id: string
    amount: number
    evidence_type: string
    evidence_reference: string
    reason: string
    idempotency_key: string
    created_by: string
    created_at: string
}

type PaymentWebhookEventRow = {
    id: string
    provider: string
    provider_event_key: string
    order_code: number | null
    event_code: string | null
    amount: number | null
    currency: string
    signature_verified: boolean
    payload_sanitized: Json
    status: 'received' | 'deferred' | 'processed' | 'rejected' | 'review_required'
    result: Json | null
    provider_occurred_at: string | null
    received_at: string
    processed_at: string | null
    post_processing_status: 'pending' | 'processing' | 'completed' | 'failed'
    post_processing_claim_id: string | null
    post_processing_claimed_at: string | null
    post_processing_error: string | null
}

type UserSubscriptionRow = {
    id: string
    user_id: string
    package_type: string
    status: string
    starts_at: string
    expires_at: string | null
    scan_credits_remaining: number | null
    payment_reference: string | null
    created_at: string
    updated_at: string
}

type PaymentOrderRow = {
    id: string
    user_id: string
    order_code: number
    package_type: 'day_pass' | 'credit_pack' | 'vip_pro' | 'deposit' | 'marketplace_order'
    amount: number
    currency: string
    status: 'pending' | 'paid' | 'cancelled' | 'fraud_suspected'
    server_idempotency_key: string | null
    server_request_hash: string | null
    payos_payment_link_id: string | null
    payos_checkout_url: string | null
    link_creation_claim_id: string | null
    link_creation_started_at: string | null
    paid_at: string | null
    created_at: string
    updated_at: string
}

type MarketplaceOrderFundingRow = {
    id: string
    order_id: string
    buyer_id: string
    seller_id: string
    funding_method: 'wallet' | 'direct_payos'
    gross_amount: number
    verified_amount: number
    unverified_amount: number
    classification: 'native_verified_escrow' | 'backfilled_verified_escrow' | 'legacy_escrow_blocked' | 'disputed_frozen' | 'released' | 'cancelled'
    payment_order_id: string | null
    provider_evidence_event_id: string | null
    cutoff_at: string | null
    evidence: Json
    created_at: string
    updated_at: string
}

type WithdrawalTransferAttemptRow = {
    id: string
    withdrawal_id: string
    verification_claim_id: string
    verification_version: number
    verification_snapshot: Json
    allocation_snapshot: Json
    amount_requested: number
    fee_amount: number
    amount_net: number
    currency: string
    destination_bank_name: string
    destination_bank_code: string | null
    destination_account_name: string
    destination_account_number: string
    destination_account_masked: string
    status: 'initiated' | 'bank_accepted' | 'confirmed' | 'failed' | 'returned' | 'unknown'
    started_by: string
    started_at: string
    transfer_reference: string | null
    completed_at: string | null
    failure_reason: string | null
    failure_evidence: Json | null
    return_reference: string | null
    return_evidence: Json | null
    returned_at: string | null
    recovery_required: boolean
}

type WithdrawalActionRequestRow = {
    id: string
    withdrawal_id: string
    actor_id: string
    actor_role: 'admin' | 'moderator' | 'operator'
    action: string
    idempotency_key: string
    request_hash: string
    request_payload: Json
    status: 'processing' | 'completed'
    response_payload: Json | null
    created_at: string
    completed_at: string | null
}

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
                    shipping_carriers: string[]
                    shipping_fees: Json
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
                    shipping_carriers?: string[]
                    shipping_fees?: Json
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
                    shipping_carriers?: string[]
                    shipping_fees?: Json
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
                    catalog_product_id: number | null
                    catalog_soccer_id: number | null
                    card_number: string | null
                    language: string | null
                    grading_company: string | null
                    grade: number | null
                    finish: string | null
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
                    catalog_product_id?: number | null
                    catalog_soccer_id?: number | null
                    card_number?: string | null
                    language?: string | null
                    grading_company?: string | null
                    grade?: number | null
                    finish?: string | null
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
                    catalog_product_id?: number | null
                    catalog_soccer_id?: number | null
                    card_number?: string | null
                    language?: string | null
                    grading_company?: string | null
                    grade?: number | null
                    finish?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            vn_card_sales: {
                Row: {
                    id: string
                    catalog_product_id: number | null
                    catalog_soccer_id: number | null
                    card_id: string | null
                    category_id: number | null
                    card_number: string | null
                    language: string | null
                    grading_company: string
                    grade: number | null
                    finish: string | null
                    price: number
                    sold_at: string
                }
                Insert: {
                    id?: string
                    catalog_product_id?: number | null
                    catalog_soccer_id?: number | null
                    card_id?: string | null
                    category_id?: number | null
                    card_number?: string | null
                    language?: string | null
                    grading_company?: string
                    grade?: number | null
                    finish?: string | null
                    price: number
                    sold_at?: string
                }
                Update: {
                    id?: string
                    catalog_product_id?: number | null
                    catalog_soccer_id?: number | null
                    card_id?: string | null
                    category_id?: number | null
                    card_number?: string | null
                    language?: string | null
                    grading_company?: string
                    grade?: number | null
                    finish?: string | null
                    price?: number
                    sold_at?: string
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
            conversation_notification_preferences: {
                Row: {
                    conversation_id: string
                    user_id: string
                    muted: boolean
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    conversation_id: string
                    user_id: string
                    muted?: boolean
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    conversation_id?: string
                    user_id?: string
                    muted?: boolean
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
            wallets: {
                Row: {
                    id: string
                    user_id: string
                    available_balance: number
                    held_balance: number
                    total_deposited: number
                    total_withdrawn: number
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    available_balance?: number
                    held_balance?: number
                    total_deposited?: number
                    total_withdrawn?: number
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    available_balance?: number
                    held_balance?: number
                    total_deposited?: number
                    total_withdrawn?: number
                    created_at?: string
                    updated_at?: string
                }
            }
            financial_system_state: {
                Row: FinancialSystemStateRow
                Insert: Partial<FinancialSystemStateRow>
                Update: Partial<FinancialSystemStateRow>
            }
            wallet_fund_sources: {
                Row: WalletFundSourceRow
                Insert: Partial<WalletFundSourceRow> & Pick<WalletFundSourceRow, 'user_id' | 'wallet_id' | 'source_type' | 'source_id' | 'original_amount' | 'remaining_amount' | 'verification_status'>
                Update: Partial<WalletFundSourceRow>
            }
            wallet_fund_allocations: {
                Row: WalletFundAllocationRow
                Insert: Partial<WalletFundAllocationRow> & Pick<WalletFundAllocationRow, 'fund_source_id' | 'user_id' | 'purpose_type' | 'purpose_id' | 'amount' | 'status' | 'idempotency_key'>
                Update: Partial<WalletFundAllocationRow>
            }
            wallet_reconciliation_records: {
                Row: WalletReconciliationRecordRow
                Insert: Partial<WalletReconciliationRecordRow> & Pick<WalletReconciliationRecordRow, 'user_id' | 'wallet_id' | 'amount' | 'evidence_type' | 'evidence_reference' | 'reason' | 'idempotency_key' | 'created_by'>
                Update: Partial<WalletReconciliationRecordRow>
            }
            payment_orders: {
                Row: PaymentOrderRow
                Insert: Partial<PaymentOrderRow> & Pick<PaymentOrderRow, 'user_id' | 'order_code' | 'package_type' | 'amount'>
                Update: Partial<PaymentOrderRow>
            }
            payment_webhook_events: {
                Row: PaymentWebhookEventRow
                Insert: Partial<PaymentWebhookEventRow> & Pick<PaymentWebhookEventRow, 'provider_event_key' | 'signature_verified' | 'status'>
                Update: Partial<PaymentWebhookEventRow>
            }
            user_subscriptions: {
                Row: UserSubscriptionRow
                Insert: Partial<UserSubscriptionRow> & Pick<UserSubscriptionRow, 'user_id' | 'package_type'>
                Update: Partial<UserSubscriptionRow>
            }
            payment_fulfillments: {
                Row: { id: string; payment_order_id: string; fulfillment_type: string; result: Json; created_at: string }
                Insert: { id?: string; payment_order_id: string; fulfillment_type: string; result?: Json; created_at?: string }
                Update: { id?: string; payment_order_id?: string; fulfillment_type?: string; result?: Json; created_at?: string }
            }
            scan_credit_consumptions: {
                Row: { id: string; user_id: string; subscription_id: string; idempotency_key: string; remaining_after: number; created_at: string }
                Insert: { id?: string; user_id: string; subscription_id: string; idempotency_key: string; remaining_after: number; created_at?: string }
                Update: { id?: string; user_id?: string; subscription_id?: string; idempotency_key?: string; remaining_after?: number; created_at?: string }
            }
            marketplace_order_funding: {
                Row: MarketplaceOrderFundingRow
                Insert: Partial<MarketplaceOrderFundingRow> & Pick<MarketplaceOrderFundingRow, 'order_id' | 'buyer_id' | 'seller_id' | 'funding_method' | 'gross_amount' | 'classification'>
                Update: Partial<MarketplaceOrderFundingRow>
            }
            withdrawal_transfer_attempts: {
                Row: WithdrawalTransferAttemptRow
                Insert: Partial<WithdrawalTransferAttemptRow> & Pick<WithdrawalTransferAttemptRow, 'withdrawal_id' | 'verification_claim_id' | 'verification_version' | 'verification_snapshot' | 'allocation_snapshot' | 'amount_requested' | 'fee_amount' | 'amount_net' | 'currency' | 'destination_bank_name' | 'destination_account_name' | 'destination_account_number' | 'destination_account_masked' | 'status' | 'started_by'>
                Update: Partial<WithdrawalTransferAttemptRow>
            }
            withdrawal_action_requests: {
                Row: WithdrawalActionRequestRow
                Insert: Partial<WithdrawalActionRequestRow> & Pick<WithdrawalActionRequestRow, 'withdrawal_id' | 'actor_id' | 'actor_role' | 'action' | 'idempotency_key' | 'request_hash'>
                Update: Partial<WithdrawalActionRequestRow>
            }
            withdrawal_audit_events: {
                Row: { id: string; withdrawal_id: string; transfer_attempt_id: string | null; actor_id: string; actor_role: string; action: string; reason: string | null; evidence: Json; created_at: string }
                Insert: { id?: string; withdrawal_id: string; transfer_attempt_id?: string | null; actor_id: string; actor_role: string; action: string; reason?: string | null; evidence?: Json; created_at?: string }
                Update: { id?: string; withdrawal_id?: string; transfer_attempt_id?: string | null; actor_id?: string; actor_role?: string; action?: string; reason?: string | null; evidence?: Json; created_at?: string }
            }
            admin_login_attempts: {
                Row: { id: string; ip_hash: string; account_hash: string; succeeded: boolean; created_at: string }
                Insert: { id?: string; ip_hash: string; account_hash: string; succeeded: boolean; created_at?: string }
                Update: { id?: string; ip_hash?: string; account_hash?: string; succeeded?: boolean; created_at?: string }
            }
            marketplace_dispute_actions: {
                Row: { id: string; order_id: string; action: 'refund_buyer' | 'release_seller'; actor_id: string; actor_role: string; idempotency_key: string; result: Json | null; created_at: string }
                Insert: { id?: string; order_id: string; action: 'refund_buyer' | 'release_seller'; actor_id: string; actor_role: string; idempotency_key: string; result?: Json | null; created_at?: string }
                Update: { id?: string; order_id?: string; action?: 'refund_buyer' | 'release_seller'; actor_id?: string; actor_role?: string; idempotency_key?: string; result?: Json | null; created_at?: string }
            }
            marketplace_order_action_requests: {
                Row: { id: string; order_id: string; actor_id: string; action: 'ship' | 'confirm_received' | 'open_dispute'; idempotency_key: string; request_hash: string; request_payload: Json; result: Json | null; created_at: string; completed_at: string | null }
                Insert: { id?: string; order_id: string; actor_id: string; action: 'ship' | 'confirm_received' | 'open_dispute'; idempotency_key: string; request_hash: string; request_payload?: Json; result?: Json | null; created_at?: string; completed_at?: string | null }
                Update: { id?: string; order_id?: string; actor_id?: string; action?: 'ship' | 'confirm_received' | 'open_dispute'; idempotency_key?: string; request_hash?: string; request_payload?: Json; result?: Json | null; created_at?: string; completed_at?: string | null }
            }
            admin_subscription_grant_requests: {
                Row: { id: string; idempotency_key: string; actor_id: string; actor_role: 'admin' | 'moderator'; user_id: string; package_type: 'day_pass' | 'credit_pack' | 'vip_pro'; result: Json; created_at: string }
                Insert: { id?: string; idempotency_key: string; actor_id: string; actor_role: 'admin' | 'moderator'; user_id: string; package_type: 'day_pass' | 'credit_pack' | 'vip_pro'; result?: Json; created_at?: string }
                Update: { id?: string; idempotency_key?: string; actor_id?: string; actor_role?: 'admin' | 'moderator'; user_id?: string; package_type?: 'day_pass' | 'credit_pack' | 'vip_pro'; result?: Json; created_at?: string }
            }
            offer_action_requests: {
                Row: { id: string; offer_id: string; actor_id: string; action: 'accept' | 'reject'; idempotency_key: string; result: Json; created_at: string }
                Insert: { id?: string; offer_id: string; actor_id: string; action: 'accept' | 'reject'; idempotency_key: string; result?: Json; created_at?: string }
                Update: { id?: string; offer_id?: string; actor_id?: string; action?: 'accept' | 'reject'; idempotency_key?: string; result?: Json; created_at?: string }
            }
            wallet_transactions: {
                Row: {
                    id: string
                    wallet_id: string
                    user_id: string
                    type: string
                    amount: number
                    balance_after: number
                    description: string | null
                    reference_id: string | null
                    reference_type: string | null
                    fund_source_id: string | null
                    idempotency_key: string | null
                    affects_balance: boolean
                    metadata: Json
                    created_at: string
                }
                Insert: {
                    id?: string
                    wallet_id: string
                    user_id: string
                    type: string
                    amount: number
                    balance_after: number
                    description?: string | null
                    reference_id?: string | null
                    reference_type?: string | null
                    fund_source_id?: string | null
                    idempotency_key?: string | null
                    affects_balance?: boolean
                    metadata?: Json
                    created_at?: string
                }
                Update: {
                    id?: string
                    wallet_id?: string
                    user_id?: string
                    type?: string
                    amount?: number
                    balance_after?: number
                    description?: string | null
                    reference_id?: string | null
                    reference_type?: string | null
                    fund_source_id?: string | null
                    idempotency_key?: string | null
                    affects_balance?: boolean
                    metadata?: Json
                    created_at?: string
                }
            }
            wallet_withdrawals: {
                Row: {
                    id: string
                    user_id: string
                    amount_requested: number
                    fee: number
                    amount_net: number
                    currency: string
                    bank_name: string
                    bank_account_number: string
                    /** Generated column: digits only. Read-only. */
                    bank_account_number_normalized: string
                    bank_account_name: string
                    bank_account_masked: string | null
                    status: 'pending' | 'processing' | 'completed' | 'rejected'
                    rejection_reason: string | null
                    reservation_model: 'legacy_debited' | 'held'
                    ledger_recorded: boolean
                    funding_state: string
                    request_idempotency_key: string | null
                    request_hash: string | null
                    risk_flags: Json
                    verification_claim_id: string | null
                    claimed_by: string | null
                    processing_started_at: string | null
                    processing_expires_at: string | null
                    verification_version: number | null
                    verification_snapshot: Json | null
                    transfer_started_at: string | null
                    active_transfer_attempt_id: string | null
                    recovery_required: boolean
                    recovery_reason: string | null
                    created_at: string
                    processed_at: string | null
                }
                Insert: {
                    id?: string
                    user_id: string
                    amount_requested: number
                    fee: number
                    amount_net: number
                    currency?: string
                    bank_name: string
                    bank_account_number: string
                    bank_account_name: string
                    bank_account_masked?: string | null
                    status?: 'pending' | 'processing' | 'completed' | 'rejected'
                    rejection_reason?: string | null
                    reservation_model?: 'legacy_debited' | 'held'
                    ledger_recorded?: boolean
                    funding_state?: string
                    request_idempotency_key?: string | null
                    request_hash?: string | null
                    risk_flags?: Json
                    verification_claim_id?: string | null
                    claimed_by?: string | null
                    processing_started_at?: string | null
                    processing_expires_at?: string | null
                    verification_version?: number | null
                    verification_snapshot?: Json | null
                    transfer_started_at?: string | null
                    active_transfer_attempt_id?: string | null
                    recovery_required?: boolean
                    recovery_reason?: string | null
                    created_at?: string
                    processed_at?: string | null
                }
                Update: {
                    id?: string
                    user_id?: string
                    amount_requested?: number
                    fee?: number
                    amount_net?: number
                    currency?: string
                    bank_name?: string
                    bank_account_number?: string
                    bank_account_name?: string
                    bank_account_masked?: string | null
                    status?: 'pending' | 'processing' | 'completed' | 'rejected'
                    rejection_reason?: string | null
                    reservation_model?: 'legacy_debited' | 'held'
                    ledger_recorded?: boolean
                    funding_state?: string
                    request_idempotency_key?: string | null
                    request_hash?: string | null
                    risk_flags?: Json
                    verification_claim_id?: string | null
                    claimed_by?: string | null
                    processing_started_at?: string | null
                    processing_expires_at?: string | null
                    verification_version?: number | null
                    verification_snapshot?: Json | null
                    transfer_started_at?: string | null
                    active_transfer_attempt_id?: string | null
                    recovery_required?: boolean
                    recovery_reason?: string | null
                    created_at?: string
                    processed_at?: string | null
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
                    kyc_session_id: string | null
                    withdrawal_id: string | null
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
                    kyc_session_id?: string | null
                    withdrawal_id?: string | null
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
                    kyc_session_id?: string | null
                    withdrawal_id?: string | null
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
                    metadata: Json
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
            seller_verification_blocks: {
                Row: {
                    id: string
                    user_id: string
                    matched_axis: string
                    document_number_hash: string | null
                    bank_account_number: string | null
                    matched_user_ids: string[] | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    matched_axis: string
                    document_number_hash?: string | null
                    bank_account_number?: string | null
                    matched_user_ids?: string[] | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    matched_axis?: string
                    document_number_hash?: string | null
                    bank_account_number?: string | null
                    matched_user_ids?: string[] | null
                    created_at?: string
                }
            }
            seller_verifications: {
                Row: {
                    id: string
                    user_id: string
                    full_name: string
                    id_card_front_url: string | null
                    id_card_back_url: string | null
                    bank_name: string
                    bank_bin: string | null
                    bank_account_number: string
                    bank_account_name: string
                    bank_account_name_verified: string | null
                    bank_verified_at: string | null
                    bank_screenshot_url: string | null
                    phone_number: string | null
                    ai_cccd_name: string | null
                    ai_bank_name: string | null
                    ai_bank_number: string | null
                    ai_confidence: number | null
                    ai_name_match: boolean | null
                    ai_scan_id: string | null
                    phone_verified_at: string | null
                    cccd_id_number: string | null
                    is_duplicate: boolean
                    duplicate_notes: string | null
                    kyc_session_id: string | null
                    kyc_provider: string | null
                    document_number_hash: string | null
                    auto_approved: boolean
                    review_flags: Json | null
                    status: string
                    reviewed_by: string | null
                    reviewed_by_actor: string | null
                    reviewed_at: string | null
                    rejection_reason: string | null
                    created_at: string | null
                    updated_at: string | null
                }
                Insert: {
                    id?: string
                    user_id: string
                    full_name: string
                    id_card_front_url?: string | null
                    id_card_back_url?: string | null
                    bank_name: string
                    bank_bin?: string | null
                    bank_account_number: string
                    bank_account_name: string
                    bank_account_name_verified?: string | null
                    bank_verified_at?: string | null
                    bank_screenshot_url?: string | null
                    phone_number?: string | null
                    ai_cccd_name?: string | null
                    ai_bank_name?: string | null
                    ai_bank_number?: string | null
                    ai_confidence?: number | null
                    ai_name_match?: boolean | null
                    ai_scan_id?: string | null
                    phone_verified_at?: string | null
                    cccd_id_number?: string | null
                    is_duplicate?: boolean
                    duplicate_notes?: string | null
                    kyc_session_id?: string | null
                    kyc_provider?: string | null
                    document_number_hash?: string | null
                    auto_approved?: boolean
                    review_flags?: Json | null
                    status?: string
                    reviewed_by?: string | null
                    reviewed_by_actor?: string | null
                    reviewed_at?: string | null
                    rejection_reason?: string | null
                    created_at?: string | null
                    updated_at?: string | null
                }
                Update: {
                    id?: string
                    user_id?: string
                    full_name?: string
                    id_card_front_url?: string | null
                    id_card_back_url?: string | null
                    bank_name?: string
                    bank_bin?: string | null
                    bank_account_number?: string
                    bank_account_name?: string
                    bank_account_name_verified?: string | null
                    bank_verified_at?: string | null
                    bank_screenshot_url?: string | null
                    phone_number?: string | null
                    ai_cccd_name?: string | null
                    ai_bank_name?: string | null
                    ai_bank_number?: string | null
                    ai_confidence?: number | null
                    ai_name_match?: boolean | null
                    ai_scan_id?: string | null
                    phone_verified_at?: string | null
                    cccd_id_number?: string | null
                    is_duplicate?: boolean
                    duplicate_notes?: string | null
                    kyc_session_id?: string | null
                    kyc_provider?: string | null
                    document_number_hash?: string | null
                    auto_approved?: boolean
                    review_flags?: Json | null
                    status?: string
                    reviewed_by?: string | null
                    reviewed_by_actor?: string | null
                    reviewed_at?: string | null
                    rejection_reason?: string | null
                    created_at?: string | null
                    updated_at?: string | null
                }
            }
            kyc_sessions: {
                Row: {
                    id: string
                    user_id: string
                    provider: string
                    provider_session_id: string
                    session_url: string | null
                    locale: string
                    identity_email_sending_at: string | null
                    identity_email_sent_at: string | null
                    workflow_id: string | null
                    status: string
                    verified_full_name: string | null
                    verified_dob: string | null
                    verified_document_type: string | null
                    verified_issuing_state: string | null
                    document_number_hash: string | null
                    liveness_score: number | null
                    face_match_score: number | null
                    nfc_verified: boolean
                    warnings: Json | null
                    decision: Json | null
                    consumed_at: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    provider?: string
                    provider_session_id: string
                    session_url?: string | null
                    locale?: string
                    identity_email_sending_at?: string | null
                    identity_email_sent_at?: string | null
                    workflow_id?: string | null
                    status?: string
                    verified_full_name?: string | null
                    verified_dob?: string | null
                    verified_document_type?: string | null
                    verified_issuing_state?: string | null
                    document_number_hash?: string | null
                    liveness_score?: number | null
                    face_match_score?: number | null
                    nfc_verified?: boolean
                    warnings?: Json | null
                    decision?: Json | null
                    consumed_at?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    provider?: string
                    provider_session_id?: string
                    session_url?: string | null
                    locale?: string
                    identity_email_sending_at?: string | null
                    identity_email_sent_at?: string | null
                    workflow_id?: string | null
                    status?: string
                    verified_full_name?: string | null
                    verified_dob?: string | null
                    verified_document_type?: string | null
                    verified_issuing_state?: string | null
                    document_number_hash?: string | null
                    liveness_score?: number | null
                    face_match_score?: number | null
                    nfc_verified?: boolean
                    warnings?: Json | null
                    decision?: Json | null
                    consumed_at?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            bank_account_lookups: {
                Row: {
                    id: string
                    user_id: string
                    bin: string
                    account_number: string
                    status: string
                    account_name: string | null
                    provider_code: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    bin: string
                    account_number: string
                    status: string
                    account_name?: string | null
                    provider_code?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    bin?: string
                    account_number?: string
                    status?: string
                    account_name?: string | null
                    provider_code?: string | null
                    created_at?: string
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
            user_collections: {
                Row: {
                    id: string
                    user_id: string
                    title: string
                    image_url: string | null
                    market_price: number
                    low_price: number | null
                    high_price: number | null
                    category: string
                    rarity: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    title: string
                    image_url?: string | null
                    market_price: number
                    low_price?: number | null
                    high_price?: number | null
                    category: string
                    rarity?: string | null
                    created_at?: string
                }
                Update: Partial<Database['public']['Tables']['user_collections']['Insert']>
                Relationships: []
            }
            device_scan_usage: {
                Row: {
                    device_id: string
                    scan_count: number
                    last_reset_date: string
                    updated_at: string
                }
                Insert: {
                    device_id: string
                    scan_count?: number
                    last_reset_date: string
                    updated_at?: string
                }
                Update: Partial<Database['public']['Tables']['device_scan_usage']['Insert']>
                Relationships: []
            }
            tcgcsv_products: {
                Row: {
                    id: number
                    category_id: number
                    set_name: string | null
                }
                Insert: {
                    id?: number
                    category_id: number
                    set_name?: string | null
                }
                Update: {
                    id?: number
                    category_id?: number
                    set_name?: string | null
                }
                Relationships: []
            }
        }
        Views: {
            pokemon_sets_en: { Row: { set_name: string | null } }
            pokemon_sets_jp: { Row: { set_name: string | null } }
        }
        Functions: {
            claim_kyc_identity_email: {
                Args: { p_session_id: string }
                Returns: { user_id: string; verified_full_name: string | null; locale: string }[]
            }
            finalize_seller_verification: {
                Args: { p_user_id: string; p_session_id: string; p_verification: Json; p_auto_approved: boolean }
                Returns: Json
            }
            request_wallet_withdrawal: {
                Args: { p_amount: number; p_request_idempotency_key: string }
                Returns: Json
            }
            assert_wallet_fund_integrity: {
                Args: { p_user_id: string }
                Returns: Json
            }
            get_my_wallet_fund_statement: {
                Args: Record<PropertyKey, never>
                Returns: Json
            }
            get_wallet_withdrawal_statement: { Args: { p_withdrawal_id: string }; Returns: Json }
            perform_withdrawal_action: {
                Args: { p_withdrawal_id: string; p_action: string; p_idempotency_key: string; p_actor_id: string; p_actor_role: string; p_payload?: Json }
                Returns: Json
            }
            recover_expired_withdrawal_claims: { Args: Record<PropertyKey, never>; Returns: number }
            flag_stale_withdrawal_transfers: { Args: Record<PropertyKey, never>; Returns: number }
            create_server_payment_order: {
                Args: { p_user_id: string; p_order_code: number; p_package_type: string; p_amount: number; p_currency: string; p_idempotency_key: string }
                Returns: PaymentOrderRow
            }
            attach_payos_payment_link: {
                Args: { p_user_id: string; p_order_code: number; p_payment_link_id: string; p_checkout_url: string }
                Returns: Json
            }
            claim_payos_payment_link_creation: { Args: { p_user_id: string; p_order_code: number }; Returns: Json }
            attach_claimed_payos_payment_link: {
                Args: { p_user_id: string; p_order_code: number; p_claim_id: string; p_payment_link_id: string; p_checkout_url: string }
                Returns: Json
            }
            stage_payos_marketplace_checkout: {
                Args: { p_user_id: string; p_order_code: number; p_orders: Json; p_idempotency_key: string; p_reserved_until: string }
                Returns: Json
            }
            get_marketplace_checkout_replay: {
                Args: { p_user_id: string; p_idempotency_key: string; p_request_hash: string }
                Returns: Json
            }
            create_verified_wallet_marketplace_orders: {
                Args: { p_user_id: string; p_orders: Json; p_idempotency_key: string; p_description: string }
                Returns: Json
            }
            record_payos_webhook: {
                Args: { p_provider_event_key: string; p_order_code: number; p_event_code: string; p_amount: number; p_currency: string; p_signature_verified: boolean; p_payload_sanitized: Json; p_provider_occurred_at?: string | null }
                Returns: Json
            }
            claim_payos_webhook_post_processing: { Args: { p_event_id: string }; Returns: Json }
            finish_payos_webhook_post_processing: { Args: { p_event_id: string; p_claim_id: string; p_success: boolean; p_error?: string | null }; Returns: Json }
            fulfill_subscription_payment: { Args: { p_payment_order_id: string }; Returns: Json }
            grant_admin_subscription_package: { Args: { p_user_id: string; p_package_type: string; p_actor_id: string; p_actor_role: string; p_idempotency_key: string }; Returns: Json }
            perform_offer_action: { Args: { p_offer_id: string; p_action: string; p_idempotency_key: string }; Returns: Json }
            consume_scan_credit: { Args: { p_user_id: string; p_subscription_id: string; p_idempotency_key: string }; Returns: Json }
            drain_deferred_payos_webhooks: { Args: { p_limit?: number }; Returns: Json }
            credit_wallet: { Args: { p_user_id: string; p_amount: number; p_type: string; p_description: string; p_reference_id: string }; Returns: number }
            resolve_marketplace_dispute: { Args: { p_order_id: string; p_action: string; p_actor_id: string; p_actor_role: string; p_idempotency_key: string }; Returns: Json }
            complete_verified_marketplace_order: { Args: { p_order_id: string; p_buyer_id: string }; Returns: Json }
            perform_marketplace_order_action: { Args: { p_order_id: string; p_action: string; p_actor_id: string; p_idempotency_key: string; p_payload?: Json }; Returns: Json }
            apply_shipping_webhook_event: { Args: { p_ghn_order_code: string; p_status: string }; Returns: Json }
            expire_verified_marketplace_order: { Args: { p_order_id: string; p_reason: string }; Returns: Json }
            set_financial_maintenance: { Args: { p_active: boolean; p_actor: string; p_reason: string; p_cutoff_at?: string | null }; Returns: Json }
            get_financial_cutover_inventory: { Args: Record<PropertyKey, never>; Returns: Json }
            reconcile_legacy_wallet_fund: { Args: { p_user_id: string; p_amount: number; p_evidence_type: string; p_evidence_reference: string; p_reason: string; p_idempotency_key: string; p_actor: string; p_evidence?: Json }; Returns: Json }
            replay_legacy_wallet_history: { Args: { p_user_id: string; p_events: Json; p_batch_id: string; p_actor: string }; Returns: Json }
            classify_open_financial_records: { Args: { p_cutoff_at: string }; Returns: Json }
            check_and_record_admin_login_attempt: { Args: { p_ip_hash: string; p_account_hash: string; p_credentials_valid: boolean }; Returns: Json }
            delete_forum_comment: {
                Args: { comment_id_param: string }
                Returns: undefined
            }
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
