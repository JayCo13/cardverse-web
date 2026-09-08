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
  // A shipping notification's news IS the state the parcel reached, so it
  // belongs in the title. "Cập nhật vận chuyển" is a category, not an event —
  // it tells the reader only that something happened, which is the one thing
  // the notification's presence already told them.
  const shippingTitles: Record<string, TranslationKey> = {
    info_received: 'notification_shipping_info_received',
    picking: 'notification_shipping_picking',
    picked: 'notification_shipping_picked',
    in_transit: 'notification_shipping_in_transit',
    out_for_delivery: 'notification_shipping_out_for_delivery',
    available_for_pickup: 'notification_shipping_available_for_pickup',
    failed: 'notification_shipping_failed',
    exception: 'notification_shipping_exception',
  };
  if (notification.type === 'shipping_update') {
    const shippingTitle = metadata.shipping_status
      ? shippingTitles[metadata.shipping_status] : undefined;
    if (shippingTitle) { title = t(shippingTitle); message = ''; }
    // Delivered keeps its own wording: it is the one shipping state that asks
    // something of the reader, and what it asks differs by side.
    if (metadata.event === 'delivered') {
      title = t('notification_context_delivered');
      message = t(metadata.recipient_role === 'seller'
        ? 'notification_context_delivered_seller' : 'notification_context_delivered_buyer');
    }
  }
  // What a person uses to recognise a notification is the card and the other
  // party, never `#4E7CD474`. Pairing the reference with the name on one line
  // spent twenty characters before the name even began, and in a panel this
  // narrow the name — the only part worth reading — was what got clipped. So
  // the reference is dropped from the in-app lines and kept only for the
  // browser notification below, where width is not contested.
  //
  // The labels stay. On a soccer listing the card name and the person's name
  // are both human names — "Samuel Inacio" beside "Tyler Tai" is unreadable
  // without them.
  const orderRef = notification.orderId ? `#${notification.orderId.slice(0, 8).toUpperCase()}` : '';
  const contextLines = [
    metadata.counterparty_name ? `${t(metadata.recipient_role === 'seller'
      ? 'notification_context_buyer' : 'notification_context_seller')}: ${metadata.counterparty_name}` : '',
    metadata.card_name ? `${t('notification_context_card')}: ${metadata.card_name}` : '',
  ].filter((line): line is string => Boolean(line));
  // Assemble rather than append: a base message is deliberately empty whenever
  // its title already carried the news, and `+=` onto '' left the line opening
  // with a stray space.
  message = [
    message,
    metadata.tracking_number ? `${t('notification_context_tracking')}: ${metadata.tracking_number}` : '',
    metadata.reason ?? '',
    typeof metadata.amount === 'number' && Number.isFinite(metadata.amount) && metadata.amount > 0
      ? `${new Intl.NumberFormat('vi-VN').format(metadata.amount)} ₫` : '',
  ].filter(Boolean).join(' ').trim();
  // `context` remains useful for the browser notification body. The in-app
  // bell renders `contextLines` as distinct, scannable details.
  return { title, message, context: [orderRef, ...contextLines].filter(Boolean).join('\n'), contextLines };
}
