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
  card_sold: ['notification_card_sold_title', 'notification_card_sold_message'],
  kyc_identity_approved: ['notification_kyc_identity_approved_title', 'notification_kyc_identity_approved_message'],
  kyc_approved: ['notification_kyc_approved_title', 'notification_kyc_approved_message'],
  kyc_rejected: ['notification_kyc_rejected_title', 'notification_kyc_rejected_message'],
};

export function localizeSystemNotification(notification: Notification, t: Translate) {
  const keys = NOTIFICATION_KEYS[notification.type];
  if (!keys || notification.type === 'message_received') {
    return { title: notification.title, message: notification.message };
  }
  return { title: t(keys[0]), message: t(keys[1]) };
}
