"use client";

import { useState, useRef } from "react";
import { useLocalization } from "@/context/localization-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Image as ImageIcon, X, MessageCircle, Wrench, UserPlus, Sparkles, Smile, MapPin, Loader2 } from "lucide-react";
import { useUser, useSupabase } from '@/lib/supabase';
import Image from "next/image";

interface CreatePostModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPost: (post: any) => void; // Using any for now to avoid strict type import issues, but should match ForumPost
}

export function CreatePostModal({ open, onOpenChange, onPost }: CreatePostModalProps) {
    const { t } = useLocalization();
    const { user, profile } = useUser();
    const [content, setContent] = useState("");
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [category, setCategory] = useState("discussion");
    const [isPosting, setIsPosting] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [location, setLocation] = useState("");
    const [showLocationInput, setShowLocationInput] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const supabase = useSupabase();

    const commonEmojis = ["😊", "😂", "❤️", "🔥", "👍", "🎉", "😍", "🤔", "💪", "✨", "🏆", "💯"];

    const insertEmoji = (emoji: string) => {
        setContent(prev => prev + emoji);
    };

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                setSelectedImage(event.target?.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    // Refactored handlePost to keep modal open on error
    const handlePostClick = async () => {
        if ((!content.trim() && !selectedImage) || !user) return;
        setIsPosting(true);
        try {
            await handlePostLogic();
            // Success
            setContent("");
            setSelectedImage(null);
            onOpenChange(false);
        } catch (error: any) {
            console.error(error);
            alert(`Error: ${error.message}`);
        } finally {
            setIsPosting(false);
        }
    };

    const handlePostLogic = async () => {
        let uploadedImageUrl = null;

        // Upload Image if exists
        const file = fileInputRef.current?.files?.[0];
        if (file) {
            const fileExt = file.name.split('.').pop();
            const fileName = `${user!.id}/${Math.random()}.${fileExt}`;
            const { error: uploadError } = await supabase.storage
                .from('forum-images')
                .upload(fileName, file);

            if (uploadError) {
                throw new Error(`Image upload failed: ${uploadError.message}`);
            } else {
                const { data: publicUrlData } = supabase.storage
                    .from('forum-images')
                    .getPublicUrl(fileName);
                uploadedImageUrl = publicUrlData.publicUrl;
            }
        }

        // Insert Post
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await supabase
            .from('forum_posts')
            .insert({
                user_id: user!.id,
                content: content,
                image_url: uploadedImageUrl,
                category: category === 'discussion' ? 'Discussion' :
                    category === 'card_care' ? 'Card Care' :
                        category === 'connect' ? 'Connect' : 'Showcase'
            } as any)
            .select(`
                    *,
                    author:profiles!user_id(display_name, profile_image_url, legit_rate)
                `)
            .single();

        if (error) {
            throw new Error(`Post creation failed: ${error.message}`);
        }

        if (data) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const postData = data as any;
            const newPost = {
                id: postData.id,
                title: "",
                content: postData.content,
                imageUrl: postData.image_url,
                category: postData.category,
                author: {
                    name: postData.author?.display_name || user!.email?.split('@')[0] || "User",
                    avatar: postData.author?.profile_image_url || "",
                    imageHint: "user",
                    rank: "Member",
                    isVerified: (postData.author?.legit_rate || 0) >= 90
                },
                likes: 0,
                comments: 0,
                shares: 0,
                createdAt: postData.created_at,
                isLiked: false
            };
            onPost(newPost);
        }
    };

    const displayName = profile?.display_name || user?.email?.split('@')[0] || "User";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg bg-[#1a1b1e] border-white/10 p-0 overflow-hidden max-h-[85vh] flex flex-col">
                <DialogHeader className="p-4 border-b border-white/5 shrink-0">
                    <DialogTitle className="text-center text-lg font-bold text-white">Create Post</DialogTitle>
                </DialogHeader>

                <div className="p-4 overflow-y-auto flex-1">
                    {/* User Info */}
                    <div className="flex items-center gap-3 mb-4">
                        <Avatar className="h-10 w-10 border border-white/10">
                            <AvatarImage src={profile?.profile_image_url || undefined} />
                            <AvatarFallback>{displayName[0]}</AvatarFallback>
                        </Avatar>
                        <div>
                            <p className="font-semibold text-white text-sm">{displayName}</p>
                            <Select value={category} onValueChange={setCategory}>
                                <SelectTrigger className="h-7 w-auto text-xs bg-white/5 border-white/10 text-gray-300 gap-1.5">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-[#252629] border-white/10">
                                    <SelectItem value="discussion" className="text-white">
                                        <div className="flex items-center gap-2">
                                            <MessageCircle className="h-3.5 w-3.5" />
                                            {t('post_category_discussion') || 'Discussion'}
                                        </div>
                                    </SelectItem>
                                    <SelectItem value="card_care" className="text-white">
                                        <div className="flex items-center gap-2">
                                            <Wrench className="h-3.5 w-3.5" />
                                            {t('post_category_card_care') || 'Card Care'}
                                        </div>
                                    </SelectItem>
                                    <SelectItem value="connect" className="text-white">
                                        <div className="flex items-center gap-2">
                                            <UserPlus className="h-3.5 w-3.5" />
                                            {t('post_category_connect') || 'Connect'}
                                        </div>
                                    </SelectItem>
                                    <SelectItem value="showcase" className="text-white">
                                        <div className="flex items-center gap-2">
                                            <Sparkles className="h-3.5 w-3.5" />
                                            {t('post_category_showcase') || 'Showcase'}
                                        </div>
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Content Area */}
                    <Textarea
                        placeholder={`What's on your mind, ${displayName.split(' ')[0]}?`}
                        className="min-h-[100px] bg-white/5 border border-white/10 rounded-xl text-white text-base placeholder:text-gray-500 resize-none focus-visible:ring-1 focus-visible:ring-primary/50 p-3"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        autoFocus
                    />

                    {/* Emoji Picker */}
                    {showEmojiPicker && (
                        <div className="mt-3 p-3 bg-white/5 rounded-xl border border-white/10">
                            <div className="flex flex-wrap gap-2">
                                {commonEmojis.map((emoji, i) => (
                                    <button
                                        key={i}
                                        onClick={() => insertEmoji(emoji)}
                                        className="text-xl hover:scale-125 transition-transform p-1"
                                    >
                                        {emoji}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Location Input */}
                    {showLocationInput && (
                        <div className="mt-3 flex items-center gap-2 p-3 bg-white/5 rounded-xl border border-white/10">
                            <MapPin className="h-4 w-4 text-red-500 shrink-0" />
                            <input
                                type="text"
                                placeholder={t('enter_location') || "Enter your location..."}
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                className="flex-1 bg-transparent text-white text-sm placeholder:text-gray-500 outline-none"
                            />
                            {location && (
                                <button onClick={() => setLocation("")} className="text-gray-400 hover:text-white">
                                    <X className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                    )}

                    {/* Selected Image Preview */}
                    {selectedImage && (
                        <div className="relative mt-3 rounded-xl overflow-hidden border border-white/10 bg-black/50">
                            <div className="relative w-full">
                                <Image
                                    src={selectedImage}
                                    alt="Selected"
                                    width={0}
                                    height={0}
                                    sizes="100vw"
                                    className="w-full h-auto max-h-[300px] object-contain"
                                />
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute top-2 right-2 h-8 w-8 bg-black/60 hover:bg-black/80 rounded-full"
                                onClick={() => setSelectedImage(null)}
                            >
                                <X className="h-4 w-4 text-white" />
                            </Button>
                        </div>
                    )}
                </div>

                {/* Action Bar */}
                <div className="p-4 border-t border-white/5 shrink-0">
                    <div className="flex items-center justify-between p-3 rounded-lg border border-white/10 mb-4">
                        <span className="text-sm text-white font-medium">Add to your post</span>
                        <div className="flex items-center gap-1">
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/*"
                                onChange={handleImageSelect}
                            />
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 rounded-full hover:bg-white/10"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <ImageIcon className="h-5 w-5 text-green-500" />
                            </Button>
                            <Button variant="ghost" size="icon" className={`h-9 w-9 rounded-full hover:bg-white/10 ${showEmojiPicker ? 'bg-white/10' : ''}`} onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
                                <Smile className="h-5 w-5 text-yellow-500" />
                            </Button>
                            <Button variant="ghost" size="icon" className={`h-9 w-9 rounded-full hover:bg-white/10 ${showLocationInput ? 'bg-white/10' : ''}`} onClick={() => setShowLocationInput(!showLocationInput)}>
                                <MapPin className="h-5 w-5 text-red-500" />
                            </Button>
                        </div>
                    </div>

                    <Button
                        className="w-full h-10 font-semibold"
                        disabled={(!content.trim() && !selectedImage) || isPosting}
                        onClick={handlePostClick}
                    >
                        {isPosting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Posting...
                            </>
                        ) : (
                            "Post"
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
