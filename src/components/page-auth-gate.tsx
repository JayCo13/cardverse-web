'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/supabase';
import { requiresPageAuth } from '@/lib/auth-return';
import { useAuthModal } from '@/components/auth-modal';
import { useLocalization } from '@/context/localization-context';
import { Button } from '@/components/ui/button';

export function PageAuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, isLoading } = useAuth();
  const { setOpen } = useAuthModal();
  const { t } = useLocalization();
  const prompted = useRef<string | null>(null);
  const required = requiresPageAuth(pathname);

  useEffect(() => {
    if (user || !required || prompted.current !== pathname) {
      prompted.current = null;
    }
    if (required && !isLoading && !user && prompted.current !== pathname) {
      prompted.current = pathname;
      setOpen(true);
    }
  }, [pathname, required, isLoading, user, setOpen]);

  if (!required) return children;
  if (isLoading) return <div className="min-h-[40vh] animate-pulse bg-muted/20" aria-busy="true" />;
  if (user) return children;
  return (
    <main className="container mx-auto flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">{t('auth_modal_title')}</h1>
      <p className="text-muted-foreground">{t('auth_modal_description')}</p>
      <Button onClick={() => setOpen(true)}>{t('auth_login_button')}</Button>
    </main>
  );
}
