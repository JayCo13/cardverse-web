"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Mounts its children only once they are near the viewport.
 *
 * `next/dynamic` splits a component into its own chunk but still fetches and
 * runs it as soon as the component renders. For a heavy block that sits below
 * the fold that is the whole cost with none of the saving: the homepage was
 * pulling ~800KB of charting library during hydration for a section most
 * visitors scroll past.
 *
 * `rootMargin` starts the fetch before the block is actually visible, so the
 * skeleton is usually replaced by the time the reader arrives.
 */
export function LazyMount({
    children,
    fallback = null,
    rootMargin = "300px",
    /** Reserves height so revealing the block does not shove the page. */
    minHeight,
    /** Anchor target, kept on the wrapper so links work before the block mounts. */
    id,
}: {
    children: React.ReactNode;
    fallback?: React.ReactNode;
    rootMargin?: string;
    minHeight?: number | string;
    id?: string;
}) {
    const ref = useRef<HTMLDivElement | null>(null);
    const [shown, setShown] = useState(false);

    useEffect(() => {
        if (shown) return;
        const node = ref.current;
        if (!node) return;

        // Older browsers, and any environment without the API, simply get the
        // block immediately rather than never getting it.
        if (typeof IntersectionObserver === "undefined") {
            setShown(true);
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setShown(true);
                    observer.disconnect();
                }
            },
            { rootMargin },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [shown, rootMargin]);

    return (
        <div ref={ref} id={id} style={shown ? undefined : { minHeight }}>
            {shown ? children : fallback}
        </div>
    );
}
