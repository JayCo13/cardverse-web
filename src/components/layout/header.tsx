
"use client"

import Link from "next/link"
import Image from "next/image"
import { CircleUser, Menu, Search, Headphones, Camera, Crown, Zap, Diamond, Wallet, Package, Settings } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { NotificationBell } from "@/components/notification-bell"
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
  const { t } = useLocalization();
  const { user, profile, isLoading, signOut } = useAuth();
  const { setOpen } = useAuthModal();
  const { toast } = useToast();
  const router = useRouter();
  const { isVipPro, isDayPass, hasCredits, subscription } = useSubscription();

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

  const renderUserAuth = () => {
    if (isLoading) {
      return <Skeleton className="h-8 w-24" />;
    }

    if (user) {
      const initial = user.email ? user.email.charAt(0).toUpperCase() : "A";
      const displayEmail = user.email && user.email.length > 15
        ? user.email.substring(0, 12) + "..."
        : (user.email || "Account");

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
              <span className="hidden md:inline">{displayEmail}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="max-w-[200px] truncate" title={user.email || ""}>
              {user.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuItem asChild>
              <Link href="/collection" className="flex items-center gap-2">
                <Diamond className="h-4 w-4" />
                Portfolio
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/pricing" className="text-orange-500 font-medium flex items-center gap-2">
                <Crown className="w-4 h-4" />
                {t('pricing_title') || 'Upgrade & Billing'}
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
        <span className="hidden md:inline">{t('log_in')}</span>
      </Button>
    );
  }

  return (
    <header className="sticky top-0 z-50 flex flex-col border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center">
          <div className="hidden md:flex flex-1 items-center gap-4 text-sm text-muted-foreground">
            <Headphones className="h-4 w-4" />
            <span>+84 812 334 511</span>
          </div>

          <div className="flex-1 flex justify-start md:justify-center">
            <Link
              href="/"
              className="flex items-center gap-2 text-lg font-semibold md:text-base"
            >
              <Image src="/assets/logo-verse.png" width={160} height={40} className="w-[150px] md:w-[170px] h-auto" alt="CardVerse logo" />
            </Link>
          </div>

          <div className="flex-1 flex items-center justify-end gap-1 md:gap-2 text-sm font-medium">
            <div className="hidden md:flex items-center gap-2">
              <CurrencySelector />
              <LanguageSelector />
              <div className="mx-2 h-6 w-px bg-white/50" />
            </div>
            <NotificationBell />
            {renderUserAuth()}
          </div>
        </div>
      </div>
      <div className="border-t">
        <div className="container mx-auto px-4 flex h-16 items-center">
          <div className="md:hidden w-full flex items-center justify-between">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                >
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Toggle navigation menu</span>
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
                  <div className="my-2 pt-2 grid gap-4">
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
                <span className="md:hidden">{t('scan_short')}</span>
                <span className="hidden md:inline">{t('scan_pokemon_card')}</span>
              </Button>
              <div className="flex gap-1 shrink-0">
                <CurrencySelector />
                <LanguageSelector />
              </div>
            </div>
          </div>
          {/* Desktop Left Nav */}
          <div className="hidden md:flex flex-1 items-center justify-start">
            <nav className="flex flex-row items-center gap-2 whitespace-nowrap text-sm font-medium">
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
          </div>

          <div className="flex-1 flex w-full items-center gap-4 md:ml-auto justify-end hidden md:flex">
            <Link href="/pricing" passHref>
              <Button variant="outline" className="border-orange-500/50 text-orange-500 hover:bg-orange-500/10 flex items-center gap-2">
                <Zap className="h-4 w-4" />
                <span className="whitespace-nowrap">{t('buy_more_scans')}</span>
              </Button>
            </Link>
            <Button onClick={handleScanClick} className="bg-orange-500 hover:bg-orange-600 text-white font-bold whitespace-nowrap px-6">
              {t('scan_pokemon_card')}
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
