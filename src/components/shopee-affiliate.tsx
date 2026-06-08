"use client";

import {
    ShoppingBag, Stack, Shield, Books, Package, Cube, Sparkle, ArrowRight,
    type Icon,
} from "@phosphor-icons/react";
import {
    SHOPEE_AFFILIATE_ENABLED, SHOPEE_ACCESSORIES, type ShopeeIcon,
} from "@/lib/shopee-affiliate";

const ICONS: Record<ShopeeIcon, Icon> = {
    sleeve: Stack,
    toploader: Shield,
    binder: Books,
    deckbox: Package,
    case: Cube,
    tool: Sparkle,
};

const SHOPEE = "#ee4d2d"; // Shopee brand orange

/**
 * Shopee affiliate accessory block. `section` = full homepage section,
 * `compact` = small strip for card-detail pages.
 */
export function ShopeeAffiliate({
    variant = "section",
    heading = "Phụ kiện cho dân chơi thẻ",
    sub = "Sleeve, toploader, binder… bảo vệ bộ sưu tập của bạn",
}: {
    variant?: "section" | "compact";
    heading?: string;
    sub?: string;
}) {
    if (!SHOPEE_AFFILIATE_ENABLED || SHOPEE_ACCESSORIES.length === 0) return null;

    const items = variant === "compact" ? SHOPEE_ACCESSORIES.slice(0, 4) : SHOPEE_ACCESSORIES;

    return (
        <section className={variant === "section" ? "w-full max-w-7xl mx-auto px-4 py-10" : "w-full"}>
            {/* Header */}
            <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2 min-w-0">
                    <ShoppingBag weight="fill" className="w-5 h-5 shrink-0" style={{ color: SHOPEE }} />
                    <div className="min-w-0">
                        <h2 className={`font-bold text-white truncate ${variant === "section" ? "text-xl sm:text-2xl" : "text-base"}`}>
                            {heading}
                        </h2>
                        {variant === "section" && <p className="text-sm text-white/50 truncate">{sub}</p>}
                    </div>
                </div>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-white/40 border border-white/10 rounded-full px-2 py-0.5">
                    Tài trợ
                </span>
            </div>

            {/* Grid of accessory cards */}
            <div className={`grid gap-3 ${variant === "section"
                ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
                : "grid-cols-2 sm:grid-cols-4"}`}>
                {items.map((p) => {
                    const Icon = ICONS[p.icon] || Package;
                    return (
                        <a
                            key={p.id}
                            href={p.url}
                            target="_blank"
                            rel="sponsored nofollow noopener noreferrer"
                            className="group flex flex-col rounded-xl border border-white/10 bg-white/[0.03] p-3 hover:border-orange-500/40 hover:bg-white/[0.06] transition-colors"
                        >
                            <div
                                className="w-9 h-9 rounded-lg flex items-center justify-center mb-2"
                                style={{ backgroundColor: `${SHOPEE}1a` }}
                            >
                                <Icon weight="fill" className="w-5 h-5" />
                            </div>
                            <p className="text-sm font-semibold text-white leading-tight line-clamp-2">{p.name}</p>
                            <p className="text-[11px] text-white/45 mt-0.5 line-clamp-2 flex-1">{p.desc}</p>
                            <div className="flex items-center justify-between mt-2">
                                {p.priceText && <span className="text-[11px] text-white/50">{p.priceText}</span>}
                                <span
                                    className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold group-hover:gap-1.5 transition-all"
                                    style={{ color: SHOPEE }}
                                >
                                    Mua trên Shopee <ArrowRight weight="bold" className="w-3 h-3" />
                                </span>
                            </div>
                        </a>
                    );
                })}
            </div>
        </section>
    );
}
