import type { TranslationKey } from '@/lib/i18n';

type Translate = (key: TranslationKey, variables?: Record<string, string>) => string;

const FINANCIAL_ERROR_KEYS: Record<string, TranslationKey> = {
  payment_link_recovery_required: 'financial_payment_link_recovery_required',
  card_unavailable: 'financial_card_unavailable',
  bundle_cart_checkout_unsupported: 'financial_bundle_cart_unsupported',
  bundle_offer_checkout_unsupported: 'financial_bundle_offer_unsupported',
  self_purchase_forbidden: 'financial_self_purchase_forbidden',
  offer_forbidden: 'financial_offer_forbidden',
  offer_not_ready: 'financial_offer_not_ready',
  order_exists: 'financial_order_exists',
  idempotency_conflict: 'financial_idempotency_conflict',
  checkout_replay_failed: 'financial_checkout_failed',
  checkout_failed: 'financial_checkout_failed',
  insufficient_verified_balance: 'financial_insufficient_verified_balance',
  amount_too_low: 'financial_amount_too_low',
  not_a_seller: 'financial_not_a_seller',
  missing_bank: 'financial_missing_bank',
  insufficient_balance: 'financial_insufficient_balance',
  kyc_or_bank_not_verified: 'financial_kyc_or_bank_not_verified',
  idempotency_key_required: 'financial_idempotency_key_required',
  financial_maintenance_active: 'financial_maintenance_active',
  wallet_not_found: 'financial_wallet_not_found',
  withdrawal_failed: 'financial_withdrawal_failed',
  payos_link_missing: 'financial_payos_link_missing',
  card_not_found: 'financial_card_not_found',
  no_bundle_selection: 'financial_bundle_selection_required',
  bundle_item_unavailable: 'financial_bundle_item_unavailable',
  invalid_carrier: 'financial_invalid_carrier',
  invalid_shipping_carrier: 'financial_invalid_carrier',
  seller_shipping_origin_missing: 'financial_shipping_origin_missing',
  shipping_address_invalid: 'financial_shipping_address_invalid',
  shipping_quote_failed: 'financial_shipping_quote_failed',
  shipping_fee_not_configured: 'financial_shipping_fee_not_configured',
  seller_shipping_configuration_missing: 'financial_shipping_fee_not_configured',
  missing_tracking: 'financial_missing_tracking',
  cancel_requires_provider_confirmation: 'financial_cancel_requires_provider_confirmation',
  transaction_not_found: 'financial_transaction_not_found',
  transaction_forbidden: 'financial_transaction_forbidden',
  transaction_inactive: 'financial_transaction_inactive',
  invalid_deposit_amount: 'financial_invalid_deposit_amount',
  payment_rate_limited: 'financial_rate_limited',
  deposit_failed: 'financial_deposit_failed',
};

export function localizeFinancialApiError(
  t: Translate,
  code: unknown,
  fallback: string,
  variables?: Record<string, string>,
) {
  const key = typeof code === 'string' ? FINANCIAL_ERROR_KEYS[code] : undefined;
  return key ? t(key, variables) : fallback;
}
