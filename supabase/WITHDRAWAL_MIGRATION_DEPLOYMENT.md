# Withdrawal Migration Deployment

The withdrawal and verified-fund migration is split into seven ordered phases.
Do not apply these files directly to production before they pass on a staging
Supabase project restored from a recent production backup.

## Ordered migrations

1. `20260808000100_financial_foundation.sql`
   - Additive financial tables, transfer-attempt schema and audit tables.
   - Database maintenance gate, explicit RLS/grants and integrity helpers.
2. `20260808000200_payos_and_payment_fulfillment.sql`
   - Server-owned payment orders, PayOS webhook inbox and deferred processing.
   - Payment fulfillment, subscription and scan-credit idempotency.
3. `20260808000300_verified_marketplace_money_paths.sql`
   - FIFO verified-wallet spending, refunds and marketplace funding.
   - Atomic checkout, order actions, disputes and shipping state changes.
4. `20260808000400_withdrawal_transfer_lifecycle.sql`
   - Idempotent withdrawal requests and verified-fund reservations.
   - Admin verification, immutable transfer attempts, completion and recovery.
5. `20260808000500_legacy_reconciliation_and_validation.sql`
   - User/admin statements, maintenance controls and cutover inventory.
   - Legacy replay, open-record classification and deferred integrity triggers.
6. `20260808000600_fix_pgcrypto_schema_resolution.sql`
   - Resolve the installed `pgcrypto` schema for the PayOS checkout hash.
   - Keep the security-definer RPC portable between Supabase and local PostgreSQL.
7. `20260808000700_add_subscription_updated_at.sql`
   - Complete the legacy `user_subscriptions` shape used by atomic RPCs.
   - Add the missing update timestamp without changing subscription value.

## Safety rules

- Apply all seven files to staging in the listed order before deploying the new
  web or admin builds there.
- A split migration is easier to inspect, but the seven files are still one
  coordinated feature release. Do not selectively enable only later phases.
- Production requires a backup, stopped admin transfers, database maintenance,
  reconciliation dry-run, approved evidence, deferred-webhook drain and final
  invariant checks.
- The original combined SQL is retained only under
  `supabase/migration-archive/` as a review reference. Supabase must not execute
  that archived file.

## Validation

After applying all phases to an isolated database, run:

```bash
psql "$CARDVERSE_TEST_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f supabase/tests/withdrawal_verified_funds.sql
```

The test transaction must reach `ROLLBACK` with no unhandled error.
