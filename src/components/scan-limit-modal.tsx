"use client";

import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Clock, UserPlus, Warning } from '@phosphor-icons/react';
import { useLocalization } from '@/context/localization-context';
import { useAuthModal } from '@/components/auth-modal';

interface ScanLimitModalProps {
    isOpen: boolean;
    onClose: () => void;
    resetTime: Date;
    scansUsed: number;
    scansLimit: number;
    isAnonymous: boolean;
}

/**
 * Format remaining time as HH:MM:SS
 */
function formatCountdown(ms: number): string {
    if (ms <= 0) return '00:00:00';

    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function ScanLimitModal({
    isOpen,
    onClose,
    resetTime,
    scansUsed,
    scansLimit,
    isAnonymous,
}: ScanLimitModalProps) {
    const { t } = useLocalization();
    const { openModal: openAuthModal } = useAuthModal();
    const [countdown, setCountdown] = useState('');

    // Update countdown every second
    useEffect(() => {
        if (!isOpen) return;

        const updateCountdown = () => {
            const now = new Date();
            const remaining = resetTime.getTime() - now.getTime();
            setCountdown(formatCountdown(remaining));
        };

        updateCountdown();
        const interval = setInterval(updateCountdown, 1000);

        return () => clearInterval(interval);
    }, [isOpen, resetTime]);

    const handleRegister = () => {
        onClose();
        openAuthModal('signup');
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="w-[95vw] max-w-[400px] rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 border-orange-500/30">
                <DialogHeader className="text-center">
                    <div className="mx-auto w-16 h-16 rounded-full bg-orange-500/20 flex items-center justify-center mb-4">
                        <Warning className="w-8 h-8 text-orange-500" weight="fill" />
                    </div>
                    <DialogTitle className="text-xl font-bold text-white">
                        {t('scan_limit_reached')}
                    </DialogTitle>
                    <DialogDescription className="text-white/70">
                        {t('scan_limit_used', { used: scansUsed.toString(), limit: scansLimit.toString() })}
                    </DialogDescription>
                </DialogHeader>

                {/* Countdown Timer */}
                <div className="mt-6 p-4 rounded-lg bg-black/30 border border-white/10">
                    <div className="flex items-center justify-center gap-2 text-white/60 mb-2">
                        <Clock className="w-4 h-4" />
                        <span className="text-sm">{t('scan_limit_resets_in')}</span>
                    </div>
                    <div className="text-3xl font-mono font-bold text-center text-orange-400">
                        {countdown}
                    </div>
                </div>

                {/* Register CTA for anonymous users */}
                {isAnonymous && (
                    <div className="mt-4 p-4 rounded-lg bg-gradient-to-r from-orange-500/20 to-yellow-500/20 border border-orange-500/30">
                        <p className="text-sm text-white/80 text-center mb-3">
                            {t('scan_limit_register_prompt')}
                        </p>
                        <Button
                            onClick={handleRegister}
                            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold"
                        >
                            <UserPlus className="w-4 h-4 mr-2" />
                            {t('scan_limit_register_button')}
                        </Button>
                    </div>
                )}

                {/* Close button */}
                <Button
                    variant="ghost"
                    onClick={onClose}
                    className="mt-2 text-white/60 hover:text-white hover:bg-white/10"
                >
                    {t('close')}
                </Button>
            </DialogContent>
        </Dialog>
    );
}

export default ScanLimitModal;
