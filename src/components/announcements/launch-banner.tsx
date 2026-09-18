'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';
import { announcementLabel, announcementVisibleOnPath, formatAnnouncementDate, homeAnnouncements, type HomeAnnouncement } from '@/lib/home-announcements';
import { AnnouncementActions } from './announcement-actions';

function Banner({ announcement }: { announcement: HomeAnnouncement }) {
  const { t, locale } = useLocalization();
  // undefined until mount: the server-rendered markup opens at lg and collapses below via CSS,
  // so the resolved state only changes the layout when the visitor collapsed it earlier this session.
  const [expanded, setExpanded] = useState<boolean | undefined>(undefined);
  // A dismissed announcement stays hidden across sessions (localStorage) until its id changes.
  const [dismissed, setDismissed] = useState(false);
  const key = `cardverse:announcement:${announcement.id}`;
  const dismissKey = `${key}:dismissed`;
  // Layout effect so a dismissed banner never paints after hydration.
  useLayoutEffect(() => {
    try { if (localStorage.getItem(dismissKey) === '1') setDismissed(true); } catch { /* No storage: show it. */ }
  }, [dismissKey]);
  useEffect(() => {
    let open = window.matchMedia('(min-width: 1024px)').matches;
    try {
      const saved = sessionStorage.getItem(key);
      if (saved !== null) open = saved === 'open';
      sessionStorage.setItem(key, open ? 'open' : 'closed');
    } catch { /* Storage can be unavailable in private browsing. */ }
    setExpanded(open);
  }, [key, dismissKey]);
  function toggle() {
    const open = !expanded;
    setExpanded(open);
    try { sessionStorage.setItem(key, open ? 'open' : 'closed'); } catch { /* Keep usable without storage. */ }
  }
  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(dismissKey, '1'); } catch { /* Hidden for this page view at least. */ }
  }
  if (dismissed) return null;
  const contentId = `announcement-${announcement.id}`;
  const rows = expanded === undefined ? 'invisible grid-rows-[0fr] lg:visible lg:grid-rows-[1fr]' : expanded ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]';
  return <aside className="relative border-b border-orange-500/25 bg-gradient-to-r from-[#1f1208] via-[#171009] to-[#1f1208] text-white">
    {/* Thin glow line so the strip reads as a highlight rather than another header row. */}
    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-orange-400/70 to-transparent" />
    <div className="container mx-auto px-4">
      <div className="flex min-h-12 items-center gap-1 sm:gap-2">
        <button type="button" onClick={toggle} aria-expanded={expanded ?? false} aria-controls={contentId}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2 text-left focus-visible:outline focus-visible:outline-orange-400">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="shrink-0 text-xl leading-none sm:text-2xl" aria-hidden="true">🎉</span>
            <span className="truncate text-sm font-bold tracking-wide text-orange-300 sm:text-base">{announcementLabel(announcement, t)}</span>
            {announcement.date && <span className="hidden shrink-0 rounded-full border border-orange-400/30 bg-orange-500/15 px-2 py-0.5 text-xs font-semibold text-orange-200 sm:inline">{formatAnnouncementDate(announcement.date, locale)}</span>}
          </span>
          <span className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors sm:text-sm ${expanded ? 'text-orange-200/80 hover:text-orange-200' : 'border border-orange-400/40 bg-orange-500/15 text-orange-200 hover:bg-orange-500/25'}`}>
            {expanded ? t('announcement_collapse') : t('announcement_view')}{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </button>
        <button type="button" onClick={dismiss} aria-label={t('announcement_dismiss')} title={t('announcement_dismiss')}
          className="flex min-h-9 min-w-9 shrink-0 items-center justify-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 text-xs font-semibold text-orange-100/80 transition-colors hover:border-orange-400/40 hover:bg-orange-500/15 hover:text-orange-200 focus-visible:outline focus-visible:outline-orange-400 sm:px-3 sm:text-sm">
          <X size={16} /><span className="hidden sm:inline">{t('announcement_dismiss_short')}</span>
        </button>
      </div>
      <div id={contentId} inert={expanded === false} aria-hidden={expanded === false}
        className={`grid ${expanded === undefined ? '' : 'transition-[grid-template-rows,visibility] duration-200 motion-reduce:transition-none'} ${rows}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-3 pb-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
            <div className="min-w-0"><p className="font-bold text-orange-300">{announcement.title === 'CardVerseHub' ? announcement.title : t(announcement.title)}</p><p className="mt-1 text-sm text-white/80">{t(announcement.description[0])}</p></div>
            <div className="flex shrink-0 flex-col gap-2 lg:items-end">
              <AnnouncementActions announcement={announcement} />
              <button type="button" onClick={dismiss}
                className="self-start text-xs font-medium text-white/60 underline-offset-4 hover:text-orange-200 hover:underline focus-visible:outline focus-visible:outline-orange-400 lg:self-end">
                {t('announcement_dismiss_forever')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>;
}

/** Rendered in the root layout directly under the sticky header, so it scrolls away with
 *  the page and the header keeps the height that `scroll-mt-*` / `sticky top-24` offsets assume. */
export function LaunchBanner() {
  const pathname = usePathname();
  const announcement = homeAnnouncements.filter(item => item.enabled && item.banner).sort((a, b) => a.order - b.order)[0];
  if (!announcement || !announcementVisibleOnPath(pathname)) return null;
  return <Banner key={announcement.id} announcement={announcement} />;
}
