'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import {
  ForumPost
} from '@/lib/types';
import { useLocalization } from '@/context/localization-context';
import { ForumSidebar } from './components/sidebar';
import { CreatePostBox } from './components/create-post';
import { PostCard } from './components/post-card';
import { RightPanel } from './components/right-panel';
import Link from 'next/link';
import { useSupabase, useUser } from '@/lib/supabase';

import { ForumHeader } from './components/forum-header';

export default function ForumPage() {
  const { t, locale } = useLocalization();
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = useSupabase();
  const { user } = useUser();
  const fetchAttemptRef = useRef(0);
  const maxRetries = 3;
  const copy = locale === 'vi-VN'
    ? {
      failedToLoad: 'Không thể tải bài viết',
      loadingFeed: 'Đang tải bảng tin...',
      retry: 'Thử lại',
      noPosts: 'Chưa có bài viết nào. Hãy là người đầu tiên chia sẻ!',
      endOfFeed: 'Bạn đã xem hết',
      anonymous: 'Người dùng ẩn danh',
      loadFailedFallback: 'Không thể tải bài viết',
    }
    : locale === 'ja-JP'
      ? {
        failedToLoad: '投稿を読み込めません',
        loadingFeed: 'フィードを読み込み中...',
        retry: '再試行',
        noPosts: 'まだ投稿がありません。最初に投稿してみましょう！',
        endOfFeed: 'ここまでです',
        anonymous: '匿名ユーザー',
        loadFailedFallback: '投稿を読み込めません',
      }
      : {
        failedToLoad: 'Failed to load posts',
        loadingFeed: 'Loading feed...',
        retry: 'Retry',
        noPosts: 'No posts yet. Be the first to share something!',
        endOfFeed: "You've reached the end",
        anonymous: 'Anonymous user',
        loadFailedFallback: 'Failed to load posts',
      };

  const fetchPosts = useCallback(async (isRetry = false) => {
    if (!isRetry) {
      fetchAttemptRef.current = 0;
    }

    console.log('[ForumPage] Fetching posts... Attempt:', fetchAttemptRef.current + 1);

    try {
      if (posts.length === 0) {
        setIsLoading(true);
      }
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('forum_posts')
        .select(`
          *,
          author:profiles!user_id(display_name, profile_image_url, legit_rate),
          forum_likes(user_id),
          forum_comments(id)
        `)
        .order('created_at', { ascending: false });

      if (fetchError) {
        console.error('[ForumPage] Supabase error:', fetchError.message);

        // Retry logic
        if (fetchAttemptRef.current < maxRetries) {
          fetchAttemptRef.current++;
          console.log('[ForumPage] Retrying in 1 second...');
          setTimeout(() => fetchPosts(true), 1000);
          return;
        }

        setError(fetchError.message);
        setIsLoading(false);
        return;
      }

      console.log('[ForumPage] Data fetched:', data?.length || 0, 'posts');
      if (data && data.length > 0) {
        const firstPost = data[0] as any;
        console.log('[ForumPage] Sample post:', {
          id: firstPost.id,
          likes: firstPost.forum_likes,
          comments: firstPost.forum_comments
        });
      }

      if (data) {
        const formattedPosts: ForumPost[] = data.map((post: any) => ({
          id: post.id,
          title: '',
          content: post.content || '',
          imageUrl: post.image_url,
          category: post.category || 'General',
          author: {
            name: post.author?.display_name || copy.anonymous,
            avatar: post.author?.profile_image_url || '',
            imageHint: 'user',
            rank: 'Member',
            isVerified: (post.author?.legit_rate || 0) >= 90
          },
          likes: Array.isArray(post.forum_likes) ? post.forum_likes.length : 0,
          comments: Array.isArray(post.forum_comments) ? post.forum_comments.length : 0,
          shares: 0,
          createdAt: post.created_at,
          isLiked: user ? (Array.isArray(post.forum_likes) ? post.forum_likes.some((like: any) => like.user_id === user.id) : false) : false
        }));
        setPosts(formattedPosts);
      }
    } catch (err: any) {
      console.error('[ForumPage] Unexpected error:', err);
      setError(err.message || copy.loadFailedFallback);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, posts.length, user, copy.anonymous, copy.loadFailedFallback]);

  // Fetch immediately on mount - no dependency on user since posts are public
  useEffect(() => {
    fetchPosts();
  }, []); // Only run once on mount

  return (
    <div className="flex flex-col min-h-screen bg-black/95">
      <ForumHeader />

      {/* Main Layout Container */}
      <div className="flex flex-1 pt-16 relative">

        {/* Left Sidebar */}
        <ForumSidebar />

        {/* Center Feed */}
        <div className="flex-1 w-full lg:ml-64 xl:ml-72 xl:mr-80 min-h-screen transition-all duration-300">
          <main className="max-w-2xl mx-auto px-4 py-4 pb-20">
            {/* Create Post Area */}
            <CreatePostBox onPostCreated={(newPost) => setPosts([newPost, ...posts])} />

            {/* Posts Feed */}
            <div className="space-y-4">
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">{copy.loadingFeed}</div>
              ) : error ? (
                <div className="text-center py-8">
                  <p className="text-red-400 mb-4">{copy.failedToLoad}: {error}</p>
                  <Button variant="outline" onClick={() => fetchPosts()}>
                    {copy.retry}
                  </Button>
                </div>
              ) : posts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">{copy.noPosts}</div>
              ) : (
                posts.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))
              )}
            </div>

            {/* End of Feed */}
            {!isLoading && !error && posts.length > 0 && (
              <div className="flex justify-center py-8">
                <span className="text-muted-foreground text-sm">{copy.endOfFeed}</span>
              </div>
            )}
          </main>
        </div>

        {/* Right Sidebar */}
        <RightPanel />
      </div>
    </div>
  );
}
