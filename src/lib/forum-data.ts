
import type { ForumPost } from './types';

const now = new Date();

export const forumPosts: ForumPost[] = [
  {
    id: '1',
    title: 'Just added this beauty to my collection!',
    content: "Finally got my hands on a PSA 10 Charizard! The holo pattern on this is absolutely insane. What do you guys think? Is this the best card in the Base Set or did Blastoise do it better? Let's debate in the comments! 👇",
    imageUrl: 'https://images.unsplash.com/photo-1613771404784-3a5686aa2be3?q=80&w=2669&auto=format&fit=crop',
    category: 'Showcase',
    author: {
      name: 'CardCollector22',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=CardCollector22',
      imageHint: 'man face',
      rank: 'Diamond',
      isVerified: true,
    },
    likes: 124,
    comments: 42,
    shares: 12,
    createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    isLiked: true,
  },
  {
    id: '2',
    title: 'Market Watch: One Piece TCG',
    content: "The prices on Romance Dawn alt arts are climbing again. With the new set announcement, I think we're seeing a lot of FOMO for the OG cards. Just picked up a Nami for $300. Good buy or too risky?",
    category: 'Market Watch',
    author: {
      name: 'SlabStash',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=SlabStash',
      imageHint: 'woman face',
      rank: 'Gold',
    },
    likes: 85,
    comments: 15,
    shares: 4,
    createdAt: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '3',
    title: 'Authentication Help Needed',
    content: "Can someone with a sharp eye take a look at this back surface? Seller says it's NM but I'm seeing some whitening on the top edge. Is this acceptable for a 'Near Mint' listing?",
    imageUrl: 'https://images.unsplash.com/photo-1629243765873-12be5f35496b?q=80&w=2487&auto=format&fit=crop',
    category: 'Authentication',
    author: {
      name: 'NervousNewbie',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=NervousNewbie',
      imageHint: 'man face',
      rank: 'Bronze',
    },
    likes: 12,
    comments: 88,
    shares: 1,
    createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
  },
];
