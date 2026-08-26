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
                "fixed bottom-5 left-4 z-40 flex h-10 w-10 items-center justify-center rounded-full opacity-80 shadow-md transition-all duration-300 transform group hover:scale-105 hover:opacity-100",
                "bg-gradient-to-br from-orange-400 via-orange-500 to-yellow-600",
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
