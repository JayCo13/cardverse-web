import type { Card } from "@/lib/types";

/**
 * One listing row into the shape the detail page renders.
 *
 * Shared by the server component that renders the first HTML (and the page's
 * metadata and structured data) and by the client that refreshes the listing
 * after hydration. If the two mapped differently the page would visibly change
 * as it hydrated, so there is exactly one of these.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mapCard = (c: any): Card => ({
    productKind: c.product_kind || 'card', productTypeLabel: c.product_type_label, productDetails: c.product_details,
    id: c.id,
    name: c.name,
    imageUrl: c.image_url || "",
    imageUrls: c.image_urls || [],
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
    author: c.profiles?.display_name || c.seller_id,
    sellerName: c.profiles?.display_name || "Người bán CardVerseHub",
    sellerAvatar: c.profiles?.profile_image_url || undefined,
    sellerVerified: c.profiles?.seller_verified || false,
    sellerReviewCount: c.profiles?.seller_review_count ?? 0,
    description: c.description,
    lastSoldPrice: c.last_sold_price,
    status: c.status,
    reservedUntil: c.reserved_until ?? null,
    publisher: c.publisher,
    season: c.season,
    quantity: c.quantity,
    setName: c.set_name,
    isBundle: c.is_bundle,
    bundleItems: c.bundle_items,
    acceptOffers: c.accept_offers,
    minOfferPercent: c.min_offer_percent,
    shippingFee: typeof c.shipping_fee === 'number' ? c.shipping_fee : null,
    priceIsVnd: true,
});
