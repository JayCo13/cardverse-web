'use client';

import { useEffect, useRef } from 'react';
import { Clock } from 'lucide-react';
import { LiveClock } from '@/components/live-clock';

type SellerInspectionCountdownProps = {
  status: string;
  carrierStatus: string | null;
  ghnStatus: string | null;
  autoCompleteAt: string | null;
  locale: string;
  onDeadline: () => void;
};

export function SellerInspectionCountdown({
  status,
  carrierStatus,
  ghnStatus,
  autoCompleteAt,
  locale,
  onDeadline,
}: SellerInspectionCountdownProps) {
  const deadline = autoCompleteAt ? Date.parse(autoCompleteAt) : NaN;
  const visible = (status === 'shipping' || status === 'delivered')
    && (status === 'delivered' || carrierStatus === 'Delivered' || ghnStatus === 'delivered')
    && Number.isFinite(deadline);
  const onDeadlineRef = useRef(onDeadline);

  useEffect(() => {
    onDeadlineRef.current = onDeadline;
  }, [onDeadline]);

  useEffect(() => {
    if (!visible) return;

    let timeout: number | undefined;
    let interval: number | undefined;
    const refresh = () => {
      if (document.visibilityState === 'visible') onDeadlineRef.current();
    };
    const poll = () => {
      refresh();
      // The settlement sweep may run after the exact deadline. Keep reading
      // until the order leaves its delivery status and this effect unmounts.
      interval = window.setInterval(refresh, 60_000);
    };
    const wait = deadline - Date.now();
    if (wait <= 0) poll();
    else timeout = window.setTimeout(poll, wait);

    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() >= deadline) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [deadline, visible]);

  if (!visible) return null;

  const language = locale === 'ja-JP' ? 'ja' : locale === 'en-US' ? 'en' : 'vi';
  const deadlineText = new Date(deadline).toLocaleString(locale);

  return (
    <LiveClock until={deadline}>{now => {
      const remaining = Math.max(0, deadline - now);
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      const countdown = `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
      return (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 sm:text-sm">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {remaining > 0 ? (
              <>
                <p className="font-medium">
                  {language === 'vi' ? 'Còn thời gian kiểm tra:' : language === 'en' ? 'Buyer inspection time left:' : '購入者の確認期限まで:'}{' '}
                  <span className="tabular-nums">{countdown}</span>
                </p>
                <p>{language === 'vi'
                  ? 'Người mua có thể xác nhận nhận hàng hoặc báo cáo vấn đề trước thời hạn này.'
                  : language === 'en'
                    ? 'The buyer can confirm receipt or report an issue before this deadline.'
                    : '購入者は期限までに受取確認または問題の報告ができます。'}</p>
              </>
            ) : (
              <p>{language === 'vi'
                ? 'Đã hết thời gian kiểm tra, đang chờ hệ thống hoàn tất.'
                : language === 'en'
                  ? 'The inspection window has ended. Waiting for the system to complete the order.'
                  : '確認期間が終了しました。システムによる注文の完了を待っています。'}</p>
            )}
            <p className="mt-0.5 text-muted-foreground">
              {language === 'vi' ? 'Hạn kiểm tra:' : language === 'en' ? 'Inspection deadline:' : '確認期限:'} {deadlineText}
            </p>
          </div>
        </div>
      );
    }}</LiveClock>
  );
}
