-- Read-only. Reports which parts of 20260908000100_account_restrictions.sql
-- actually landed, after the migration was applied chunk-by-chunk in the SQL
-- editor and the financial-guard block failed. Run in the Supabase SQL editor.
with objects as (
  select 'table' kind, c.relname name,
         case when c.oid is null then 'MISSING' else 'ok' end status
  from (values ('account_restrictions'),('account_restriction_events'),
               ('account_review_holds'),('account_review_decisions')) v(n)
  left join pg_class c on c.relname = v.n
    and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  union all
  select 'function', v.n,
         case when p.oid is null then 'MISSING' else 'ok' end
  from (values ('account_is_active'),('lock_account_operations'),('assert_active_account'),
               ('assert_account_session'),('set_account_restriction'),('immutable_account_audit'),
               ('guard_account_write'),('lock_account_statement'),('guard_restricted_trade'),
               ('hold_restricted_payment'),('guard_restricted_withdrawal'),('account_request_guard'),
               ('resolve_account_order_hold'),('resolve_account_withdrawal_hold'),
               ('suppress_held_order_preparation')) v(n)
  left join pg_proc p on p.proname = v.n and p.pronamespace = 'public'::regnamespace
  union all
  select 'policy', v.n,
         coalesce((select 'on ' || count(*) || ' table(s)' from pg_policies
                   where policyname = v.n), 'MISSING')
  from (values ('account_active_only'),('account_active_storage'),
               ('active_listing_seller'),('restriction_self_read')) v(n)
  union all
  select 'trigger', v.n,
         coalesce((select 'on ' || count(*) || ' table(s)' from pg_trigger
                   where tgname = v.n and not tgisinternal), 'MISSING')
  from (values ('account_write_guard'),('account_statement_lock'),('restricted_order_guard'),
               ('restricted_offer_guard'),('restricted_payment_hold'),('restricted_withdrawal_guard'),
               ('suppress_held_order_preparation'),('immutable_account_events'),
               ('immutable_account_decisions')) v(n)
  union all
  -- The blanket rewrite at migration line 246: every SECURITY DEFINER plpgsql
  -- function in public was re-created with the session guard injected.
  select 'rewrite', 'functions carrying assert_account_session',
         (select count(*)::text from pg_proc p join pg_language l on l.oid = p.prolang
          where p.pronamespace = 'public'::regnamespace and l.lanname = 'plpgsql'
            and p.prosrc like '%assert_account_session%')
  union all
  -- The block that failed (migration line 369). Expect 5 when it has run.
  select 'rewrite', 'financial fns carrying assert_active_account(p_user_id)',
         (select count(*)::text from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in ('spend_verified_wallet','create_server_payment_order',
                            'stage_payos_marketplace_checkout',
                            'create_verified_wallet_marketplace_orders',
                            'claim_payos_payment_link_creation')
            and prosrc like '%assert_active_account(p_user_id)%')
  union all
  select 'rewrite', 'apply_payos_webhook_event sets verified_payment',
         (select count(*)::text from pg_proc where proname = 'apply_payos_webhook_event'
            and pronamespace = 'public'::regnamespace
            and prosrc like '%cardverse.verified_payment%')
  union all
  select 'rewrite', 'resolve_marketplace_dispute honours holds',
         (select count(*)::text from pg_proc where proname = 'resolve_marketplace_dispute'
            and pronamespace = 'public'::regnamespace
            and prosrc like '%account_review_holds%')
  union all
  select 'rewrite', 'complete_delivered_orders skips holds',
         (select count(*)::text from pg_proc where proname = 'complete_delivered_orders'
            and pronamespace = 'public'::regnamespace
            and prosrc like '%account_review_holds%')
  union all
  select 'setting', 'pgrst.db_pre_request on authenticator',
         coalesce((select c from pg_db_role_setting s join pg_roles r on r.oid = s.setrole,
                   unnest(s.setconfig) c
                   where r.rolname = 'authenticator' and c like 'pgrst.db_pre_request=%'), 'NOT SET')
  union all
  select 'realtime', 'account_restrictions in supabase_realtime',
         coalesce((select 'yes' from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'account_restrictions'), 'no')
  union all
  select 'data', 'rows in account_restrictions',
         (select count(*)::text from public.account_restrictions)
)
select kind, name, status from objects order by kind, name;
