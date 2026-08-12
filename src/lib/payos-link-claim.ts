import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

export class PayOSLinkRecoveryError extends Error {
  readonly code = 'payment_link_recovery_required';
  readonly status = 409;

  constructor() {
    super('Payment exists, but PayOS link creation is unresolved. Do not create another link; contact support.');
  }
}

export async function claimPayOSLinkCreation(
  service: SupabaseClient<Database>,
  userId: string,
  orderCode: number,
) {
  const { data, error } = await service.rpc('claim_payos_payment_link_creation' as never, {
    p_user_id: userId,
    p_order_code: orderCode,
  } as never);
  if (error) throw error;
  const result = data as {
    claimed?: boolean;
    claim_id?: string;
    attached?: boolean;
    checkout_url?: string;
    recovery_required?: boolean;
  } | null;
  if (result?.attached && result.checkout_url) {
    return { claimId: null, checkoutUrl: result.checkout_url };
  }
  if (!result?.claimed || !result.claim_id || result.recovery_required) {
    throw new PayOSLinkRecoveryError();
  }
  return { claimId: result.claim_id, checkoutUrl: null };
}

export async function attachClaimedPayOSLink(
  service: SupabaseClient<Database>,
  input: {
    userId: string;
    orderCode: number;
    claimId: string;
    paymentLinkId: string;
    checkoutUrl: string;
  },
) {
  const { error } = await service.rpc('attach_claimed_payos_payment_link' as never, {
    p_user_id: input.userId,
    p_order_code: input.orderCode,
    p_claim_id: input.claimId,
    p_payment_link_id: input.paymentLinkId,
    p_checkout_url: input.checkoutUrl,
  } as never);
  if (error) throw error;
}
