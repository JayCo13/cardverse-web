'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { safeAuthReturnTo } from '@/lib/auth-return';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLocalization } from '@/context/localization-context';

interface AuthModalContextType {
  isOpen: boolean;
  returnTo: string;
  callbackError: boolean;
  hasOpened: boolean;
  setOpen: (open: boolean) => void;
  openModal: (tab?: 'login' | 'signup') => void;
  activeTab: 'login' | 'signup';
  setActiveTab: (tab: 'login' | 'signup') => void;
}

const AuthModalContext = createContext<AuthModalContextType>({
  isOpen: false,
  returnTo: '/',
  callbackError: false,
  hasOpened: false,
  setOpen: () => {},
  openModal: () => {},
  activeTab: 'login',
  setActiveTab: () => {},
});

export function useAuthModal() {
  return useContext(AuthModalContext);
}

function AuthModalLoading() {
  const { isOpen, setOpen } = useAuthModal();
  const { t } = useLocalization();
  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent className="w-[95vw] max-w-[425px] rounded-xl">
        <DialogHeader>
          <DialogTitle>{t('auth_modal_title')}</DialogTitle>
          <DialogDescription>{t('auth_modal_description')}</DialogDescription>
        </DialogHeader>
        <div className="h-48 animate-pulse rounded-lg bg-muted" aria-busy="true" />
      </DialogContent>
    </Dialog>
  );
}

const LazyAuthModal = dynamic(
  () => import('@/components/auth-modal-content').then((module) => module.AuthModalContent),
  { ssr: false, loading: AuthModalLoading },
);

export function AuthModalProvider({ children }: { children: React.ReactNode }) {
  const [returnTo, setReturnTo] = useState('/');
  const [callbackError, setCallbackError] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [activeTab, setActiveTab] = useState<'login' | 'signup'>('login');
  const setOpen = useCallback((open: boolean) => {
    if (open) {
      setHasOpened(true);
      setReturnTo(safeAuthReturnTo(window.location.pathname + window.location.search + window.location.hash));
    } else {
      setCallbackError(false);
    }
    setIsOpen(open);
  }, []);
  const openModal = useCallback((tab: 'login' | 'signup' = 'login') => {
    setActiveTab(tab);
    setOpen(true);
  }, [setOpen]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('auth_error') !== 'callback') return;
    url.searchParams.delete('auth_error');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    setOpen(true);
    setCallbackError(true);
  }, [setOpen]);
  const value = useMemo(() => ({ isOpen, hasOpened, setOpen, openModal, activeTab, setActiveTab, returnTo, callbackError }),
    [isOpen, hasOpened, setOpen, openModal, activeTab, returnTo, callbackError]);

  return <AuthModalContext.Provider value={value}>{children}</AuthModalContext.Provider>;
}

export function AuthModal() {
  const { hasOpened } = useAuthModal();
  // Keep the form mounted after first use to preserve its existing lifecycle.
  return hasOpened ? <LazyAuthModal /> : null;
}
