'use client';

import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';

/**
 * Time left on a card's hold, counted from the server's `reserved_until`.
 *
 * The remaining time is derived from that timestamp on every tick rather than
 * decremented from a starting value, so a clock that is wrong, a tab that slept,
 * or a component that remounted all converge on the truth instead of drifting
 * away from it. Nothing here decides anything — the sweep does — so a display
 * that runs a few seconds past zero is harmless; it just says "expiring".
 */
export function ReservationCountdown({
    reservedUntil,
    label,
    expiringLabel,
    className = '',
}: {
    reservedUntil: string | null | undefined;
    label: string;
    expiringLabel: string;
    className?: string;
}) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!reservedUntil) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [reservedUntil]);

    if (!reservedUntil) return null;

    const deadline = new Date(reservedUntil).getTime();
    if (Number.isNaN(deadline)) return null;

    const remaining = deadline - now;

    // Past the deadline the card is not free yet — the sweep runs every two
    // minutes — so promising it back would be a lie either way. Say it is
    // closing instead of showing a negative clock.
    if (remaining <= 0) {
        return (
            <span className={`inline-flex items-center gap-1.5 ${className}`}>
                <Lock className="h-3.5 w-3.5" aria-hidden />
                {expiringLabel}
            </span>
        );
    }

    const totalSeconds = Math.floor(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return (
        <span className={`inline-flex items-center gap-1.5 ${className}`}>
            <Lock className="h-3.5 w-3.5" aria-hidden />
            {label}
            <span className="font-mono tabular-nums">
                {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
            </span>
        </span>
    );
}

export default ReservationCountdown;
