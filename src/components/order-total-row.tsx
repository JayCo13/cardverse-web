'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/** Starting size, and the smallest the amount is allowed to get, in px. */
const MAX_PX = 18;
const MIN_PX = 12;

interface OrderTotalRowProps {
  label: string;
  amount: string;
  className?: string;
}

/**
 * The order total, on one line with its label like every other row of the
 * summary card.
 *
 * A total in dong runs long — "10.878.000 đ" already, and a bundle pushes it
 * past a billion — so instead of wrapping onto its own line or scrolling
 * sideways, the amount is measured against the space the row actually leaves it
 * and stepped down until it fits.
 */
export function OrderTotalRow({ label, amount, className }: OrderTotalRowProps) {
  const valueRef = useRef<HTMLSpanElement>(null);

  const fit = useCallback(() => {
    const el = valueRef.current;
    if (!el) return;
    // clientWidth is the width flex allotted this span; it does not move with
    // the font size, so stepping down always converges.
    let px = MAX_PX;
    el.style.fontSize = `${px}px`;
    while (px > MIN_PX && el.scrollWidth > el.clientWidth) {
      px -= 1;
      el.style.fontSize = `${px}px`;
    }
  }, []);

  useLayoutEffect(() => {
    fit();
    const row = valueRef.current?.parentElement;
    if (!row || typeof ResizeObserver === 'undefined') return;
    // Refit when the card is resized — rotating the phone, or the sidebar
    // switching between the mobile and desktop layouts.
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    return () => observer.disconnect();
  }, [fit, amount]);

  return (
    <div className={cn('flex items-baseline justify-between gap-3', className)}>
      <span className="shrink-0 text-base font-semibold">{label}</span>
      <span
        ref={valueRef}
        title={amount}
        style={{ fontSize: `${MAX_PX}px` }}
        className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-right font-bold tabular-nums text-orange-400"
      >
        {amount}
      </span>
    </div>
  );
}
