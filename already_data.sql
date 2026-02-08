-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.albums (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  cover_image_url text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT albums_pkey PRIMARY KEY (id),
  CONSTRAINT albums_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.cancellations (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT cancellations_pkey PRIMARY KEY (id),
  CONSTRAINT cancellations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT cancellations_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id)
);
CREATE TABLE public.cards (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  image_url text,
  image_urls ARRAY,
  category text NOT NULL,
  condition text,
  listing_type text NOT NULL CHECK (listing_type = ANY (ARRAY['sale'::text, 'auction'::text, 'razz'::text])),
  price bigint,
  current_bid bigint,
  starting_bid bigint,
  auction_ends timestamp with time zone,
  ticket_price bigint,
  razz_entries integer,
  total_tickets integer,
  seller_id uuid NOT NULL,
  description text,
  last_sold_price bigint,
  status text DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'sold'::text, 'expired'::text, 'in_transaction'::text])),
  publisher text,
  season text,
  quantity integer DEFAULT 1,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  ebay_id text UNIQUE,
  CONSTRAINT cards_pkey PRIMARY KEY (id),
  CONSTRAINT cards_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.crawled_cards (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text,
  image_url text,
  category text,
  listing_type text,
  price bigint,
  seller_id uuid,
  description text,
  ebay_id text UNIQUE,
  raw_data jsonb,
  created_at timestamp with time zone DEFAULT now(),
  set_name text,
  year text,
  card_number text,
  grader text,
  grade text,
  player_name text,
  metadata jsonb DEFAULT '{}'::jsonb,
  fts tsvector DEFAULT to_tsvector('english'::regconfig, ((name || ' '::text) || COALESCE(description, ''::text))),
  CONSTRAINT crawled_cards_pkey PRIMARY KEY (id)
);
CREATE TABLE public.forum_comment_reactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL,
  user_id uuid NOT NULL,
  reaction_type character varying NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT forum_comment_reactions_pkey PRIMARY KEY (id),
  CONSTRAINT forum_comment_reactions_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.forum_comments(id),
  CONSTRAINT forum_comment_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.forum_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  parent_id uuid,
  CONSTRAINT forum_comments_pkey PRIMARY KEY (id),
  CONSTRAINT forum_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.forum_posts(id),
  CONSTRAINT forum_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT forum_comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.forum_comments(id)
);
CREATE TABLE public.forum_likes (
  post_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT forum_likes_pkey PRIMARY KEY (post_id, user_id),
  CONSTRAINT forum_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.forum_posts(id),
  CONSTRAINT forum_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.forum_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  type character varying NOT NULL CHECK (type::text = ANY (ARRAY['post_like'::character varying, 'comment'::character varying, 'comment_reply'::character varying]::text[])),
  post_id uuid,
  comment_id uuid,
  email_sent boolean DEFAULT false,
  email_sent_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT forum_notifications_pkey PRIMARY KEY (id),
  CONSTRAINT forum_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT forum_notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id),
  CONSTRAINT forum_notifications_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.forum_posts(id),
  CONSTRAINT forum_notifications_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.forum_comments(id)
);
CREATE TABLE public.forum_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  content text NOT NULL,
  image_url text,
  category text DEFAULT 'General'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT forum_posts_pkey PRIMARY KEY (id),
  CONSTRAINT forum_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.friendships (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL,
  addressee_id uuid NOT NULL,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT friendships_pkey PRIMARY KEY (id),
  CONSTRAINT friendships_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.user_profiles(id),
  CONSTRAINT friendships_addressee_id_fkey FOREIGN KEY (addressee_id) REFERENCES public.user_profiles(id)
);
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  card_id uuid,
  offer_id uuid,
  read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT notifications_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id)
);
CREATE TABLE public.offers (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  card_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  price bigint NOT NULL,
  message text,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'chosen'::text])),
  transaction_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT offers_pkey PRIMARY KEY (id),
  CONSTRAINT offers_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id),
  CONSTRAINT offers_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text NOT NULL,
  display_name text,
  phone_number text,
  address text,
  city text,
  profile_image_url text,
  legit_rate integer DEFAULT 100,
  total_transactions integer DEFAULT 0,
  completed_transactions integer DEFAULT 0,
  cancelled_transactions integer DEFAULT 0,
  daily_cancellations integer DEFAULT 0,
  last_cancellation_date date,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.shared_albums (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  shared_with_user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT shared_albums_pkey PRIMARY KEY (id),
  CONSTRAINT shared_albums_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id),
  CONSTRAINT shared_albums_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id),
  CONSTRAINT shared_albums_shared_with_user_id_fkey FOREIGN KEY (shared_with_user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.tcgcsv_groups (
  group_id integer NOT NULL,
  category_id integer NOT NULL,
  name text NOT NULL,
  published_on date,
  modified_on timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT tcgcsv_groups_pkey PRIMARY KEY (group_id)
);
CREATE TABLE public.tcgcsv_price_history (
  id bigint NOT NULL DEFAULT nextval('tcgcsv_price_history_id_seq'::regclass),
  product_id integer NOT NULL,
  market_price numeric,
  low_price numeric,
  mid_price numeric,
  high_price numeric,
  recorded_at date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT tcgcsv_price_history_pkey PRIMARY KEY (id)
);
CREATE TABLE public.tcgcsv_products (
  product_id integer NOT NULL,
  category_id integer NOT NULL,
  group_id integer NOT NULL,
  name text NOT NULL,
  image_url text,
  set_name text,
  number text,
  rarity text,
  market_price numeric,
  low_price numeric,
  extended_data jsonb DEFAULT '{}'::jsonb,
  tcgplayer_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  mid_price numeric,
  high_price numeric,
  CONSTRAINT tcgcsv_products_pkey PRIMARY KEY (product_id)
);
CREATE TABLE public.transactions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  card_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  offer_id uuid,
  price bigint NOT NULL,
  status text DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text, 'auto_cancelled'::text])),
  cancelled_by text CHECK (cancelled_by = ANY (ARRAY['seller'::text, 'buyer'::text, 'system'::text])),
  cancellation_reason text,
  expires_at timestamp with time zone NOT NULL,
  completed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT transactions_pkey PRIMARY KEY (id),
  CONSTRAINT transactions_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id),
  CONSTRAINT transactions_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.profiles(id),
  CONSTRAINT transactions_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id),
  CONSTRAINT transactions_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.offers(id)
);
CREATE TABLE public.user_collections (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  price text,
  image_url text,
  ebay_link text,
  created_at timestamp with time zone DEFAULT now(),
  category text,
  low_price numeric,
  mid_price numeric,
  high_price numeric,
  market_price numeric,
  rarity text,
  album_id uuid,
  CONSTRAINT user_collections_pkey PRIMARY KEY (id),
  CONSTRAINT user_collections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT user_collections_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.albums(id)
);
CREATE TABLE public.user_profiles (
  id uuid NOT NULL,
  username text UNIQUE,
  display_name text,
  avatar_url text,
  friend_code text DEFAULT upper(SUBSTRING(md5((random())::text) FROM 1 FOR 8)) UNIQUE,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.user_scan_usage (
  user_id uuid NOT NULL,
  scan_count integer DEFAULT 0,
  last_reset_date timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_scan_usage_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_scan_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);