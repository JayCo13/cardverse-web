"use client";

import { useState } from "react";
import { useLocalization } from "@/context/localization-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaperPlaneRight } from "@phosphor-icons/react";
import { useToast } from "@/hooks/use-toast";

export function SupportSection() {
    const { t, locale } = useLocalization();
    const { toast } = useToast();
    const [email, setEmail] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const title = t('support_section_title');
    const copy = locale === "vi-VN"
        ? {
            subscribeFailed: "Đăng ký thất bại",
            successTitle: "Thành công!",
            errorTitle: "Lỗi",
            errorDesc: "Vui lòng thử lại sau.",
            footer: "Không spam • Bảo mật • Cập nhật hàng tuần",
        }
        : locale === "ja-JP"
            ? {
                subscribeFailed: "登録に失敗しました",
                successTitle: "登録完了！",
                errorTitle: "エラー",
                errorDesc: "しばらくしてからもう一度お試しください。",
                footer: "スパムなし • 安全 • 毎週更新",
            }
            : {
                subscribeFailed: "Failed to subscribe",
                successTitle: "Success!",
                errorTitle: "Error",
                errorDesc: "Please try again later.",
                footer: "No Spam • Secure • Weekly Updates",
            };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!email.trim()) return;

        setIsLoading(true);

        try {
            const response = await fetch('/api/newsletter/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email: email.trim() }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || copy.subscribeFailed);
            }

            toast({
                title: copy.successTitle,
                description: t('support_success_message'),
                className: "bg-orange-950 border-orange-800 text-white",
            });

            setEmail("");
        } catch (error) {
            console.error('Subscribe error:', error);
            toast({
                variant: "destructive",
                title: copy.errorTitle,
                description: copy.errorDesc,
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <section className="relative py-20 px-4 overflow-hidden border-t border-orange-900/100 rounded-2xl">
            {/* Background Decoration */}
            <div className="absolute inset-0 bg-black pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-b from-orange-950/20 via-black to-black pointer-events-none" />

            <div className="relative max-w-7xl mx-auto flex flex-col items-center text-center z-10">
                <h2 className="text-4xl md:text-5xl font-bold font-headline text-white mb-4 tracking-tight">
                    <span className="text-orange-500">{title}</span>
                </h2>

                <p className="text-lg text-gray-400 max-w-2xl mb-10 font-light">
                    {t('support_section_desc')}
                </p>

                <form onSubmit={handleSubmit} className="w-full max-w-lg flex flex-col md:flex-row gap-4 relative">
                    <div className="relative flex-1">
                        <Input
                            type="email"
                            placeholder={t('support_email_placeholder')}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="h-14 bg-black border border-orange-900/100 focus:border-orange-500 text-white placeholder:text-white rounded-xl px-6 transition-all focus:bg-orange-950/10 focus:shadow-[0_0_15px_rgba(249,115,22,0.1)] text-base"
                        />
                    </div>
                    <Button
                        type="submit"
                        disabled={isLoading}
                        className="h-14 px-8 rounded-xl bg-orange-600 hover:bg-orange-500 text-black font-bold tracking-wide shadow-lg shadow-orange-900/20 transition-all duration-300 md:w-auto w-full transform hover:scale-[1.02] active:scale-[0.98]"
                    >
                        {isLoading ? (
                            <span className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <span className="flex items-center justify-center gap-2">
                                {t('support_button_subscribe')}
                                <PaperPlaneRight weight="bold" />
                            </span>
                        )}
                    </Button>
                </form>

                <p className="text-xs text-white-900/60 mt-6 font-mono uppercase tracking-widest">
                    {copy.footer}
                </p>
            </div>
        </section>
    );
}
