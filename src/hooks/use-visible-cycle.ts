'use client';

import { useEffect, useRef } from 'react';

export function useVisibleCycle<T extends HTMLElement>(callback: () => void, delay: number, enabled = true) {
  const ref = useRef<T>(null);
  const callbackRef = useRef(callback);
  useEffect(() => { callbackRef.current = callback; }, [callback]);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    let visible = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      clearInterval(timer);
      if (visible && !motion.matches && document.visibilityState === 'visible') {
        timer = setInterval(() => callbackRef.current(), delay);
      }
    };
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); });
    observer.observe(element);
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync);
    return () => {
      clearInterval(timer); observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      motion.removeEventListener('change', sync);
    };
  }, [delay, enabled]);
  return ref;
}
