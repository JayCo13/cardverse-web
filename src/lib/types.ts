

export type CardCategory = "Pokémon" | "Soccer" | "Magic" | "Other" | "Bóng đá" | "Ma thuật" | "Khác";
export type CardCondition = "Mint" | "Near Mint" | "Excellent" | "Good" | "Played" | "Hoàn hảo" | "Gần như mới" | "Tuyệt vời" | "Tốt" | "Đã qua sử dụng";
export type ListingType = "sale" | "auction" | "razz";

export type LocalizedString = {
  "en-US": string;
  "vi-VN": string;
};

export interface Card {
  id: string;
  name: string;
  imageUrl: string;
  imageUrls?: string[];
  imageHint?: string;
  category: string;
  condition?: string;
  listingType: ListingType;
  price?: number;
  currentBid?: number;
  startingBid?: number;
  auctionEnds?: string;
  ticketPrice?: number;
  razzEntries?: number;
  totalTickets?: number;
  sellerId: string;
  author: string;
  description?: string;
  lastSoldPrice?: number;
  status?: 'active' | 'sold' | 'expired' | 'in_transaction';
  publisher?: string;
  season?: string;
  quantity?: number;
}

export interface Offer {
  id: string;
  cardId: string;
  buyerId: string;
  buyerEmail: string;
  price: number;
  message?: string;
  createdAt: string;
  status: 'pending' | 'accepted' | 'rejected' | 'chosen';
  transactionId?: string;
}

export interface ForumPost {
  id: string;
  title: string; // Keep for now as "headline"
  content: string; // Main post content
  imageUrl?: string; // Optional image attachment
  author: {
    name: string;
    avatar: string;
    imageHint: string;
    rank?: string; // e.g., "Diamond"
    isVerified?: boolean;
  };
  category: string;
  likes: number;
  comments: number; // count
  shares: number;
  createdAt: string; // ISO date string
  isLiked?: boolean; // For current user context mock
  likedBy?: string[]; // IDs of users who liked
}

export interface Notification {
  id: string;
  userId: string;
  type: 'offer_received' | 'offer_accepted' | 'offer_rejected' | 'card_sold';
  title: string;
  message: string;
  cardId?: string;
  offerId?: string;
  read: boolean;
  createdAt: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  phoneNumber: string; // Zalo number
  address?: string;
  city?: string;
  profileImageUrl?: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  cardId: string;
  sellerId: string;
  buyerId: string;
  offerId: string;
  price: number;
  status: 'active' | 'completed' | 'cancelled' | 'auto_cancelled';
  cancelledBy?: 'seller' | 'buyer' | 'system';
  cancellationReason?: string;
  chosenOfferId?: string;
  createdAt: string;
  expiresAt: string; // Auto-cancel after 2 hours
  completedAt?: string;
  cancelledAt?: string;
}

export interface CancellationRecord {
  id: string;
  userId: string;
  transactionId: string;
  reason: string;
  createdAt: string;
}

export interface UserLegitRate {
  userId: string;
  rate: number; // 0-100, starts at 100
  totalTransactions: number;
  completedTransactions: number;
  cancelledTransactions: number;
  dailyCancellations: number; // Reset daily
  lastCancellationDate: string;
  lastUpdated: string;
}

export interface SellerStats {
  userId: string;
  totalSales: number;
  totalRevenue: number;
  monthSales: number;
  monthRevenue: number;
  lastUpdated: string;
}

// Pokemon cards from tcgcsv_products
export interface PokemonCard {
  id: number; // product_id
  productId: number; // alias for navigation
  name: string;
  imageUrl: string;
  setName: string;
  number: string;
  rarity: string;
  marketPrice: number | null;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  tcgplayerUrl: string | null;
  categoryId: number;
  groupId: number;
}
