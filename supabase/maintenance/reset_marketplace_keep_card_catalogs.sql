  -- CardVerse full marketplace reset.
  --
  -- Run manually in the Supabase SQL Editor for the intended project.
  -- This removes every listing/buy/sell/order/chat/wallet/withdrawal row for all
  -- users. It also resets seller KYC and seller shipping setup, while preserving
  -- auth users, buyer receiving addresses, scan entitlements/history, and the
  -- Pokemon/One Piece/Soccer source catalogs.
  --
  -- Important: do not add CASCADE. If a new foreign-key dependency was added
  -- after this script was written, PostgreSQL must abort the transaction instead
  -- of silently truncating an out-of-scope table.

  begin;

  set local lock_timeout = '15s';
  set local statement_timeout = '5min';
  select set_config('cardverse.maintenance_bypass', 'on', true);

  -- Scan purchases are retained. Marketplace checkouts and wallet deposits are
  -- removed after their dependent rows have been cleared.

  -- Listing, checkout, orders, chat, notifications, reputation, wallets and
  -- withdrawals. Listing all FK-related tables in the same TRUNCATE handles the
  -- conversations/messages and withdrawals/transfer-attempt cycles atomically.
  truncate table
    public.admin_withdrawal_notifications,
    public.account_review_holds,
    public.seller_verifications,
    public.seller_verification_blocks,
    public.kyc_sessions,
    public.kyc_verification_scans,
    public.bank_account_lookups,
    public.goship_rate_cache,
    public.conversation_notification_preferences,
    public.messages,
    public.conversations,
    public.notifications,
    public.listing_create_requests,
    public.cart_items,
    public.offer_action_requests,
    public.marketplace_dispute_actions,
    public.marketplace_order_action_requests,
    public.marketplace_order_funding,
    public.seller_reviews,
    public.reputation_events,
    public.transactions,
    public.orders,
    public.offers,
    public.cards,
    public.withdrawal_audit_events,
    public.withdrawal_action_requests,
    public.wallet_fund_allocations,
    public.wallet_transactions,
    public.wallet_reconciliation_records,
    public.wallet_fund_sources,
    public.withdrawal_transfer_attempts,
    public.wallet_withdrawals,
    public.wallets
  restart identity;

  delete from public.payment_fulfillments
  where payment_order_id in (
    select id
    from public.payment_orders
    where package_type in ('marketplace_order', 'deposit')
  );

  delete from public.payment_webhook_events
  where order_code in (
    select order_code
    from public.payment_orders
    where package_type in ('marketplace_order', 'deposit')
  );

  delete from public.payment_orders
  where package_type in ('marketplace_order', 'deposit');

  -- Reset seller approval, seller shipping setup and marketplace-derived profile
  -- counters. Identity, tester access and buyer receiving addresses stay put.
  update public.profiles
  set
    seller_verified = false,
    address_province_id = null,
    address_province_name = null,
    address_district_id = null,
    address_district_name = null,
    address_ward_code = null,
    address_ward_name = null,
    address_detail = null,
    goship_pickup = null,
    shipping_carriers = array[]::text[],
    shipping_fees = '{}'::jsonb,
    goship_tier_fees = null,
    goship_tier_fees_at = null,
    carrier_coverage = null,
    parcel_preset = 'card',
    parcel_overrides = '{}'::jsonb,
    legit_rate = 100,
    total_transactions = 0,
    completed_transactions = 0,
    cancelled_transactions = 0,
    daily_cancellations = 0,
    last_cancellation_date = null,
    seller_rating = 0,
    seller_review_count = 0,
    seller_fault_count = 0,
    reputation_score = 0,
    reputation_incidents_90d = 0,
    reputation_incidents_total = 0,
    -- NULL means the account uses the platform default threshold. The database
    -- constraint only permits an explicit override between 2 and 5.
    offer_block_incidents = null;

  commit;

  -- PASS requires every reset table to be 0. PRESERVED rows show the remaining
  -- catalog, account, KYC, shipping and scan counts for a quick manual check.
  with reset_counts as (
    select *
    from (values
      ('cards', (select count(*) from public.cards)),
      ('offers', (select count(*) from public.offers)),
      ('orders', (select count(*) from public.orders)),
      ('transactions', (select count(*) from public.transactions)),
      ('cart_items', (select count(*) from public.cart_items)),
      ('conversations', (select count(*) from public.conversations)),
      ('messages', (select count(*) from public.messages)),
      ('notifications', (select count(*) from public.notifications)),
      ('listing_create_requests', (select count(*) from public.listing_create_requests)),
      ('offer_action_requests', (select count(*) from public.offer_action_requests)),
      ('marketplace_order_funding', (select count(*) from public.marketplace_order_funding)),
      ('marketplace_order_action_requests', (select count(*) from public.marketplace_order_action_requests)),
      ('marketplace_dispute_actions', (select count(*) from public.marketplace_dispute_actions)),
      ('reputation_events', (select count(*) from public.reputation_events)),
      ('seller_verifications', (select count(*) from public.seller_verifications)),
      ('seller_verification_blocks', (select count(*) from public.seller_verification_blocks)),
      ('kyc_sessions', (select count(*) from public.kyc_sessions)),
      ('kyc_verification_scans', (select count(*) from public.kyc_verification_scans)),
      ('bank_account_lookups', (select count(*) from public.bank_account_lookups)),
      ('goship_rate_cache', (select count(*) from public.goship_rate_cache)),
      ('profiles_with_seller_shipping', (
        select count(*)
        from public.profiles
        where goship_pickup is not null
          or address_province_id is not null
          or address_province_name is not null
          or address_district_id is not null
          or address_district_name is not null
          or address_ward_code is not null
          or address_ward_name is not null
          or address_detail is not null
          or coalesce(cardinality(shipping_carriers), 0) > 0
          or coalesce(shipping_fees, '{}'::jsonb) <> '{}'::jsonb
          or goship_tier_fees is not null
          or goship_tier_fees_at is not null
          or carrier_coverage is not null
          or parcel_preset is distinct from 'card'
          or coalesce(parcel_overrides, '{}'::jsonb) <> '{}'::jsonb
      )),
      ('wallets', (select count(*) from public.wallets)),
      ('wallet_transactions', (select count(*) from public.wallet_transactions)),
      ('wallet_withdrawals', (select count(*) from public.wallet_withdrawals)),
      ('marketplace_or_deposit_payments', (
        select count(*)
        from public.payment_orders
        where package_type in ('marketplace_order', 'deposit')
      ))
    ) as t(table_name, row_count)
  ), preserved_after as (
    select *
    from (values
      ('profiles', (select count(*) from public.profiles)),
      ('shipping_addresses', (select count(*) from public.shipping_addresses)),
      ('tcgcsv_groups', (select count(*) from public.tcgcsv_groups)),
      ('tcgcsv_products', (select count(*) from public.tcgcsv_products)),
      ('soccer_sets', (select count(*) from public.soccer_sets)),
      ('soccer_cards', (select count(*) from public.soccer_cards)),
      ('user_scan_history', (select count(*) from public.user_scan_history)),
      ('device_scan_usage', (select count(*) from public.device_scan_usage)),
      ('user_subscriptions', (select count(*) from public.user_subscriptions)),
      ('scan_credit_consumptions', (select count(*) from public.scan_credit_consumptions))
    ) as t(table_name, row_count)
  )
  select
    'reset' as check_type,
    table_name,
    row_count,
    case when row_count = 0 then 'PASS' else 'FAIL' end as result
  from reset_counts
  union all
  select
    'preserved' as check_type,
    a.table_name,
    a.row_count,
    'PRESERVED' as result
  from preserved_after a
  order by check_type, table_name;
