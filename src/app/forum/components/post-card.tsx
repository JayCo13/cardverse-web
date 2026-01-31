"use client";

import { useLocalization } from "@/context/localization-context";
import { ForumPost } from "@/lib/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MoreHorizontal, ThumbsUp, MessageCircle, Crown, CheckCircle2, Shield, Send } from "lucide-react";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { enUS, vi } from "date-fns/locale";
import { useState, useEffect } from "react";
import { useUser, useSupabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";

import { CommentItem, type Comment } from "./comment-item";

interface PostCardProps {
    post: ForumPost;
}

// Helper to build comment tree
function buildCommentTree(comments: Comment[]): Comment[] {
    const commentMap = new Map<string, Comment>();
    const roots: Comment[] = [];

    // First pass: map everything and initialize replies
    comments.forEach(c => {
        commentMap.set(c.id, { ...c, replies: [] });
    });

    // Second pass: link children to parents
    comments.forEach(c => {
        const comment = commentMap.get(c.id)!;
        if (c.parent_id && commentMap.has(c.parent_id)) {
            commentMap.get(c.parent_id)!.replies!.push(comment);
        } else {
            roots.push(comment);
        }
    });

    return roots;
}

export function PostCard({ post }: PostCardProps) {
    const { t, locale } = useLocalization();
    const dateLocale = locale === 'vi-VN' ? vi : enUS;
    const { user, profile } = useUser();
    const supabase = useSupabase();

    const [isLiked, setIsLiked] = useState(post.isLiked);
    const [likesCount, setLikesCount] = useState<number>(post.likes);
    const [showComments, setShowComments] = useState(false);
    const [comments, setComments] = useState<Comment[]>([]);
    const [newComment, setNewComment] = useState("");
    const [isLoadingComments, setIsLoadingComments] = useState(false);
    const [commentsCount, setCommentsCount] = useState<number>(post.comments || 0);

    const handleLike = async () => {
        if (!user) return; // Prevent if not logged in

        // Optimistic update
        const newIsLiked = !isLiked;
        setIsLiked(newIsLiked);
        setLikesCount(prev => newIsLiked ? prev + 1 : prev - 1);

        try {
            if (newIsLiked) {
                await supabase
                    .from('forum_likes')
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .insert({ post_id: post.id, user_id: user.id } as any);
            } else {
                await supabase
                    .from('forum_likes')
                    .delete()
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .match({ post_id: post.id, user_id: user.id } as any);
            }
        } catch (error) {
            console.error('Error toggling like:', error);
            // Revert on error
            setIsLiked(!newIsLiked);
            setLikesCount(prev => newIsLiked ? prev - 1 : prev + 1);
        }
    };

    const fetchComments = async () => {
        try {
            setIsLoadingComments(true);
            const { data, error } = await supabase
                .from('forum_comments')
                .select(`
                    *,
                    author:profiles!user_id(display_name, profile_image_url),
                    replies:forum_comments!parent_id(count),
                    reactions:forum_comment_reactions(count)
                `)
                .eq('post_id', post.id)
                .order('created_at', { ascending: true });

            if (error) throw error;

            let myReactions: string[] = [];
            if (user && data && data.length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const commentIds = (data as any[]).map(c => c.id);
                const { data: reactionsData } = await supabase
                    .from('forum_comment_reactions')
                    .select('comment_id')
                    .eq('user_id', user.id)
                    .in('comment_id', commentIds);

                if (reactionsData) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    myReactions = (reactionsData as any[]).map(r => r.comment_id);
                }
            }

            // Map data to maintain types and build tree
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rawComments = ((data || []) as any[]).map(item => ({
                ...item,
                replies: [],
                // Map count from the relation
                likes_count: item.reactions?.[0]?.count || 0,
                user_has_liked: myReactions.includes(item.id)
            })) as Comment[];

            setComments(buildCommentTree(rawComments));
        } catch (error) {
            console.error('Error fetching comments:', error);
        } finally {
            setIsLoadingComments(false);
        }
    };

    const handleCommentClick = () => {
        if (!showComments) {
            fetchComments();
        }
        setShowComments(!showComments);
    };

    const handleAddComment = async (parentId?: string, content: string = newComment) => {
        if (!content.trim() || !user) return;

        try {
            const { data, error } = await supabase
                .from('forum_comments')
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .insert({
                    post_id: post.id,
                    user_id: user.id,
                    content: content.trim(),
                    parent_id: parentId || null
                } as any)
                .select(`
                    *,
                    author:profiles!user_id(display_name, profile_image_url)
                `)
                .single();

            if (error) throw error;

            if (data) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const newCommentObj = { ...(data as any), replies: [], likes_count: 0, user_has_liked: false } as Comment;

                // If it's a root comment, just add it to list
                if (!parentId) {
                    setComments(prev => [...prev, newCommentObj]);
                    setNewComment("");
                } else {
                    // If it's a reply, we need to rebuild the tree or find the parent
                    // Ideally we re-fetch, but for simple optimistic update we can try to append
                    // Re-fetching is safer for tree consistency
                    fetchComments();
                }
                setCommentsCount(prev => prev + 1);
            }
        } catch (error) {
            console.error('Error adding comment:', error);
        }
    };

    // Handler for liking a comment
    const handleLikeComment = async (commentId: string, liked: boolean) => {
        if (!user) return;
        try {
            if (liked) {
                await supabase
                    .from('forum_comment_reactions')
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .insert({
                        comment_id: commentId,
                        user_id: user.id,
                        reaction_type: 'like'
                    } as any);
            } else {
                await supabase
                    .from('forum_comment_reactions')
                    .delete()
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .match({
                        comment_id: commentId,
                        user_id: user.id
                    } as any);
            }
        } catch (error) {
            console.error('Error liking comment:', error);
        }
    };

    const handleDeleteComment = async (commentId: string) => {
        try {
            const { error } = await supabase
                .rpc('delete_forum_comment', { comment_id_param: commentId });

            if (error) throw error;

            // Remove from UI
            // Simple approach: re-fetch to ensure tree integrity
            fetchComments();
            setCommentsCount(prev => Math.max(0, prev - 1));
        } catch (error) {
            console.error('Error deleting comment:', error);
        }
    };

    return (
        <Card className="bg-[#1a1b1e] border-white/5 overflow-hidden">
            <CardHeader className="p-4 flex flex-row items-start gap-3">
                <Avatar className="h-10 w-10 border border-white/10">
                    <AvatarImage src={post.author.avatar} />
                    <AvatarFallback>{post.author.name[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-white hover:underline cursor-pointer">
                            {post.author.name}
                        </span>
                        {post.author.isVerified && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 fill-blue-500/10" />
                        )}
                        {post.author.rank && (
                            <Badge variant="outline" className={`h-5 px-1.5 text-[10px] gap-1 ${post.author.rank === 'Diamond' ? 'text-purple-400 border-purple-500/30 bg-purple-500/10' :
                                post.author.rank === 'Gold' ? 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10' :
                                    'text-muted-foreground border-white/10'
                                }`}>
                                <Crown className="h-2.5 w-2.5" />
                                {post.author.rank}
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true, locale: dateLocale })}</span>
                        <span>•</span>
                        <div className="flex items-center gap-1">
                            <Shield className="h-3 w-3" />
                            <span>{post.category}</span>
                        </div>
                    </div>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground shrink-0">
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </CardHeader>

            <CardContent className="p-4 pt-0">
                <p className="text-sm sm:text-base text-gray-300 whitespace-pre-line leading-relaxed mb-4">
                    {post.content}
                </p>

                {post.imageUrl && (
                    <div className="relative w-full rounded-xl overflow-hidden bg-black/50 border border-white/5 mb-2 cursor-pointer">
                        <Image
                            src={post.imageUrl}
                            alt="Post content"
                            width={0}
                            height={0}
                            sizes="100vw"
                            className="w-full h-auto max-h-[500px] object-contain"
                        />
                    </div>
                )}
            </CardContent>

            <CardFooter className="p-2 border-t border-white/5 flex flex-col items-stretch gap-2">
                <div className="grid grid-cols-2 gap-1 w-full">
                    <Button
                        variant="ghost"
                        className={`flex items-center gap-2 hover:bg-white/5 ${isLiked ? 'text-blue-500' : 'text-gray-400'}`}
                        onClick={handleLike}
                    >
                        <ThumbsUp className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
                        <span className="text-sm font-medium">{likesCount || "Like"}</span>
                    </Button>
                    <Button
                        variant="ghost"
                        className={`flex items-center gap-2 hover:bg-white/5 ${showComments ? 'text-blue-500' : 'text-gray-400'}`}
                        onClick={handleCommentClick}
                    >
                        <MessageCircle className="h-4 w-4" />
                        <span className="text-sm font-medium">{commentsCount || "Comment"}</span>
                    </Button>
                </div>

                {/* Comments Section */}
                {showComments && (
                    <div className="w-full pt-2 border-t border-white/5 animate-in slide-in-from-top-2">
                        {/* Comment Input */}
                        <div className="flex gap-2 mb-4 px-2">
                            <Avatar className="h-8 w-8 border border-white/10 shrink-0">
                                <AvatarImage src={profile?.profile_image_url || undefined} />
                                <AvatarFallback>{profile?.display_name?.[0] || 'U'}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 relative">
                                <Input
                                    placeholder="Write a comment..."
                                    className="bg-white/5 border-white/10 text-white pr-10 min-h-[40px]"
                                    value={newComment}
                                    onChange={(e) => setNewComment(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAddComment(undefined, newComment)}
                                />
                                <Button
                                    size="icon"
                                    className="absolute right-1 top-1 h-8 w-8 bg-transparent hover:bg-white/10 text-blue-500"
                                    onClick={() => handleAddComment(undefined, newComment)}
                                    disabled={!newComment.trim()}
                                >
                                    <Send className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        {/* Comments List */}
                        <div className="space-y-4 max-h-[500px] overflow-y-auto px-2 custom-scrollbar">
                            {isLoadingComments ? (
                                <div className="text-center text-xs text-muted-foreground py-2">Loading comments...</div>
                            ) : comments.length === 0 ? (
                                <div className="text-center text-xs text-muted-foreground py-2">No comments yet.</div>
                            ) : (
                                comments.map((comment) => (
                                    <CommentItem
                                        key={comment.id}
                                        comment={comment}
                                        onReply={handleAddComment}
                                        onLike={handleLikeComment}
                                        onDelete={handleDeleteComment}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                )}
            </CardFooter>
        </Card>
    );
}
