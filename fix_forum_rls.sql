-- Run this in your Supabase SQL Editor to enable public read access for forum posts

-- First, enable RLS on the table (if not already enabled)
ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read posts (public feed)
CREATE POLICY "Anyone can view forum posts" ON public.forum_posts
  FOR SELECT USING (true);

-- Allow authenticated users to insert their own posts
CREATE POLICY "Users can insert own posts" ON public.forum_posts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own posts
CREATE POLICY "Users can update own posts" ON public.forum_posts
  FOR UPDATE USING (auth.uid() = user_id);

-- Allow users to delete their own posts
CREATE POLICY "Users can delete own posts" ON public.forum_posts
  FOR DELETE USING (auth.uid() = user_id);
