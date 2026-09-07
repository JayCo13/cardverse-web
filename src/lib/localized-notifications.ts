import type { TranslationKey } from '@/lib/i18n';
import type { Notification } from '@/lib/types';

type Translate = (key: TranslationKey, variables?: Record<string, string>) => string;

const NOTIFICATION_KEYS: Partial<Record<Notification['type'], readonly [TranslationKey, TranslationKey]>> = {
  offer_received: ['notification_offer_received_title', 'notification_offer_received_message'],
  offer_accepted: ['notification_offer_accepted_title', 'notification_offer_accepted_message'],
  offer_rejected: ['notification_offer_rejected_title', 'notification_offer_rejected_message'],
  order_new: ['notification_order_new_title', 'notification_order_new_message'],
  order_shipped: ['notification_order_shipped_title', 'notification_order_shipped_message'],
  order_completed: ['notification_order_completed_title', 'notification_order_completed_message'],
  order_refunded: ['notification_order_refunded_title', 'notification_order_refunded_message'],
  order_cancelled: ['notification_order_cancelled_title', 'notification_order_cancelled_message'],
  order_disputed: ['notification_order_disputed_title', 'notification_order_disputed_message'],
  shipping_update: ['notification_shipping_update_title', 'notification_shipping_update_message'],
  dispute_resolved: ['notification_dispute_resolved_title', 'notification_dispute_resolved_message'],
  withdrawal_completed: ['notification_withdrawal_completed_title', 'notification_withdrawal_completed_message'],
  withdrawal_rejected: ['notification_withdrawal_rejected_title', 'notification_withdrawal_rejected_message'],
  card_sold: ['notification_card_sold_title', 'notification_card_sold_message'],
  kyc_identity_approved: ['notification_kyc_identity_approved_title', 'notification_kyc_identity_approved_message'],
  kyc_approved: ['notification_kyc_approved_title', 'notification_kyc_approved_message'],
  kyc_rejected: ['notification_kyc_rejected_title', 'notification_kyc_rejected_message'],
};

export function localizeSystemNotification(notification: Notification, t: Translate) {
  const keys = NOTIFICATION_KEYS[notification.type];
  const metadata = notification.metadata ?? {};
  let title = keys ? t(keys[0]) : notification.title;
  let message = keys ? t(keys[1]) : notification.message;
  const extraKeys: Partial<Record<Notification['type'], TranslationKey>> = {
    offer_expired: 'notification_context_expired',
    offer_payment_expired: 'notification_context_expired',
    offer_card_taken: 'notification_context_taken',
    unboxing_video_submitted: 'notification_context_video',
  };
  const extra = extraKeys[notification.type];
  if (extra) { title = t(extra); message = ''; }
  if (notification.type === 'message_received') title = t('notification_context_message');
  const eventKeys: Record<string, TranslationKey> = {
    wallet_refund: 'notification_context_refund',
    wallet_payout: 'notification_context_payout',
    resolved_refund: 'notification_context_resolved_refund',
    resolved_release: 'notification_context_resolved_release',
    completed_auto: 'notification_context_auto',
    completed_confirmed: 'notification_context_confirmed',
  };
  if (metadata.event && eventKeys[metadata.event]) message = t(eventKeys[metadata.event]);
  if (notification.type === 'shipping_update' && metadata.event === 'delivered') {
    title = t('notification_context_delivered');
    message = t(metadata.recipient_role === 'seller'
      ? 'notification_context_delivered_seller' : 'notification_context_delivered_buyer');
  }
  // Keep each fact independent. A single "order · person · card" sentence
  // makes unrelated values read like generated prose, especially when names
  // wrap on a narrow notification panel.
  const contextLines = [
    notification.orderId ? `#${notification.orderId.slice(0, 8).toUpperCase()}` : undefined,
    metadata.counterparty_name ? `${t(metadata.recipient_role === 'seller'
      ? 'notification_context_buyer' : 'notification_context_seller')}: ${metadata.counterparty_name}` : undefined,
    metadata.card_name ? `${t('notification_context_card')}: ${metadata.card_name}` : undefined,
  ].filter((line): line is string => Boolean(line));
  if (metadata.tracking_number) message += ` ${t('notification_context_tracking')}: ${metadata.tracking_number}`;
  if (metadata.reason) message += ` ${metadata.reason}`;
  if (typeof metadata.amount === 'number' && Number.isFinite(metadata.amount) && metadata.amount > 0) {
    message += ` ${new Intl.NumberFormat('vi-VN').format(metadata.amount)} ₫`;
  }
  // `context` remains useful for the browser notification body. The in-app
  // bell renders `contextLines` as distinct, scannable details.
  return { title, message, context: contextLines.join('\n'), contextLines };
}
