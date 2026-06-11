
"use client"

import Link from "next/link"
import Image from "next/image"
import { useCallback, useEffect, useState } from "react"
import { CircleUser, Menu, Headphones, Camera, Crown, Zap, Diamond, Wallet, Package, Settings, ShoppingCart } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { NotificationBell } from "@/components/notification-bell"
import { ChatInboxButton } from "@/components/chat-drawer"
import { LanguageSelector } from "@/components/language-selector"
import { CurrencySelector } from "@/components/currency-selector"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { useLocalization } from "@/context/localization-context"
import { Skeleton } from "../ui/skeleton"
import { useAuth } from "@/lib/supabase"
import { useAuthModal } from "@/components/auth-modal"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "next/navigation"
import { useSubscription } from "@/hooks/useSubscription"

export function Header() {
  const { t, locale } = useLocalization();
  const { user, profile, isLoading, signOut } = useAuth();
  const { setOpen } = useAuthModal();
  const { toast } = useToast();
  const router = useRouter();
  const { isVipPro, isDayPass, hasCredits, subscription } = useSubscription();
  const [cartCount, setCartCount] = useState(0);
  const copy = locale === "vi-VN"
    ? {
      account: "Tài khoản",
      collection: "Bộ sưu tập",
      orders: "Đơn hàng",
      wallet: "Ví",
      choosePlan: "Chọn gói của bạn",
      toggleMenu: "Mở menu điều hướng",
    }
    : locale === "ja-JP"
      ? {
        account: "アカウント",
        collection: "コレクション",
        orders: "注文",
        wallet: "ウォレット",
        choosePlan: "プランを選ぶ",
        toggleMenu: "ナビゲーションメニューを切り替え",
      }
      : {
        account: "Account",
        collection: "Collection",
        orders: "Orders",
        wallet: "Wallet",
        choosePlan: "Choose Your Plan",
        toggleMenu: "Toggle navigation menu",
      };

  // Admin-created tester accounts get full access to gated marketplace features.
  const isTester = !!profile?.is_tester;

  const fetchCartCount = useCallback(async () => {
    if (!user) {
      setCartCount(0);
      return;
    }
    try {
      const response = await fetch("/api/cart", { cache: "no-store" });
      const payload = await response.json();
      setCartCount(Array.isArray(payload.items) ? payload.items.length : 0);
    } catch {
      setCartCount(0);
    }
  }, [user]);

  useEffect(() => {
    void fetchCartCount();
    const handler = () => void fetchCartCount();
    window.addEventListener("cardverse:cart-updated", handler);
    return () => window.removeEventListener("cardverse:cart-updated", handler);
  }, [fetchCartCount]);

  const handleComingSoon = () => {
    toast({
      description: t('coming_soon'),
      duration: 3000,
    });
  };

  // Scroll to market spotlight section
  const handleScanClick = () => {
    const element = document.getElementById('market-spotlight');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    } else {
      router.push('/#market-spotlight');
    }
  };

  // Beta-gated nav item: testers get a real link, everyone else gets a
  // "coming soon" toast. Both show the beta/soon badge.
  const renderBetaNavItem = (
    href: string,
    label: string,
    badgeKey: 'beta' | 'soon',
    className: string,
  ) => {
    const badge = (
      <Badge variant="outline" className="text-[10px] h-4 px-1 border-orange-500 text-orange-500">{t(badgeKey)}</Badge>
    );
    if (isTester) {
      return (
        <Link href={href} className={className}>
          {label}
          {badge}
        </Link>
      );
    }
    return (
      <span onClick={handleComingSoon} className={`cursor-pointer ${className}`}>
        {label}
        {badge}
      </span>
    );
  };

  const renderUserAuth = () => {
    if (isLoading) {
      return <Skeleton className="h-8 w-24" />;
    }

    if (user) {
      const initial = user.email ? user.email.charAt(0).toUpperCase() : "A";
      const displayEmail = user.email && user.email.length > 15
        ? user.email.substring(0, 12) + "..."
        : (user.email || copy.account);

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 px-2">
              <div className="relative">
                <div className={`h-7 w-7 rounded-full flex items-center justify-center font-bold text-xs overflow-hidden ${isVipPro
                  ? 'bg-purple-500/20 border border-purple-500/40 text-purple-400'
                  : isDayPass
                    ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-400'
                    : hasCredits
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                      : 'bg-orange-500/10 border border-orange-500/20 text-orange-500'
                  }`}>
                  {profile?.profile_image_url ? (
                    <img src={profile.profile_image_url} alt="User Avatar" className="h-full w-full object-cover" />
                  ) : (
                    initial
                  )}
                </div>
                {/* Subscription badge overlay */}
                {isVipPro && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-purple-600 border border-[#0a0a14] shadow-[0_0_6px_rgba(168,85,247,0.6)]">
                    <Crown className="h-2 w-2 text-white" />
                  </span>
                )}
                {isDayPass && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-cyan-500 border border-[#0a0a14] shadow-[0_0_6px_rgba(34,211,238,0.6)]">
                    <Zap className="h-2 w-2 text-white" />
                  </span>
                )}
                {hasCredits && !isDayPass && !isVipPro && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 border border-[#0a0a14] shadow-[0_0_6px_rgba(52,211,153,0.6)]">
                    <Diamond className="h-2 w-2 text-white" />
                  </span>
                )}
              </div>
              <span className="hidden lg:inline">{displayEmail}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="max-w-[200px] truncate" title={user.email || ""}>
              {user.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile" className="flex items-center gap-2">
                <CircleUser className="h-4 w-4" />
                {t('profile')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/collection" className="flex items-center gap-2">
                <Diamond className="h-4 w-4" />
                {copy.collection}
              </Link>
            </DropdownMenuItem>
            {isTester && (
              <>
                <DropdownMenuItem asChild>
                  <Link href="/orders" className="flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    {copy.orders}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/wallet" className="flex items-center gap-2">
                    <Wallet className="h-4 w-4" />
                    {copy.wallet}
                  </Link>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/pricing" className="text-orange-500 font-medium flex items-center gap-2">
                <Crown className="w-4 h-4" />
                {t('pricing_title') || copy.choosePlan}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/profile/edit" className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                {t('settings')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                signOut();
              }}
            >
              {t('logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    return (
      <Button variant="ghost" className="gap-2 px-2" onClick={() => setOpen(true)}>
        <CircleUser className="h-5 w-5" />
        <span className="hidden lg:inline">{t('log_in')}</span>
      </Button>
    );
  }

  return (
    <header className="sticky top-0 z-50 flex flex-col border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center">
          <div className="hidden lg:flex flex-1 items-center gap-4 text-sm text-muted-foreground">
            <Headphones className="h-4 w-4" />
            <span>+84 812 334 511</span>
          </div>

          <div className="flex-1 flex justify-start lg:justify-center">
            <Link
              href="/"
              className="flex items-center gap-2 text-lg font-semibold lg:text-base"
            >
              <Image src="/assets/logo-verse.png" width={160} height={40} className="w-[150px] lg:w-[170px] h-auto" alt="CardVerse logo" />
            </Link>
          </div>

          <div className="flex-1 flex items-center justify-end gap-1 lg:gap-2 text-sm font-medium">
            <div className="hidden lg:flex items-center gap-2">
              <CurrencySelector />
              <LanguageSelector />
              <div className="mx-2 h-6 w-px bg-white/50" />
            </div>
            <NotificationBell />
            <ChatInboxButton />
            <Button variant="ghost" size="icon" className="relative" asChild>
              <Link href="/cart" aria-label="Giỏ hàng">
                <ShoppingCart className="h-5 w-5" />
                {cartCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">
                    {cartCount > 9 ? "9+" : cartCount}
                  </span>
                )}
              </Link>
            </Button>
            {renderUserAuth()}
          </div>
        </div>
      </div>
      <div className="border-t">
        <div className="container mx-auto px-4 flex h-16 items-center">
          <div className="lg:hidden w-full flex items-center justify-between">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                >
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">{copy.toggleMenu}</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left">
                <nav className="grid gap-6 text-lg font-medium">
                  <Link
                    href="/"
                    className="flex items-center gap-2 text-2xl font-semibold"
                  >
                    <Image src="/assets/logo-verse.png" width={140} height={35} alt="CardVerse logo" />
                  </Link>
                  <div className="relative group">
                    {renderBetaNavItem('/buy', t('nav_buy'), 'beta', 'text-muted-foreground hover:text-foreground flex items-center gap-1')}
                  </div>
                  <div className="relative group">
                    {renderBetaNavItem('/sell', t('nav_sell'), 'beta', 'text-muted-foreground hover:text-foreground flex items-center gap-1')}
                  </div>
                  {isTester && (
                    <>
                      <div className="relative group">
                        <Link href="/wallet" className="text-muted-foreground hover:text-foreground flex items-center gap-1">
                          {copy.wallet}
                        </Link>
                      </div>
                      <div className="relative group">
                        <Link href="/orders" className="text-muted-foreground hover:text-foreground flex items-center gap-1">
                          {copy.orders}
                        </Link>
                      </div>
                    </>
                  )}
                  {renderBetaNavItem('/bid', t('nav_bid'), 'beta', 'text-muted-foreground hover:text-foreground flex items-center gap-1')}
                  {renderBetaNavItem('/razz', t('nav_razz'), 'soon', 'text-muted-foreground hover:text-foreground flex items-center gap-1')}
                  <span onClick={handleComingSoon} className="cursor-pointer text-muted-foreground hover:text-foreground flex items-center gap-1">
                    {t('nav_forum')}
                    <Badge variant="outline" className="text-[10px] h-4 px-1 border-orange-500 text-orange-500">{t('soon')}</Badge>
                  </span>
                  <div className="border-t my-2 pt-2 grid gap-4">
                    <Link href="/pokemon" className="text-muted-foreground hover:text-foreground flex items-center gap-2">
                      <Image src="/assets/pok-logo.png" width={24} height={24} alt="Pokemon" className="object-contain" />
                      {t('nav_pokemon')}
                    </Link>
                    <Link href="/onepiece" className="text-muted-foreground hover:text-foreground flex items-center gap-2">
                      <Image src="/assets/one-logo.png" width={24} height={24} alt="One Piece" className="object-contain" />
                      {t('nav_onepiece')}
                    </Link>
                    <Link href="/soccer" className="text-muted-foreground hover:text-foreground flex items-center gap-2">
                      <Image src="/assets/soc-logo.png" width={24} height={24} alt="Soccer" className="object-contain" />
                      {t('nav_soccer')}
                    </Link>
                  </div>
                </nav>
              </SheetContent>
            </Sheet>
            <div className="flex items-center gap-2 flex-1 justify-end ml-2">
              <Button onClick={handleScanClick} size="sm" className="bg-orange-500 hover:bg-orange-600 text-white font-bold whitespace-nowrap px-3 h-9 text-xs sm:text-sm flex items-center gap-2 justify-center">
                <Camera className="h-4 w-4" />
                <span>{t('scan_short')}</span>
              </Button>
              <div className="flex gap-1 shrink-0">
                <CurrencySelector />
                <LanguageSelector />
              </div>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <nav className="hidden lg:flex flex-row items-center gap-8 whitespace-nowrap text-sm font-medium">
              <div className="relative">
                {renderBetaNavItem('/buy', t('nav_buy'), 'beta', 'text-foreground/80 hover:text-foreground flex items-center gap-1 transition-colors')}
              </div>
              <div className="relative">
                {renderBetaNavItem('/sell', t('nav_sell'), 'beta', 'text-foreground/80 hover:text-foreground flex items-center gap-1 transition-colors')}
              </div>
              {renderBetaNavItem('/bid', t('nav_bid'), 'beta', 'text-foreground/80 hover:text-foreground flex items-center gap-1 transition-colors')}
              {renderBetaNavItem('/razz', t('nav_razz'), 'soon', 'text-foreground/80 hover:text-foreground flex items-center gap-1 transition-colors')}
              <span
                onClick={handleComingSoon}
                className="cursor-pointer text-foreground/80 hover:text-foreground flex items-center gap-1 transition-colors"
              >
                {t('nav_forum')}
                <Badge variant="outline" className="text-[10px] h-4 px-1 border-orange-500 text-orange-500">{t('soon')}</Badge>
              </span>
            </nav>
          </div>

          <div className="hidden flex-1 w-full items-center gap-4 lg:ml-auto lg:flex lg:justify-end">
            <nav className="hidden lg:flex items-center gap-2 text-sm font-medium">
              <Link
                href="/pokemon"
                prefetch={false}
                className="px-3 py-1.5 rounded-lg text-yellow-400 hover:bg-yellow-500/10 transition-colors flex items-center gap-2 group"
              >
                <div className="relative w-6 h-6 transition-transform group-hover:scale-110">
                  <Image src="/assets/pok-logo.png" alt="Pokemon" fill className="object-contain" />
                </div>
                <span className="block group-hover:hidden">{t('nav_pokemon')}</span>
                <span className="hidden group-hover:block whitespace-nowrap">{t('nav_pokemon_price')}</span>
              </Link>
              <Link
                href="/onepiece"
                prefetch={false}
                className="px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2 group"
              >
                <div className="relative w-6 h-6 transition-transform group-hover:scale-110">
                  <Image src="/assets/one-logo.png" alt="One Piece" fill className="object-contain" />
                </div>
                <span className="block group-hover:hidden">{t('nav_onepiece')}</span>
                <span className="hidden group-hover:block whitespace-nowrap">{t('nav_onepiece_price')}</span>
              </Link>
              <Link
                href="/soccer"
                prefetch={false}
                className="px-3 py-1.5 rounded-lg text-green-400 hover:bg-green-500/10 transition-colors flex items-center gap-2 group"
              >
                <div className="relative w-6 h-6 transition-transform group-hover:scale-110">
                  <Image src="/assets/soc-logo.png" alt="Soccer" fill className="object-contain" />
                </div>
                <span className="block group-hover:hidden">{t('nav_soccer')}</span>
                <span className="hidden group-hover:block whitespace-nowrap">{t('nav_soccer_price')}</span>
              </Link>
            </nav>
            <Button onClick={handleScanClick} className="bg-orange-500 hover:bg-orange-600 text-white font-bold whitespace-nowrap px-6">
              {t('scan_pokemon_card')}
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
