'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLocalization } from '@/context/localization-context';

interface AuthModalContextType {
  isOpen: boolean;
  hasOpened: boolean;
  setOpen: (open: boolean) => void;
  openModal: (tab?: 'login' | 'signup') => void;
  activeTab: 'login' | 'signup';
  setActiveTab: (tab: 'login' | 'signup') => void;
}

const AuthModalContext = createContext<AuthModalContextType>({
  isOpen: false,
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
  const [isOpen, setIsOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [activeTab, setActiveTab] = useState<'login' | 'signup'>('login');
  const setOpen = useCallback((open: boolean) => {
    if (open) setHasOpened(true);
    setIsOpen(open);
  }, []);
  const openModal = useCallback((tab: 'login' | 'signup' = 'login') => {
    setActiveTab(tab);
    setOpen(true);
  }, [setOpen]);
  const value = useMemo(() => ({ isOpen, hasOpened, setOpen, openModal, activeTab, setActiveTab }),
    [isOpen, hasOpened, setOpen, openModal, activeTab]);

  return <AuthModalContext.Provider value={value}>{children}</AuthModalContext.Provider>;
}

export function AuthModal() {
  const { hasOpened } = useAuthModal();
  // Keep the form mounted after first use to preserve its existing lifecycle.
  return hasOpened ? <LazyAuthModal /> : null;
}
