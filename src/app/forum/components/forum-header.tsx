"use client";

import { useLocalization } from "@/context/localization-context";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageSquare } from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useUser } from "@/lib/supabase";

export function ForumHeader() {
    const { t } = useLocalization();
    const { user, profile } = useUser();

    return (
        <header className="fixed top-0 left-0 right-0 h-16 border-b border-white/5 bg-black/95 backdrop-blur-sm z-50 flex items-center justify-between px-4 lg:px-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" className="md:hidden">
                    {/* Mobile Menu Trigger - to be implemented if needed, for now hidden */}
                    <MessageSquare className="h-5 w-5" />
                </Button>

                <Link href="/" className="flex items-center gap-2 group">
                    <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/20 transition-colors">
                        <ArrowLeft className="h-4 w-4 text-white" />
                    </div>
                    <span className="hidden sm:inline font-medium text-gray-300 group-hover:text-white transition-colors">
                        Back to CardVerse
                    </span>
                </Link>

                <div className="h-6 w-px bg-white/10 mx-2 hidden sm:block" />

                <h1 className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent" style={{ fontFamily: "'Orbitron', sans-serif" }}>
                    Community Forum
                </h1>
            </div>

            <div className="flex items-center gap-4">
                {user ? (
                    <Link href="/forum/profile" className="flex items-center gap-3 hover:bg-white/5 py-1.5 px-3 rounded-full transition-colors border border-transparent hover:border-white/10">
                        <div className="text-right hidden md:block">
                            <p className="text-sm font-medium text-white leading-none">{profile?.display_name || user.email?.split('@')[0]}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {profile?.legit_rate ? `${profile.legit_rate}% Legit` : 'New Member'}
                            </p>
                        </div>
                        <Avatar className="h-8 w-8 border border-white/10">
                            <AvatarImage src={profile?.profile_image_url || undefined} />
                            <AvatarFallback>{profile?.display_name?.[0] || user.email?.[0]}</AvatarFallback>
                        </Avatar>
                    </Link>
                ) : (
                    <Button variant="outline" size="sm" asChild>
                        <Link href="/login">Login</Link>
                    </Button>
                )}
            </div>
        </header>
    );
}
