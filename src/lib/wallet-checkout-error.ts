type WalletCheckoutError = {
  code: string;
  message: string;
  status: number;
};

/**
 * Convert known database failures into stable, user-safe API errors. Never
 * label an arbitrary RPC failure as insufficient balance: doing so hides
 * inventory, bundle, maintenance, and schema faults from both users and logs.
 */
export function walletCheckoutError(error: unknown): WalletCheckoutError {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : '';

  if (message.includes('insufficient_verified_balance')) {
    return {
      code: 'insufficient_verified_balance',
      message: 'Verified balance is insufficient.',
      status: 409,
    };
  }
  if (message.includes('financial_maintenance_active')) {
    return {
      code: 'financial_maintenance_active',
      message: 'The wallet is temporarily unavailable during reconciliation.',
      status: 503,
    };
  }
  if (message.includes('idempotency_conflict')) {
    return {
      code: 'idempotency_conflict',
      message: 'Idempotency key conflicts with another checkout.',
      status: 409,
    };
  }
  if (
    message.includes('bundle_selection')
    || message.includes('bundle_snapshot')
    || message.includes('bundle_price')
  ) {
    return {
      code: 'bundle_item_unavailable',
      message: 'Some selected bundle cards are no longer available.',
      status: 409,
    };
  }
  if (
    message.includes('card_unavailable')
    || message.includes('card_already_ordered')
  ) {
    return {
      code: 'card_unavailable',
      message: 'This card is no longer available.',
      status: 409,
    };
  }

  // A settlement function refusing the address is the caller's problem, not a
  // server fault. Without this branch it fell through to the 500 below, which
  // is how a district requirement left behind in two Postgres functions read as
  // "Unable to complete checkout" instead of "your address is incomplete".
  if (message.includes('_marketplace_shipping_invalid')) {
    return {
      code: 'shipping_address_invalid',
      message: 'The delivery address is incomplete.',
      status: 400,
    };
  }

  return {
    code: 'checkout_failed',
    message: 'Unable to complete checkout.',
    status: 500,
  };
}
