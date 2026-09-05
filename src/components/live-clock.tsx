'use client';

import { useEffect, useState, type ReactNode } from 'react';

/** Keep second-by-second updates below the page and pause in background tabs. */
export function LiveClock({ children, until }: { children: (now: number) => ReactNode; until?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { clearInterval(timer); timer = undefined; };
    const tick = () => {
      const value = Date.now();
      setNow(value);
      if (until != null && value >= until) stop();
    };
    const sync = () => {
      stop();
      if (document.visibilityState !== 'visible') return;
      tick();
      if (until == null || Date.now() < until) timer = setInterval(tick, 1000);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => { stop(); document.removeEventListener('visibilitychange', sync); };
  }, [until]);
  return children(now);
}
