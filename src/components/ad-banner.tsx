'use client';

import { useEffect, useRef } from 'react';
import { useSubscription } from '@/hooks/useSubscription';

// Google AdSense Publisher ID
const ADSENSE_CLIENT = 'ca-pub-3779491168688544';

interface AdBannerProps {
    /** AdSense ad slot ID — get from AdSense dashboard after approval */
    slot: string;
    /** Ad format: 'auto' (responsive), 'horizontal', 'rectangle', 'vertical' */
    format?: 'auto' | 'horizontal' | 'rectangle' | 'vertical';
    /** Layout key for in-feed/in-article ads */
    layoutKey?: string;
    /** Additional CSS class */
    className?: string;
    /** Only show on certain screen sizes */
    responsive?: 'mobile-only' | 'desktop-only' | 'all';
}

/**
 * Google AdSense Banner Component
 * - Automatically hidden for VIP Pro users
 * - Responsive by default
 * - Only renders after AdSense library is loaded
 */
export function AdBanner({
    slot,
    format = 'auto',
    layoutKey,
    className = '',
    responsive = 'all',
}: AdBannerProps) {
    const { scanType } = useSubscription();
    const adRef = useRef<HTMLModElement>(null);
    const isLoaded = useRef(false);

    // VIP Pro → no ads
    const isVip = scanType === 'unlimited';

    useEffect(() => {
        if (isVip || isLoaded.current) return;

        try {
            // Push ad only once
            if (adRef.current && !adRef.current.dataset.adsbygoogleStatus) {
                ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
                isLoaded.current = true;
            }
        } catch (err) {
            console.warn('AdSense push error:', err);
        }
    }, [isVip]);

    // Don't render for VIP users
    if (isVip) return null;

    // Responsive visibility classes
    const responsiveClass =
        responsive === 'mobile-only' ? 'block md:hidden' :
            responsive === 'desktop-only' ? 'hidden md:block' :
                'block';

    return (
        <div className={`ad-container w-full overflow-hidden ${responsiveClass} ${className}`}>
            <ins
                ref={adRef}
                className="adsbygoogle"
                style={{ display: 'block' }}
                data-ad-client={ADSENSE_CLIENT}
                data-ad-slot={slot}
                data-ad-format={format === 'horizontal' ? 'horizontal' : format === 'rectangle' ? 'rectangle' : 'auto'}
                data-full-width-responsive={format === 'auto' ? 'true' : 'false'}
                {...(layoutKey ? { 'data-ad-layout-key': layoutKey } : {})}
            />
        </div>
    );
}

/**
 * In-article ad — fits naturally between content sections
 */
export function AdInArticle({ className = '' }: { className?: string }) {
    return (
        <AdBanner
            slot="placeholder_in_article"
            format="auto"
            className={`my-6 ${className}`}
        />
    );
}

/**
 * Banner ad — horizontal strip, good for between sections
 */
export function AdHorizontalBanner({ className = '' }: { className?: string }) {
    return (
        <AdBanner
            slot="placeholder_horizontal"
            format="horizontal"
            className={`my-4 ${className}`}
        />
    );
}
