"use client";

import { useState, useEffect } from "react";
import { useLocalization } from "@/context/localization-context";
import { ForumSidebar } from "../components/sidebar";
import { RightPanel } from "../components/right-panel";
import { ForumHeader } from "../components/forum-header";
import { PostCard } from "../components/post-card";
import { ForumPost } from "@/lib/types";
import { forumPosts as allPosts } from "@/lib/forum-data";
import { useUser, useSupabase } from "@/lib/supabase";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, MapPin, Calendar, Link as LinkIcon, Edit, Crown } from "lucide-react";
import { format } from "date-fns";
import Image from "next/image";

export default function ForumProfilePage() {
    const { t } = useLocalization();
    const { user, profile } = useUser();
    const [userPosts, setUserPosts] = useState<ForumPost[]>([]);
    const supabase = useSupabase();

    useEffect(() => {
        const fetchUserPosts = async () => {
            if (!user) return;

            const { data, error } = await supabase
                .from('forum_posts')
                .select(`
                  *,
                  author:profiles!user_id(display_name, profile_image_url, legit_rate),
                  forum_likes(user_id)
                `)
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });

            if (data) {
                const formattedPosts: ForumPost[] = data.map((post: any) => ({
                    id: post.id,
                    title: post.content.substring(0, 50),
                    content: post.content,
                    imageUrl: post.image_url,
                    category: post.category || 'General',
                    author: {
                        name: post.author?.display_name || user.email?.split('@')[0] || 'User',
                        avatar: post.author?.profile_image_url || '',
                        imageHint: 'user',
                        rank: 'Member',
                        isVerified: (post.author?.legit_rate || 0) >= 90
                    },
                    likes: post.forum_likes?.length || 0,
                    comments: 0,
                    shares: 0,
                    createdAt: post.created_at,
                    isLiked: user ? post.forum_likes?.some((like: any) => like.user_id === user.id) : false
                }));
                setUserPosts(formattedPosts);
            }
        };

        fetchUserPosts();
    }, [user, supabase]);

    const displayName = profile?.display_name || user?.email?.split('@')[0] || "User";
    const joinDate = user?.created_at ? format(new Date(user.created_at), 'MMMM yyyy') : "January 2025";

    return (
        <div className="flex flex-col min-h-screen bg-black/95">
            <ForumHeader />

            <div className="flex flex-1 pt-16 relative">
                <ForumSidebar />

                {/* Wrapper to handle sidebar spacing */}
                <div className="flex-1 w-full lg:ml-64 xl:ml-72 xl:mr-80 min-h-screen transition-all duration-300">
                    <main className="max-w-3xl mx-auto px-0 pb-20">
                        {/* Cover Image */}
                        <div className="relative h-48 md:h-64 w-full bg-gradient-to-r from-purple-900/50 to-blue-900/50">
                            {/* <Image src="/cover-placeholder.jpg" fill className="object-cover" alt="Cover" /> */}
                            <div className="absolute inset-0 bg-black/20" />
                        </div>

                        {/* Profile Info Section */}
                        <div className="px-4 relative -mt-16 mb-4">
                            <div className="flex flex-col md:flex-row items-start gap-4">
                                {/* Large Avatar */}
                                <div className="relative">
                                    <div className="h-32 w-32 rounded-full border-4 border-black bg-[#1a1b1e] overflow-hidden">
                                        <Avatar className="h-full w-full">
                                            <AvatarImage src={profile?.profile_image_url || undefined} />
                                            <AvatarFallback className="text-4xl">{displayName[0]?.toUpperCase()}</AvatarFallback>
                                        </Avatar>
                                    </div>
                                    {/* Online Status / Rank Badge could go here */}
                                </div>

                                {/* Names and Actions */}
                                <div className="flex-1 mt-2 md:mt-16 w-full">
                                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h1 className="text-2xl font-bold text-white">{displayName}</h1>
                                                {profile?.legit_rate && profile.legit_rate >= 90 && (
                                                    <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border-blue-500/20 gap-1">
                                                        <Crown className="h-3 w-3" />
                                                        Verified Trader
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-muted-foreground">@{user?.email?.split('@')[0]}</p>
                                        </div>
                                        <Button variant="outline" className="gap-2">
                                            <Edit className="h-4 w-4" />
                                            Edit Profile
                                        </Button>
                                    </div>

                                    {/* Stats Grid */}
                                    <div className="flex gap-6 mt-4 text-sm">
                                        <div className="flex gap-1">
                                            <span className="font-bold text-white">{userPosts.length}</span>
                                            <span className="text-muted-foreground">Posts</span>
                                        </div>
                                        <div className="flex gap-1">
                                            <span className="font-bold text-white">1.2k</span>
                                            <span className="text-muted-foreground">Followers</span>
                                        </div>
                                        <div className="flex gap-1">
                                            <span className="font-bold text-white">450</span>
                                            <span className="text-muted-foreground">Following</span>
                                        </div>
                                        <div className="flex gap-1 items-center text-green-400">
                                            <Shield className="h-3.5 w-3.5 mr-1" />
                                            <span className="font-bold">{profile?.legit_rate ?? 100}%</span>
                                            <span className="text-muted-foreground ml-1">Legit</span>
                                        </div>
                                    </div>

                                    {/* Bio / Details */}
                                    <div className="mt-4 text-sm text-gray-300 max-w-2xl">
                                        Pokemon & One Piece TCG Collector. Always looking for rare Charizards and Nami Alt Arts. Based in HCMC.
                                    </div>

                                    <div className="flex flex-wrap gap-4 mt-3 text-xs text-muted-foreground">
                                        <div className="flex items-center gap-1">
                                            <MapPin className="h-3.5 w-3.5" />
                                            Ho Chi Minh City
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <LinkIcon className="h-3.5 w-3.5" />
                                            <a href="#" className="hover:text-primary transition-colors">cardverse.com/user</a>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Calendar className="h-3.5 w-3.5" />
                                            Joined {joinDate}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Content Tabs */}
                        <div className="px-4 mt-6">
                            <Tabs defaultValue="posts" className="w-full">
                                <TabsList className="w-full justify-start border-b border-white/10 bg-transparent p-0 h-auto rounded-none mb-4">
                                    <TabsTrigger
                                        value="posts"
                                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 pb-3 pt-2 font-medium"
                                    >
                                        Posts
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="replies"
                                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 pb-3 pt-2 font-medium"
                                    >
                                        Replies
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="media"
                                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 pb-3 pt-2 font-medium"
                                    >
                                        Media
                                    </TabsTrigger>
                                    <TabsTrigger
                                        value="likes"
                                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 pb-3 pt-2 font-medium"
                                    >
                                        Likes
                                    </TabsTrigger>
                                </TabsList>

                                <TabsContent value="posts" className="space-y-4">
                                    {userPosts.map((post) => (
                                        <PostCard key={post.id} post={post} />
                                    ))}
                                    {userPosts.length === 0 && (
                                        <div className="text-center py-12 text-muted-foreground">
                                            No posts yet.
                                        </div>
                                    )}
                                </TabsContent>

                                {/* Other tabs can be empty placeholders for now */}
                                <TabsContent value="replies">
                                    <div className="text-center py-12 text-muted-foreground">No replies yet.</div>
                                </TabsContent>
                            </Tabs>
                        </div>

                    </main>
                </div>

                <RightPanel />
            </div>
        </div>
    );
}
