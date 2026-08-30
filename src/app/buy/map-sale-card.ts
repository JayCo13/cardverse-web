import type { Card } from '@/lib/types';

/**
 * One row of the marketplace query into the shape the listing UI expects.
 *
 * Shared by the server component that renders the first page and the client
 * that refreshes it. If the two mapped differently the list would visibly
 * change on hydration, so there is exactly one of these.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSaleCard(c: any): Card {
    return {

          id: c.id,
          name: c.name,
          imageUrl: c.image_url || '',
          imageUrls: c.image_urls,
          category: c.category,
          condition: c.condition,
          listingType: c.listing_type,
          price: c.price,
          currentBid: c.current_bid,
          startingBid: c.starting_bid,
          auctionEnds: c.auction_ends,
          ticketPrice: c.ticket_price,
          razzEntries: c.razz_entries,
          totalTickets: c.total_tickets,
          sellerId: c.seller_id,
          author: c.profiles?.display_name || 'Unknown Seller',
          sellerName: c.profiles?.display_name || 'Unknown Seller',
          sellerAvatar: c.profiles?.profile_image_url || null,
          sellerVerified: c.profiles?.seller_verified || false,
          sellerRating: c.profiles?.seller_rating ?? null,
          sellerReviewCount: c.profiles?.seller_review_count ?? 0,
          description: c.description,
          lastSoldPrice: c.last_sold_price,
          status: c.status,
          publisher: c.publisher,
          setName: c.set_name,
          season: c.season,
          quantity: c.quantity,
          isBundle: c.is_bundle,
          bundleItems: c.bundle_items,
          acceptOffers: c.accept_offers,
          minOfferPercent: c.min_offer_percent,
          cardNumber: c.card_number,
          language: c.language,
          gradingCompany: c.grading_company,
          grade: c.grade,
          createdAt: c.created_at,
          priceIsVnd: true, // Marketplace listings are entered in VND
          shippingCarriers: c.profiles?.shipping_carriers || [],
          shippingFees: (c.profiles?.shipping_fees || {}) as Record<string, { intra?: number; inter?: number; region?: number }>,
    };
}
