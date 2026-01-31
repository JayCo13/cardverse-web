"use client";

import { useEffect, useState } from "react";
import { CaretUp } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export function ScrollToTop() {
    const [isVisible, setIsVisible] = useState(false);

    // Show button when page is scrolled down
    useEffect(() => {
        const toggleVisibility = () => {
            if (window.scrollY > 300) {
                setIsVisible(true);
            } else {
                setIsVisible(false);
            }
        };

        window.addEventListener("scroll", toggleVisibility);

        return () => window.removeEventListener("scroll", toggleVisibility);
    }, []);

    const scrollToTop = () => {
        window.scrollTo({
            top: 0,
            behavior: "smooth",
        });
    };

    return (
        <button
            type="button"
            onClick={scrollToTop}
            className={cn(
                "fixed bottom-8 right-8 z-50 p-3 rounded-xl transition-all duration-300 transform group",
                "bg-gradient-to-br from-orange-400 via-orange-500 to-yellow-600",
                "border-2 border-yellow-300/50 hover:border-yellow-200",
                "shadow-[0_0_15px_rgba(234,179,8,0.4)] hover:shadow-[0_0_25px_rgba(234,179,8,0.6)]",
                "text-black",
                isVisible ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0 pointer-events-none"
            )}
            aria-label="Scroll to top"
        >
            <CaretUp
                weight="fill"
                className="w-6 h-6 animate-pulse-slow group-hover:-translate-y-1 transition-transform duration-300"
            />
            <span className="sr-only">Scroll to top</span>
        </button>
    );
}
