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
            <DialogContent className="w-[95vw] max-w-[420px] p-0 border-0 bg-transparent shadow-[0_0_40px_-10px_rgba(249,115,22,0.3)]">
                <div className="relative overflow-hidden rounded-2xl bg-[#0f1115] border border-white/10">
                    {/* Background decorations */}
                    <div className="absolute top-0 inset-x-0 h-32 bg-gradient-to-b from-orange-500/10 to-transparent pointer-events-none" />
                    <div className="absolute top-12 left-1/2 -translate-x-1/2 w-32 h-32 bg-orange-500/20 blur-[60px] rounded-full pointer-events-none" />

                    <div className="relative p-6 sm:p-8 flex flex-col items-center">
                        {/* Icon */}
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-orange-400/20 to-orange-600/5 border border-orange-500/20 flex items-center justify-center mb-6 shadow-[0_0_20px_-5px_rgba(249,115,22,0.3)]">
                            <Clock className="w-10 h-10 text-orange-500" weight="fill" />
                        </div>

                        {/* Text Content */}
                        <DialogHeader className="text-center space-y-3 mb-8">
                            <DialogTitle className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">
                                {t('scan_limit_reached')}
                            </DialogTitle>
                            <DialogDescription className="text-base text-white/60 max-w-[280px] mx-auto leading-relaxed">
                                {t('scan_limit_used')
                                    .replace('{used}', scansUsed.toString())
                                    .replace('{limit}', scansLimit.toString())}
                            </DialogDescription>
                        </DialogHeader>

                        {/* Countdown Display */}
                        <div className="w-full bg-white/5 border border-white/10 rounded-xl p-4 mb-6 relative overflow-hidden group">
                            <div className="absolute inset-0 bg-gradient-to-r from-orange-500/5 via-transparent to-orange-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                            <div className="flex flex-col items-center gap-1.5 py-1">
                                <span className="text-xs uppercase tracking-widest text-white/40 font-semibold">
                                    {t('scan_limit_resets_in')}
                                </span>
                                <div className="text-4xl font-mono font-bold text-orange-400 tracking-wider drop-shadow-lg">
                                    {countdown}
                                </div>
                            </div>
                        </div>

                        {/* CTA Section */}
                        {isAnonymous ? (
                            <div className="w-full space-y-3">
                                <div className="p-4 rounded-xl bg-gradient-to-r from-orange-500/10 to-transparent border border-orange-500/20">
                                    <div className="flex items-start gap-3">
                                        <div className="p-1.5 rounded-full bg-orange-500/20 mt-0.5">
                                            <UserPlus className="w-4 h-4 text-orange-400" weight="bold" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-orange-200 mb-1">
                                                {t('scan_limit_register_prompt')}
                                            </p>
                                            <p className="text-xs text-orange-200/60 leading-relaxed">
                                                Register now to upgrade your daily limit to 3 scans.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <Button
                                    onClick={handleRegister}
                                    className="w-full h-12 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-bold text-base shadow-lg shadow-orange-500/20 transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98]"
                                >
                                    {t('scan_limit_register_button')}
                                </Button>
                                <Button
                                    variant="ghost"
                                    onClick={onClose}
                                    className="w-full h-12 text-white/40 hover:text-white hover:bg-white/5 transition-colors"
                                >
                                    {t('close')}
                                </Button>
                            </div>
                        ) : (
                            <Button
                                onClick={onClose}
                                className="w-full h-12 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium transition-all duration-300"
                            >
                                {t('close')}
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default ScanLimitModal;
