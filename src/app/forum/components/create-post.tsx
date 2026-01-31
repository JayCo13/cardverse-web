"use client";

import { useState } from "react";
import { useLocalization } from "@/context/localization-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Image as ImageIcon, Smile, Video, Calendar, ShieldAlert } from "lucide-react";
import { useUser } from "@/lib/supabase";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuthModal } from "@/components/auth-modal";
import { CreatePostModal } from "./create-post-modal";

interface CreatePostBoxProps {
    onPostCreated?: (post: any) => void;
}

export function CreatePostBox({ onPostCreated }: CreatePostBoxProps) {
    const { t } = useLocalization();
    const { user, profile } = useUser();
    const { setOpen } = useAuthModal();
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Check Legit Rate
    const currentLegitRate = profile ? (profile.legit_rate ?? 100) : 0;
    const isEligible = currentLegitRate >= 90;

    if (!user) {
        return (
            <Card className="bg-[#1a1b1e] border-white/5 mb-6">
                <CardContent className="p-4 flex items-center justify-between">
                    <div>
                        <h3 className="font-semibold text-white">{t('auth_required_title')}</h3>
                        <p className="text-sm text-muted-foreground">{t('auth_required_desc_forum')}</p>
                    </div>
                    <Button onClick={() => setOpen(true)}>{t('log_in')}</Button>
                </CardContent>
            </Card>
        );
    }

    if (!isEligible) {
        return (
            <Alert variant="destructive" className="bg-red-900/10 border-red-900/20 mb-6">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Posting Restricted</AlertTitle>
                <AlertDescription>
                    Your reputation (Uy tín) is {currentLegitRate}%. You need at least 90% to post in the community forum.
                    Complete more successful trades to increase your score.
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <>
            <Card className="bg-[#1a1b1e] border-white/5 mb-6 overflow-hidden">
                <CardContent className="p-4">
                    <div className="flex gap-4 mb-4">
                        <Avatar className="h-10 w-10">
                            <AvatarImage src={profile?.profile_image_url || undefined} />
                            <AvatarFallback>{profile?.display_name?.[0] || user.email?.[0]}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                            <div
                                className="bg-white/5 hover:bg-white/10 transition-colors rounded-3xl h-10 flex items-center px-4 cursor-pointer text-gray-400 text-sm w-full"
                                onClick={() => setIsModalOpen(true)}
                            >
                                What's on your mind, {profile?.display_name?.split(' ')[0] || "Trader"}?
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-white/5 px-2">
                        <div className="flex gap-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-gray-400 hover:text-green-400 gap-2 rounded-full"
                                onClick={() => setIsModalOpen(true)}
                            >
                                <ImageIcon className="h-5 w-5 text-green-500" />
                                <span className="hidden sm:inline">Photo/Video</span>
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-gray-400 hover:text-yellow-400 gap-2 rounded-full"
                                onClick={() => setIsModalOpen(true)}
                            >
                                <Smile className="h-5 w-5 text-yellow-500" />
                                <span className="hidden sm:inline">Feeling/Activity</span>
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Create Post Modal */}
            <CreatePostModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onPost={(post) => {
                    if (onPostCreated) onPostCreated(post);
                }}
            />
        </>
    );
}

