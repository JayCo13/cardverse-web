"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, Clock, LifeBuoy, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import { useAuth, useSupabase } from '@/lib/supabase';
import { useLocalization } from '@/context/localization-context';
import { useCurrency, type AppLanguage } from '@/contexts/currency-context';
import type { AccountStatus } from '@/lib/account-restriction';
import { Button } from '@/components/ui/button';

export function AccountRestrictionProvider({ children, allowedContent }: { children: React.ReactNode; allowedContent: React.ReactNode }) {
  const { user, isLoading, signOut } = useAuth();
  const supabase = useSupabase();
  const { locale, t } = useLocalization();
  const { setLanguage } = useCurrency();
  const router = useRouter();
  const path = usePathname();
  const userId = user?.id;
  const generation = useRef(0);
  const [state, setState] = useState<{ userId: string; status?: AccountStatus; error?: boolean } | null>(null);
  const refresh = useCallback(async () => {
    if (!userId) return;
    const requestId = ++generation.current;
    try {
      const response = await fetch('/api/account/status', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('status');
      const status = await response.json() as AccountStatus;
      if (status.user_id !== userId || typeof status.is_banned !== 'boolean') throw new Error('identity');
      if (requestId === generation.current) setState({ userId, status });
    } catch {
      if (requestId === generation.current) setState({ userId, error: true });
    }
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    void refresh();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(visible, 30_000);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    window.addEventListener('online', visible);
    const channel = userId ? supabase.channel(`account-status:${userId}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'account_restrictions', filter: `user_id=eq.${userId}`,
    }, () => void refresh()).subscribe() : null;
    return () => {
      ++generation.current;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
      window.removeEventListener('online', visible);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [refresh, supabase, userId]);
  const current = state?.userId === userId ? state : null;
  const allowed = ['/contact', '/terms', '/privacy'].includes(path);
  useEffect(() => {
    if (current?.status?.is_banned && !allowed && path !== '/account/banned') router.replace('/account/banned');
    if (current?.status && !current.status.is_banned && path === '/account/banned') router.replace('/');
    if (!isLoading && !userId && path === '/account/banned') router.replace('/');
  }, [current, allowed, path, router, isLoading, userId]);
  // AuthReady intentionally lets visitors see public pages during auth startup.
  // No account identity means there is no restriction to check or display.
  if (!userId) return children;
  if (current?.status && !current.status.is_banned) return children;
  const status = current?.status;
  // A pending check is not a ban. Keep the restriction notice exclusive to a
  // confirmed verdict; account features remain unmounted until it arrives.
  if (!status && !current?.error) return <div className="relative flex min-h-screen items-center justify-center bg-black" role="status" aria-label={t('accountStatusLoading')}>
    <div className="flex flex-col items-center gap-4">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-orange-500" />
      <p className="text-sm text-zinc-500">{t('accountStatusLoading')}</p>
    </div>
  </div>;
  const banned = !!status?.is_banned;
  return <div className="relative min-h-screen bg-black text-white">
    {/* One quiet wash behind the card. Decorative, hence aria-hidden. */}
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_100%_at_50%_0%,rgba(249,115,22,0.10),transparent_70%)]" />
    <div className="relative mx-auto flex w-full max-w-xl flex-col gap-6 px-5 py-10 sm:py-16">
      <div className="flex justify-end">
        <select
          aria-label={t('accountLanguage')}
          value={locale}
          onChange={e => setLanguage(e.target.value as AppLanguage)}
          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-zinc-300 outline-none transition-colors hover:border-white/20 focus:border-white/30"
        >
          <option value="vi-VN">Tiếng Việt</option><option value="en-US">English</option><option value="ja-JP">日本語</option>
        </select>
      </div>

      <section aria-live="polite" className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-8">
        <div className="flex items-center gap-3.5">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${banned ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
            {banned ? <ShieldAlert className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          </span>
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] sm:text-[26px]">
            {banned ? t('accountBannedTitle') : current?.error ? t('accountStatusError') : t('accountStatusLoading')}
          </h1>
        </div>

        {banned && <div className="mt-7 space-y-6">
          {/* The reason is admin-authored free text: quoted, and wrapped so a
            * long paragraph can never break the card. */}
          <figure className="border-l-2 border-red-500/50 pl-4">
            <figcaption className="text-[13px] text-zinc-500">{t('accountBanReason')}</figcaption>
            <blockquote className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-zinc-100">{status?.reason}</blockquote>
          </figure>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span>{t('accountBanTime')}:</span>
            <time className="text-zinc-300">{status?.banned_at ? new Date(status.banned_at).toLocaleString(locale) : ''}</time>
          </div>

          <p className="text-[15px] leading-relaxed text-zinc-400">{t('accountBanExplanation')}</p>
        </div>}

        <div className="mt-8 flex flex-col gap-2.5 sm:flex-row">
          <Button asChild className="h-10 gap-2 rounded-lg bg-orange-500 px-4 text-sm font-medium text-black hover:bg-orange-400">
            <Link href="/contact"><LifeBuoy className="h-4 w-4" />{t('accountContact')}</Link>
          </Button>
          <Button
            variant="outline"
            onClick={refresh}
            className="h-10 gap-2 rounded-lg border-white/10 bg-transparent px-4 text-sm font-medium text-zinc-300 hover:bg-white/5 hover:text-white"
          >
            <RefreshCw className="h-4 w-4" />{t('accountCheckAgain')}
          </Button>
          <Button
            variant="outline"
            onClick={signOut}
            className="h-10 gap-2 rounded-lg border-transparent bg-transparent px-4 text-sm font-medium text-zinc-500 hover:bg-white/5 hover:text-zinc-200 sm:ml-auto"
          >
            <LogOut className="h-4 w-4" />{t('accountSignOut')}
          </Button>
        </div>

        <nav className="mt-7 flex gap-5 border-t border-white/[0.06] pt-5 text-sm text-zinc-500">
          <Link href="/terms" className="transition-colors hover:text-zinc-200">{t('accountTerms')}</Link>
          <Link href="/privacy" className="transition-colors hover:text-zinc-200">{t('accountPrivacy')}</Link>
        </nav>
      </section>

    </div>

    {/* Terms, privacy and contact stay readable while restricted. These pages
      * bring their own page-width layout, so they are rendered outside the
      * notice's narrow measure — nesting them inside it squeezed the contact
      * form into a single cramped column. */}
    {allowed && <div className="relative border-t border-white/[0.06]">{allowedContent}</div>}
  </div>;
}
