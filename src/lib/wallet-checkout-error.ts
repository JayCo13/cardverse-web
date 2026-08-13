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

  return {
    code: 'checkout_failed',
    message: 'Unable to complete checkout.',
    status: 500,
  };
}
