'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, Loader2, XCircle } from 'lucide-react';
import { useLocalization } from '@/context/localization-context';

type Outcome = 'pending' | 'approved' | 'failed';

/**
 * Where the identity provider returns the user after the hosted flow.
 *
 * The redirect carries a status in the query string, but that is a browser
 * navigation the user controls, so it is treated as a hint only — the real
 * status is read back from our own API, which is fed by the signed webhook.
 */
export default function KycCallbackPage() {
    const router = useRouter();
    const { locale } = useLocalization();
    const tx = (vi: string, en: string, ja: string) =>
        locale === 'ja-JP' ? ja : locale === 'vi-VN' ? vi : en;

    const [outcome, setOutcome] = useState<Outcome>('pending');

    useEffect(() => {
        let cancelled = false;
        let attempts = 0;

        // The webhook usually lands within seconds of the redirect, but not
        // always before it — poll briefly rather than showing a false failure.
        const poll = async () => {
            attempts += 1;
            try {
                // This page exists precisely to wait on the verdict, so it
                // is the one caller that should reach the provider when the
                // webhook has not landed yet.
                const res = await fetch('/api/seller/kyc/session?poll=1');
                if (res.ok) {
                    const data = await res.json();
                    const status = data.session?.status as string | undefined;

                    if (status === 'Approved') {
                        if (!cancelled) setOutcome('approved');
                        return;
                    }
                    if (status && ['Declined', 'Abandoned', 'Expired', 'Kyc Expired'].includes(status)) {
                        if (!cancelled) setOutcome('failed');
                        return;
                    }
                }
            } catch {
                // Ignore and retry — a transient network blip should not read
                // as a rejected verification.
            }

            if (!cancelled && attempts < 12) {
                setTimeout(poll, 2500);
            }
        };

        poll();
        return () => { cancelled = true; };
    }, []);

    // Send approved users straight back to finish the seller form.
    useEffect(() => {
        if (outcome !== 'approved') return;
        const timer = setTimeout(() => router.push('/sell'), 1500);
        return () => clearTimeout(timer);
    }, [outcome, router]);

    return (
        <div className="flex flex-1 flex-col">
            <main className="flex-1 container mx-auto px-4 py-16">
                <Card className="max-w-md mx-auto border-orange-500/20">
                    <CardContent className="pt-8 pb-8 flex flex-col items-center text-center gap-4">
                        {outcome === 'pending' && (
                            <>
                                <Loader2 className="h-10 w-10 text-orange-500 animate-spin" />
                                <h1 className="text-xl font-bold">
                                    {tx('Đang xác nhận kết quả...', 'Confirming your result...', '結果を確認しています...')}
                                </h1>
                                <p className="text-sm text-muted-foreground">
                                    {tx(
                                        'Chúng tôi đang nhận kết quả từ đối tác xác minh. Việc này thường mất vài giây.',
                                        'We are receiving the result from our verification partner. This usually takes a few seconds.',
                                        'パートナーから結果を受信しています。通常は数秒で完了します。'
                                    )}
                                </p>
                            </>
                        )}

                        {outcome === 'approved' && (
                            <>
                                <CheckCircle className="h-10 w-10 text-green-500" />
                                <h1 className="text-xl font-bold">
                                    {tx('Xác minh danh tính thành công', 'Identity verified', '本人確認が完了しました')}
                                </h1>
                                <p className="text-sm text-muted-foreground">
                                    {tx('Đang đưa bạn về trang đăng ký bán hàng...', 'Taking you back to the seller form...', '販売者フォームに戻しています...')}
                                </p>
                            </>
                        )}

                        {outcome === 'failed' && (
                            <>
                                <XCircle className="h-10 w-10 text-red-500" />
                                <h1 className="text-xl font-bold">
                                    {tx('Xác minh chưa thành công', 'Verification did not pass', '確認が完了しませんでした')}
                                </h1>
                                <p className="text-sm text-muted-foreground">
                                    {tx(
                                        'Bạn có thể thử lại với ảnh giấy tờ rõ hơn và đủ ánh sáng.',
                                        'You can try again with a clearer, well-lit capture of your document.',
                                        '明るい場所で書類を鮮明に撮影し、もう一度お試しください。'
                                    )}
                                </p>
                            </>
                        )}

                        <Button onClick={() => router.push('/sell')} className="mt-2 w-full">
                            {tx('Quay lại trang bán hàng', 'Back to seller page', '販売者ページに戻る')}
                        </Button>
                    </CardContent>
                </Card>
            </main>
        </div>
    );
}
