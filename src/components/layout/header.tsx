
"use client"

import Link from "next/link"
import Image from "next/image"
import { CircleUser, Menu, Search, Headphones } from "lucide-react"
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
import { useRouter } from "next/navigation"

export function Header() {
  const { t } = useLocalization();
  const { user, isLoading, signOut } = useAuth();
  const { setOpen } = useAuthModal();
  const router = useRouter();

  const handleListCardClick = () => {
    if (!user) {
      setOpen(true);
    } else {
      router.push('/sell/create');
    }
  };

  const renderUserAuth = () => {
    if (isLoading) {
      return <Skeleton className="h-8 w-24" />;
    }

    if (user) {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 px-2">
              <CircleUser className="h-5 w-5" />
              <span className="hidden md:inline">{user.email || "Account"}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile">{t('profile')}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/profile">{t('my_listings')}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem>{t('settings')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()}>
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
          <div className="flex-1 flex items-center gap-4 text-sm text-muted-foreground">
            <Headphones className="h-4 w-4" />
            <span>24/7 037-2339-9874</span>
          </div>

          <div className="flex-1 flex justify-center">
            <Link
              href="/"
              className="flex items-center gap-2 text-lg font-semibold md:text-base"
            >
              <Image src="/assets/logo-verse.png" width={170} height={40} alt="CardVerse logo" />
            </Link>
          </div>

          <div className="flex-1 flex items-center justify-end gap-2 text-sm font-medium">
            <CurrencySelector />
            <LanguageSelector />
            <div className="mx-2 h-6 w-px bg-white/50" />
            <NotificationBell />
            {renderUserAuth()}
          </div>
        </div>
      </div>
      <div className="border-t">
        <div className="container mx-auto px-4 flex h-16 items-center">
          <div className="md:hidden">
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
                    <Image src="/assets/logo-verse.png" width={120} height={30} alt="CardVerse logo" />
                  </Link>
                  <div className="relative group">
                    <span className="hover:text-foreground opacity-50 cursor-not-allowed flex items-center gap-1">
                      {t('nav_buy')}
                      <Badge variant="outline" className="text-[10px] h-4 px-1 border-orange-500 text-orange-500">{t('beta')}</Badge>
                    </span>
                  </div>
                  <div className="relative group">
                    <span className="text-muted-foreground opacity-50 cursor-not-allowed flex items-center gap-1">
                      {t('nav_sell')}
                      <Badge variant="outline" className="text-[10px] h-4 px-1 border-orange-500 text-orange-500">{t('beta')}</Badge>
                    </span>
                  </div>
                  <Link href="/bid" className="text-muted-foreground hover:text-foreground">
                    {t('nav_bid')}
                  </Link>
                  <Link href="/razz" className="text-muted-foreground hover:text-foreground">
                    {t('nav_razz')}
                  </Link>
                  <Link href="/forum" className="text-muted-foreground hover:text-foreground">
                    {t('nav_forum')}
                  </Link>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <nav className="hidden md:flex flex-row items-center gap-6 lg:gap-8 whitespace-nowrap text-sm font-medium">
              <div className="relative">
                <span
                  className="text-foreground/50 cursor-not-allowed flex items-center gap-1"
                >
                  {t('nav_buy')}
                  <Badge variant="outline" className="text-[10px] h-4 px-1 border-orange-500 text-orange-500">{t('beta')}</Badge>
                </span>
              </div>
              <div className="relative">
                <span
                  className="text-foreground/50 cursor-not-allowed flex items-center gap-1"
                >
                  {t('nav_sell')}
                  <Badge variant="outline" className="text-[10px] h-4 px-1 border-orange-500 text-orange-500">{t('beta')}</Badge>
                </span>
              </div>
              <Link
                href="/bid"
                className="text-foreground/80 transition-colors hover:text-foreground flex items-center gap-1"
              >
                {t('nav_bid')}
                <Badge variant="outline" className="text-[10px] h-4 px-1 border-orange-500 text-orange-500">{t('beta')}</Badge>
              </Link>
              <Link
                href="/razz"
                className="text-foreground/80 transition-colors hover:text-foreground flex items-center gap-1"
              >
                {t('nav_razz')}
                <Badge variant="outline" className="text-[10px] h-4 px-1 border-orange-500 text-orange-500">{t('soon')}</Badge>
              </Link>
              <Link
                href="/forum"
                className="text-foreground/80 transition-colors hover:text-foreground"
              >
                {t('nav_forum')}
              </Link>
            </nav>
          </div>
          <div className="flex-1 flex w-full items-center gap-4 md:ml-auto justify-end">
            <nav className="hidden md:flex items-center gap-2 text-sm font-medium">
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
            <Button onClick={handleListCardClick} className="bg-orange-500 hover:bg-orange-600 text-white font-bold whitespace-nowrap px-6">
              {t('list_a_card')}
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
