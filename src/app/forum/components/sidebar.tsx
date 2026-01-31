"use client";

import { useLocalization } from "@/context/localization-context";
import { Users, Star, Bookmark, Calendar, MessageCircle, TrendingUp, Shield } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ForumSidebar() {
    const { t } = useLocalization();
    const pathname = usePathname();

    const navItems = [
        { icon: MessageCircle, label: t('forum_title') || "Feed", href: "/forum" },
        { icon: Users, label: "Communities", href: "/forum/groups" },
        { icon: Bookmark, label: "Saved", href: "/forum/saved" },
        { icon: Calendar, label: "Events", href: "/forum/events" },
        { icon: Shield, label: "Moderation", href: "/forum/moderation" }, // Only verified
    ];



    return (
        <div className="hidden lg:flex flex-col w-64 xl:w-72 fixed left-0 top-16 bottom-0 p-4 overflow-y-auto border-r border-white/5 bg-black/20 backdrop-blur-sm">
            <div className="space-y-1 mb-8">
                {navItems.map((item) => (
                    <Button
                        key={item.href}
                        variant={pathname === item.href ? "secondary" : "ghost"}
                        className={`w-full justify-start gap-3 h-12 font-medium ${pathname === item.href ? "bg-white/10" : ""}`}
                        asChild
                    >
                        <Link href={item.href}>
                            <item.icon className={`h-5 w-5 ${pathname === item.href ? "text-primary" : "text-muted-foreground"}`} />
                            {item.label}
                        </Link>
                    </Button>
                ))}
            </div>

            <div className="mb-4 px-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">My Communities</h3>
            </div>

            <div className="space-y-1 px-4">
                <p className="text-xs text-muted-foreground italic">{t('coming_soon') || 'Coming soon...'}</p>
            </div>

            <div className="mt-auto pt-6 border-t border-white/5">
                <div className="text-xs text-muted-foreground leading-relaxed px-4">
                    <p>© 2025 CardVerse</p>
                    <p className="opacity-50 hover:opacity-100 cursor-pointer">Privacy · Terms · Cookies</p>
                </div>
            </div>
        </div>
    );
}
