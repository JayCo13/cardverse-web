'use client';

import Link from 'next/link';
import { ArrowRight } from '@phosphor-icons/react';
import { useAuth } from '@/lib/supabase';
import { useLocalization } from '@/context/localization-context';
import type { HomeAnnouncement } from '@/lib/home-announcements';

export function AnnouncementActions({ announcement, hero = false }: { announcement: HomeAnnouncement; hero?: boolean }) {
  const { user, profile } = useAuth();
  const { t } = useLocalization();
  const verified = !!user && profile?.id === user.id && profile.seller_verified;
  return <div className={`flex min-w-0 flex-wrap gap-3 ${hero ? 'flex-col pt-4 sm:flex-row sm:gap-4' : ''}`}>
    {announcement.actions.map((action, index) => <Link key={action.href} href={action.href}
      className={`inline-flex min-h-11 max-w-full items-center justify-center rounded-full border text-center ${hero ? 'px-6 py-5 text-base font-bold sm:px-8 sm:py-6 sm:text-lg motion-safe:transition-all motion-safe:duration-300' : 'px-5 py-2 text-sm font-semibold'} ${hero && index === 0 ? 'shadow-[0_0_15px_rgba(249,115,22,0.5)] hover:shadow-[0_0_25px_rgba(249,115,22,0.7)] motion-safe:hover:scale-105' : ''} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400 ${index === 0 ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-600' : 'border-white/25 bg-white/5 text-white hover:bg-white/10'}`}>
      {t(action.seller && verified ? 'launch_sell' : action.label)}
      {hero && index === 0 && <span className="ml-2 shrink-0 rounded-full bg-white/20 p-1"><ArrowRight className="h-4 w-4" /></span>}
    </Link>)}
  </div>;
}
