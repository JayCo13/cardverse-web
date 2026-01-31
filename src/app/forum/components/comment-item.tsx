"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { enUS, vi } from "date-fns/locale";
import { useLocalization } from "@/context/localization-context";
import { Heart, MessageCircle, Reply, CornerDownRight, MoreHorizontal, Flag, Trash2 } from "lucide-react";
import { useState } from "react";
import { useUser, useSupabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface Comment {
    id: string;
    content: string;
    user_id: string;
    created_at: string;
    parent_id: string | null;
    author: {
        display_name: string;
        profile_image_url: string | null;
    };
    replies?: Comment[];
    likes_count?: number;
    user_has_liked?: boolean;
}

interface CommentItemProps {
    comment: Comment;
    onReply: (parentId: string, content: string) => Promise<void>;
    onLike: (commentId: string, isLiked: boolean) => Promise<void>;
    onDelete?: (commentId: string) => Promise<void>;
}

export function CommentItem({ comment, onReply, onLike, onDelete }: CommentItemProps) {
    const { locale } = useLocalization();
    const dateLocale = locale === 'vi-VN' ? vi : enUS;
    const { user } = useUser();

    const [isReplying, setIsReplying] = useState(false);
    const [replyContent, setReplyContent] = useState("");
    const [isLiked, setIsLiked] = useState(comment.user_has_liked || false);
    const [likesCount, setLikesCount] = useState(comment.likes_count || 0);

    const handleLike = async () => {
        if (!user) return;
        const newIsLiked = !isLiked;
        setIsLiked(newIsLiked);
        setLikesCount(prev => newIsLiked ? prev + 1 : prev - 1);
        await onLike(comment.id, newIsLiked);
    };

    const handleSubmitReply = async () => {
        if (!replyContent.trim()) return;
        await onReply(comment.id, replyContent);
        setIsReplying(false);
        setReplyContent("");
    };

    return (
        <div className="group">
            <div className="flex gap-3">
                <Avatar className="h-8 w-8 border border-white/10 shrink-0 mt-0.5">
                    <AvatarImage src={comment.author?.profile_image_url || undefined} />
                    <AvatarFallback>{comment.author?.display_name?.[0] || 'U'}</AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                    {/* Comment Bubble */}
                    <div className="bg-[#2a2b2f]/80 hover:bg-[#2a2b2f] transition-colors rounded-2xl px-4 py-3 relative group/bubble">
                        <div className="flex items-center gap-2 mb-1 justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="font-semibold text-white/90 text-sm truncate">
                                    {comment.author?.display_name || 'User'}
                                </span>
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                                    {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: dateLocale })}
                                </span>
                            </div>

                            {/* Dropdown for Delete/Report */}
                            {user && (user.id === comment.user_id || onDelete) && (
                                <div className="opacity-0 group-hover/bubble:opacity-100 transition-opacity">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 text-white hover:text-white">
                                                <MoreHorizontal className="h-3 w-3" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="bg-[#1a1b1e] border-white/10">
                                            {user.id === comment.user_id && onDelete && (
                                                <DropdownMenuItem
                                                    className="text-red-400 focus:text-red-400 focus:bg-red-500/10 cursor-pointer"
                                                    onClick={() => onDelete(comment.id)}
                                                >
                                                    <Trash2 className="h-4 w-4 mr-2" />
                                                    Delete
                                                </DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem className="text-gray-400 focus:text-white focus:bg-white/10 cursor-pointer">
                                                <Flag className="h-4 w-4 mr-2" />
                                                Report
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            )}
                        </div>

                        <p className="text-gray-300 text-sm whitespace-pre-wrap leading-relaxed">
                            {comment.content}
                        </p>
                    </div>

                    {/* Action Bar */}
                    <div className="flex items-center gap-4 mt-1 pl-2">
                        <button
                            onClick={handleLike}
                            className={cn(
                                "flex items-center gap-1.5 text-xs font-medium transition-colors hover:text-blue-400",
                                isLiked ? "text-blue-400" : "text-muted-foreground"
                            )}
                        >
                            <Heart className={cn("h-3.5 w-3.5", isLiked && "fill-current")} />
                            {likesCount > 0 && <span>{likesCount}</span>}
                            <span>Like</span>
                        </button>

                        <button
                            onClick={() => setIsReplying(!isReplying)}
                            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-white transition-colors"
                        >
                            <Reply className="h-3.5 w-3.5" />
                            Reply
                        </button>
                    </div>

                    {/* Reply Input */}
                    {isReplying && (
                        <div className="mt-3 flex gap-2 animate-in slide-in-from-top-2 fade-in duration-200">
                            <div className="relative flex-1">
                                <Input
                                    autoFocus
                                    placeholder={`Reply to ${comment.author?.display_name}...`}
                                    className="bg-white/5 border-white/10 text-white text-sm h-9 min-h-[36px] pr-9"
                                    value={replyContent}
                                    onChange={(e) => setReplyContent(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmitReply()}
                                />
                                <Button
                                    size="icon"
                                    className="absolute right-0.5 top-0.5 h-8 w-8 hover:bg-white/10 text-blue-500 bg-transparent"
                                    onClick={handleSubmitReply}
                                    disabled={!replyContent.trim()}
                                >
                                    <CornerDownRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Nested Replies */}
                    {comment.replies && comment.replies.length > 0 && (
                        <div className="mt-3 space-y-4 pl-3 border-l-2 border-white/5">
                            {comment.replies.map(reply => (
                                <CommentItem
                                    key={reply.id}
                                    comment={reply}
                                    onReply={onReply}
                                    onLike={onLike}
                                    onDelete={onDelete}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
