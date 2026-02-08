import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLocalization } from '@/context/localization-context';
import { useRouter } from 'next/navigation';
import { Clock, LockKey } from '@phosphor-icons/react';

interface ScanLimitModalProps {
    isOpen: boolean;
    onClose: () => void;
    type: 'guest' | 'user';
    resetTime?: Date;
}

export function ScanLimitModal({ isOpen, onClose, type, resetTime }: ScanLimitModalProps) {
    const { t } = useLocalization();
    const router = useRouter();
    const [timeLeft, setTimeLeft] = useState('');

    useEffect(() => {
        if (type === 'user' && resetTime && isOpen) {
            const timer = setInterval(() => {
                const now = new Date();
                const diff = resetTime.getTime() - now.getTime();

                if (diff <= 0) {
                    setTimeLeft('00:00:00');
                    clearInterval(timer);
                    onClose(); // Auto-close when time is up? Or let user refresh
                } else {
                    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
                    const minutes = Math.floor((diff / (1000 * 60)) % 60);
                    const seconds = Math.floor((diff / 1000) % 60);
                    setTimeLeft(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
                }
            }, 1000);

            return () => clearInterval(timer);
        }
    }, [type, resetTime, isOpen, onClose]);

    const handleRegister = () => {
        onClose();
        // Assuming auth modal triggering is handled via URL hash or global state, 
        // but for now redirect to home with hash or just use existing auth trigger if available.
        // Since this is likely inside a component that can trigger auth, we might need a prop.
        // For now, let's assume we can trigger the auth modal via a URL hash change which the layout listens to,
        // or we just redirect to a login page if that exists.
        // The previous code in header.tsx uses `window.dispatchEvent(new Event('open-auth-modal'))` or similar pattern?
        // Let's check `header.tsx` or `auth-modal.tsx` usage.
        // Just pushing hash usually works if checking hash.
        router.push('/#auth-signup');
        // Or if there's a global event.
        window.dispatchEvent(new CustomEvent('open-auth-modal', { detail: { tab: 'signup' } }));
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px] w-[95vw] rounded-xl border-white/10 bg-black/90 backdrop-blur-xl text-white">
                <DialogHeader>
                    <div className="mx-auto bg-white/10 p-4 rounded-full mb-4 w-16 h-16 flex items-center justify-center">
                        {type === 'guest' ? <LockKey size={32} weight="fill" className="text-orange-500" /> : <Clock size={32} weight="fill" className="text-blue-500" />}
                    </div>
                    <DialogTitle className="text-center text-xl font-bold">
                        {type === 'guest' ? t('scan_limit_guest_title') : t('scan_limit_user_title')}
                    </DialogTitle>
                    <DialogDescription className="text-center text-gray-400 mt-2">
                        {type === 'guest' ? t('scan_limit_guest_desc') : t('scan_limit_user_desc')}
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    {type === 'user' && (
                        <div className="text-center">
                            <div className="text-sm text-gray-500 mb-1">{t('scan_limit_resets_in')}</div>
                            <div className="text-3xl font-mono font-bold text-blue-400 tracking-wider">
                                {timeLeft || '--:--:--'}
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter className="flex flex-col gap-2 sm:gap-0">
                    {type === 'guest' ? (
                        <Button onClick={handleRegister} className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold h-12 rounded-full">
                            {t('auth_signup_button')}
                        </Button>
                    ) : (
                        <Button onClick={onClose} variant="outline" className="w-full border-white/20 hover:bg-white/10 text-white h-12 rounded-full">
                            {t('close')}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
