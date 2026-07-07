"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { enUS, ja, vi } from "date-fns/locale";
import {
    ArrowLeft,
    BadgeCheck,
    CalendarDays,
    CheckCircle,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    CreditCard,
    Gem,
    HandCoins,
    Heart,
    Loader2,
    MessageCircle,
    PackageCheck,
    Pencil,
    Search,
    ShieldCheck,
    ShoppingCart,
    Tag,
    Truck,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { CheckoutModal } from "@/components/checkout-modal";
import { ChatDrawer } from "@/components/chat-drawer";
import { OfferModal } from "@/components/offer-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthModal } from "@/components/auth-modal";
import { useSupabase, useUser } from "@/lib/supabase";
import { optimizeCloudinaryUrl } from "@/lib/cloudinary-url";
import { getCategoryCode } from "@/lib/category-code";
import type { Card, Offer } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { useLocalization } from "@/context/localization-context";

type SellerProfile = {
    id: string;
    email?: string | null;
    display_name?: string | null;
    profile_image_url?: string | null;
    seller_verified?: boolean | null;
    seller_rating?: number | null;
    seller_review_count?: number | null;
    address_district_id?: number | null;
    address_ward_code?: string | null;
};

type CheckoutCard = {
    id: string;
    name: string;
    image_url: string;
    price: number;
    category: string;
    condition: string;
    seller_id: string;
};

/**
 * Category-code badge colors, copied from the navbar's per-category palette
 * (POK → yellow, OP → red, SOC → green). Kept here (not in src/lib) because
 * Tailwind only scans src/{app,components,pages} for class names.
 */
const categoryBadgeClass = (category: string): string => {
    switch (getCategoryCode(category)) {
        case "POK": return "bg-yellow-400 text-yellow-950 shadow-[0_0_12px_rgba(250,204,21,0.55)]";
        case "OP": return "bg-red-500 text-white shadow-[0_0_12px_rgba(239,68,68,0.55)]";
        case "SOC": return "bg-green-500 text-white shadow-[0_0_12px_rgba(34,197,94,0.55)]";
        default: return "bg-zinc-800 text-white shadow-[0_0_10px_rgba(0,0,0,0.4)]";
    }
};

const formatCurrency = (amount: number | null | undefined, fallback: string) =>
    amount === null || amount === undefined
        ? fallback
        : new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(amount);

const mapOffer = (o: any): Offer => ({
    id: o.id,
    cardId: o.card_id,
    buyerId: o.buyer_id,
    // The offers panel only renders for the card's seller (isOwner), and the
    // offers RLS policy only lets the seller read other users' offers, so
    // exposing the buyer name here is seller-only by construction.
    buyerEmail: o.buyer?.display_name || o.buyer?.email || o.buyer_email || "Người mua",
    price: o.price,
    message: o.message,
    status: o.status,
    transactionId: o.transaction_id,
    createdAt: o.created_at,
});

const mapCard = (c: any): Card => ({
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
    sellerName: c.profiles?.display_name || "Người bán CardVerse",
    sellerAvatar: c.profiles?.profile_image_url || undefined,
    sellerVerified: c.profiles?.seller_verified || false,
    sellerRating: c.profiles?.seller_rating ?? null,
    sellerReviewCount: c.profiles?.seller_review_count ?? 0,
    description: c.description,
    lastSoldPrice: c.last_sold_price,
    status: c.status,
    publisher: c.publisher,
    season: c.season,
    quantity: c.quantity,
    setName: c.set_name,
    isBundle: c.is_bundle,
    bundleItems: c.bundle_items,
    acceptOffers: c.accept_offers,
    minOfferPercent: c.min_offer_percent,
    priceIsVnd: true,
});

function RelatedRail({ title, subtitle, cards, labels }: { title: string; subtitle?: string; cards: Card[]; labels: { cond: string; price: string; sold: string; preOwned: string; contact: string } }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    if (cards.length === 0) return null;

    // Show 5 cards per view (each ~1/5 of the row); any extras stay in the
    // scrollable row and are reached with the prev/next buttons. The buttons
    // only appear when there is actually something to scroll to.
    const items = cards;
    const showNav = cards.length > 5;
    // Width per card so up to 5 fill one view; with fewer cards they grow to
    // fill the row instead of leaving an awkward gap. (gap-4 = 1rem between cards)
    const perView = Math.min(5, Math.max(1, items.length));
    const cardWidth = `calc((100% - ${perView - 1}rem) / ${perView})`;

    const scrollByDir = (dir: number) => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
    };

    return (
        <section className="space-y-3">
            <div className="flex items-end justify-between gap-4">
                <div>
                    <h2 className="text-xl font-semibold tracking-normal md:text-2xl">{title}</h2>
                    {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
                </div>
            </div>
            {/* prev | cards | next — buttons sit in their own side gutters, never over the cards */}
            <div className="flex items-center gap-2 sm:gap-3">
                {showNav && (
                    <button
                        type="button"
                        onClick={() => scrollByDir(-1)}
                        aria-label="Previous related items"
                        className="hidden h-11 w-11 shrink-0 items-center justify-center self-center rounded-full border-2 border-orange-500/60 bg-card text-orange-400 shadow-md ring-1 ring-black/5 transition hover:scale-105 hover:border-orange-500 hover:bg-orange-500 hover:text-white active:scale-95 sm:flex"
                    >
                        <ChevronLeft className="h-5 w-5" />
                    </button>
                )}
                <div ref={scrollRef} className="flex min-w-0 flex-1 gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {items.map(item => (
                        <a
                            key={item.id}
                            href={`/cards/${item.id}`}
                            style={{ width: cardWidth }}
                            className="card-border-shimmer group flex min-w-[160px] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-orange-500/25 bg-card transition duration-200 hover:-translate-y-0.5 hover:animate-none hover:border-orange-500 hover:shadow-[0_12px_32px_-12px_rgba(249,115,22,0.55)]"
                        >
                            <div className="relative aspect-square overflow-hidden bg-muted">
                                <Image
                                    src={optimizeCloudinaryUrl(item.imageUrl, 420)}
                                    alt={item.name}
                                    fill
                                    className={`object-cover transition-transform duration-300 group-hover:scale-105 ${item.status === "sold" ? "grayscale" : ""}`}
                                />
                                <span className={`absolute left-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${categoryBadgeClass(item.category)}`}>
                                    {getCategoryCode(item.category)}
                                </span>
                                {item.status === "sold" && (
                                    <span className="absolute right-2 top-2 rounded-md bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                                        {labels.sold}
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-1 flex-col gap-2 p-3">
                                <p className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug group-hover:text-orange-400">
                                    {item.name}
                                </p>
                                <span className="w-fit rounded-md border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400">
                                    {labels.cond}: <span className="text-amber-300">{item.condition || labels.preOwned}</span>
                                </span>
                                <p className="mt-auto text-base font-bold text-orange-400">
                                    <span className="text-xs font-medium text-muted-foreground">{labels.price}: </span>
                                    {formatCurrency(item.price, labels.contact)}
                                </p>
                                <div className="flex items-center gap-2 border-t pt-2">
                                    {item.sellerAvatar ? (
                                        <Image src={item.sellerAvatar} alt="" width={22} height={22} className="h-[22px] w-[22px] rounded-full object-cover" />
                                    ) : (
                                        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
                                            {(item.sellerName || "C").charAt(0).toUpperCase()}
                                        </span>
                                    )}
                                    <span className="truncate text-xs text-muted-foreground">{item.sellerName}</span>
                                    {item.sellerVerified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-orange-500" />}
                                </div>
                            </div>
                        </a>
                    ))}
                </div>
                {showNav && (
                    <button
                        type="button"
                        onClick={() => scrollByDir(1)}
                        aria-label="Next related items"
                        className="hidden h-11 w-11 shrink-0 items-center justify-center self-center rounded-full border-2 border-orange-500/60 bg-card text-orange-400 shadow-md ring-1 ring-black/5 transition hover:scale-105 hover:border-orange-500 hover:bg-orange-500 hover:text-white active:scale-95 sm:flex"
                    >
                        <ChevronRight className="h-5 w-5" />
                    </button>
                )}
            </div>
        </section>
    );
}

export default function CardDetailsPage() {
    const params = useParams();
    const router = useRouter();
    const cardId = params.id as string;
    const supabase = useSupabase();
    const { user } = useUser();
    const { setOpen: setAuthOpen } = useAuthModal();
    const { toast } = useToast();
    const { locale } = useLocalization();
    const dateLocale = locale === "vi-VN" ? vi : locale === "ja-JP" ? ja : enUS;
    const copy = locale === "vi-VN"
        ? {
            contact: "Liên hệ",
            buyer: "Người mua",
            seller: "Người bán CardVerse",
            viewAll: "Xem tất cả",
            preOwned: "Đã qua sử dụng",
            notSpecified: "Chưa xác định",
            categoryLabel: "Danh mục", setLabel: "Bộ thẻ", playerLabel: "Nhân vật/Cầu thủ",
            manufacturerLabel: "Nhà sản xuất", seasonLabel: "Mùa", typeLabel: "Loại",
            tradingCard: "Thẻ sưu tầm thể thao", cardSizeLabel: "Kích thước thẻ", standard: "Tiêu chuẩn",
            autographedLabel: "Có chữ ký", originalReprintLabel: "Bản gốc/Tái bản có phép", original: "Bản gốc",
            gradedLabel: "Đã chấm điểm", sportLabel: "Môn thể thao", yes: "Có", no: "Không",
            pending: "Đang chờ", rejected: "Bị từ chối",
            sellerOnCardVerse: "Độ uy tín người bán",
            openChatFailed: "Không thể mở chat",
            chatError: "Lỗi chat",
            acceptOfferFailed: "Không thể chấp nhận đề nghị",
            rejectOfferFailed: "Không thể từ chối đề nghị",
            retryLater: "Đã xảy ra lỗi. Vui lòng thử lại.",
            notFound: "Không tìm thấy thẻ",
            back: "Quay lại",
            noDescription: "Chưa có mô tả.",
            auction: "Đấu giá",
            searchPlaceholder: "Tìm kiếm thẻ, người chơi, bộ thẻ...",
            search: "Tìm kiếm",
            allCategories: "Tất cả danh mục",
            similarFrom: "Tìm các mặt hàng tương tự từ",
            itemsSold: "mặt hàng đã bán",
            positive: "uy tín",
            aboutSeller: "Về người bán",
            relatedItems: "Sản phẩm liên quan",
            condLabel: "Tình trạng",
            priceLabel: "Giá",
            shopStore: "Xem shop trên CardVerse",
            sponsored: "Tài trợ",
            viewedAlso: "Người xem sản phẩm này cũng xem",
            viewImage: "Xem ảnh",
            noImage: "Không có ảnh",
            sold: "Đã bán",
            inTransaction: "Đang giữ thanh toán",
            unavailable: "Không còn khả dụng",
            newSeller: "Mới",
            sellerOtherItems: "Các món khác của seller",
            message: "Nhắn tin",
            bestOffer: "hoặc Trả giá tốt nhất",
            approxLastSale: "Giá bán gần nhất",
            condition: "Tình trạng",
            ungraded: "Chưa chấm điểm - Near mint hoặc tốt hơn",
            quantity: "Số lượng",
            available: "có sẵn",
            ownListing: "Đây là bài đăng của bạn. Buyer sẽ thấy nút mua và trả giá tại đây.",
            boughtBySomeone: "Thẻ này đã được người khác mua.",
            reservedOrUnavailable: "Thẻ này đang được giữ để thanh toán hoặc không còn khả dụng.",
            buyNow: "Mua ngay",
            makeOffer: "Trả giá",
            viewOfferHistory: "Lịch sử offer",
            messageSeller: "Nhắn người bán",
            addToWatchlist: "Thêm vào theo dõi",
            addToCart: "Thêm vào giỏ hàng",
            addToCartSuccess: "Thêm vào giỏ hàng thành công",
            currentOffer: "Đề nghị hiện tại của bạn",
            status: "Trạng thái",
            shippingPayments: "Vận chuyển, hoàn trả và thanh toán",
            shipping: "Vận chuyển",
            ghnFee: "Phí GHN sẽ được tính khi thanh toán",
            sellerArea: "Lấy hàng tại khu vực của người bán. Cần địa chỉ của người mua.",
            delivery: "Giao hàng",
            estimatedDelivery: "Ước tính sau khi xác nhận thanh toán",
            sellerShips: "Người bán gửi hàng sau khi đơn được thanh toán.",
            returns: "Hoàn trả",
            returnsPolicy: "Hỗ trợ tranh chấp nếu sản phẩm không đúng mô tả.",
            payments: "Thanh toán",
            similarItems: "Sản phẩm tương tự",
            aboutItem: "Về sản phẩm này",
            sellerResponsibility: "Người bán chịu trách nhiệm hoàn toàn cho listing này.",
            itemNumber: "Mã sản phẩm CardVerse",
            itemSpecifics: "Thông tin chi tiết",
            itemDescription: "Mô tả từ người bán",
            noDetailedDescription: "Người bán chưa thêm mô tả chi tiết cho thẻ này.",
            listingInfo: "Thông tin listing",
            protectedCheckout: "Thanh toán được bảo vệ",
            verifiedSeller: "Seller đã xác minh",
            offerHint: "Gửi đề nghị để thương lượng với người bán",
            buyHint: "Mua ngay với PayOS hoặc ví CardVerse",
            watchHint: "Lưu thẻ này để theo dõi giá",
            fastShip: "GHN nội địa",
            paymentReady: "PayOS / Ví",
            listingId: "Mã listing",
            offers: "Đề xuất giá",
            sellerTools: "Công cụ người bán",
            editListing: "Chỉnh sửa listing",
            noOffers: "Chưa có đề xuất nào cho listing này.",
            chat: "Chat",
            accept: "Chấp nhận",
            reject: "Từ chối",
            chosen: "Đã chọn",
            processed: "Đã xử lý",
        }
        : locale === "ja-JP"
            ? {
                contact: "お問い合わせ",
                buyer: "購入者",
                seller: "CardVerse販売者",
                viewAll: "すべて見る",
                preOwned: "中古",
                notSpecified: "未指定",
                categoryLabel: "カテゴリー", setLabel: "セット", playerLabel: "選手/キャラクター",
                manufacturerLabel: "メーカー", seasonLabel: "シーズン", typeLabel: "種類",
                tradingCard: "スポーツトレーディングカード", cardSizeLabel: "カードサイズ", standard: "標準",
                autographedLabel: "サイン入り", originalReprintLabel: "オリジナル/公式復刻", original: "オリジナル",
                gradedLabel: "鑑定済み", sportLabel: "スポーツ", yes: "はい", no: "いいえ",
                pending: "保留中", rejected: "却下済み",
                sellerOnCardVerse: "販売者評価",
                openChatFailed: "チャットを開けません",
                chatError: "チャットエラー",
                acceptOfferFailed: "オファーを承認できません",
                rejectOfferFailed: "オファーを却下できません",
                retryLater: "エラーが発生しました。もう一度お試しください。",
                notFound: "カードが見つかりません",
                back: "戻る",
                noDescription: "説明はありません。",
                auction: "オークション",
                searchPlaceholder: "カード、選手、セットを検索...",
                search: "検索",
                allCategories: "すべてのカテゴリ",
                similarFrom: "この販売者の類似商品",
                itemsSold: "件販売",
                positive: "高評価",
                aboutSeller: "販売者について",
                relatedItems: "関連商品",
                condLabel: "状態",
                priceLabel: "価格",
                shopStore: "CardVerseストアを見る",
                sponsored: "スポンサー",
                viewedAlso: "この商品を見た人はこちらも見ています",
                viewImage: "画像を見る",
                noImage: "画像なし",
                sold: "売り切れ",
                inTransaction: "支払い保留中",
                unavailable: "利用できません",
                newSeller: "新規",
                sellerOtherItems: "販売者の他の商品",
                message: "メッセージ",
                bestOffer: "またはベストオファー",
                approxLastSale: "直近の販売価格",
                condition: "状態",
                ungraded: "未鑑定 - Near mint以上",
                quantity: "数量",
                available: "在庫あり",
                ownListing: "これはあなたの出品です。購入者にはここに購入・オファーボタンが表示されます。",
                boughtBySomeone: "このカードはすでに他のユーザーが購入しました。",
                reservedOrUnavailable: "このカードは支払い確保中、または現在利用できません。",
                buyNow: "今すぐ購入",
                makeOffer: "オファーする",
                viewOfferHistory: "提案履歴",
                messageSeller: "販売者に連絡",
                addToWatchlist: "ウォッチリストに追加",
                addToCart: "カートに追加",
                addToCartSuccess: "カートに追加しました",
                currentOffer: "現在のオファー",
                status: "ステータス",
                shippingPayments: "配送・返品・支払い",
                shipping: "配送",
                ghnFee: "GHN送料は決済時に計算されます",
                sellerArea: "販売者の集荷エリアから発送。購入者住所が必要です。",
                delivery: "配達",
                estimatedDelivery: "支払い確認後に予定が表示されます",
                sellerShips: "注文の支払い後に販売者が発送します。",
                returns: "返品",
                returnsPolicy: "商品が説明と異なる場合は紛争サポートがあります。",
                payments: "支払い",
                similarItems: "類似商品",
                aboutItem: "この商品について",
                sellerResponsibility: "この出品の責任は販売者が負います。",
                itemNumber: "CardVerse商品番号",
                itemSpecifics: "商品の詳細",
                itemDescription: "販売者による説明",
                noDetailedDescription: "販売者はまだ詳細説明を追加していません。",
                listingInfo: "出品情報",
                protectedCheckout: "保護された決済",
                verifiedSeller: "認証済み販売者",
                offerHint: "販売者に交渉オファーを送信",
                buyHint: "PayOSまたはCardVerseウォレットで購入",
                watchHint: "このカードを保存して価格を追跡",
                fastShip: "GHN国内配送",
                paymentReady: "PayOS / ウォレット",
                listingId: "出品ID",
                offers: "オファー",
                sellerTools: "販売者ツール",
                editListing: "出品を編集",
                noOffers: "この出品にはまだオファーがありません。",
                chat: "チャット",
                accept: "承認",
                reject: "却下",
                chosen: "選択済み",
                processed: "処理済み",
            }
            : {
                contact: "Contact",
                buyer: "Buyer",
                seller: "CardVerse seller",
                viewAll: "View all",
                preOwned: "Pre-owned",
                notSpecified: "Not specified",
                categoryLabel: "Category", setLabel: "Set", playerLabel: "Player/Athlete",
                manufacturerLabel: "Manufacturer", seasonLabel: "Season", typeLabel: "Type",
                tradingCard: "Sports Trading Card", cardSizeLabel: "Card Size", standard: "Standard",
                autographedLabel: "Autographed", originalReprintLabel: "Original/Licensed Reprint", original: "Original",
                gradedLabel: "Graded", sportLabel: "Sport", yes: "Yes", no: "No",
                pending: "Pending", rejected: "Rejected",
                sellerOnCardVerse: "Seller reputation",
                openChatFailed: "Unable to open chat",
                chatError: "Chat error",
                acceptOfferFailed: "Unable to accept offer",
                rejectOfferFailed: "Unable to reject offer",
                retryLater: "Something went wrong. Please try again.",
                notFound: "Card not found",
                back: "Back",
                noDescription: "No description available.",
                auction: "Auction",
                searchPlaceholder: "Search for cards, players, sets...",
                search: "Search",
                allCategories: "All Categories",
                similarFrom: "Find similar items from",
                itemsSold: "items sold",
                positive: "positive",
                aboutSeller: "About the seller",
                relatedItems: "Related items",
                condLabel: "Cond",
                priceLabel: "Price",
                shopStore: "Shop store on CardVerse",
                sponsored: "Sponsored",
                viewedAlso: "People who viewed this item also viewed",
                viewImage: "View image",
                noImage: "No image",
                sold: "Sold",
                inTransaction: "Payment reserved",
                unavailable: "Unavailable",
                newSeller: "New",
                sellerOtherItems: "Seller's other items",
                message: "Message",
                bestOffer: "or Best Offer",
                approxLastSale: "Approx. last sale",
                condition: "Condition",
                ungraded: "Ungraded - Near mint or better",
                quantity: "Quantity",
                available: "available",
                ownListing: "This is your listing. Buyers will see the buy and offer actions here.",
                boughtBySomeone: "This card has already been purchased by another buyer.",
                reservedOrUnavailable: "This card is reserved for payment or is no longer available.",
                buyNow: "Buy It Now",
                makeOffer: "Make Offer",
                viewOfferHistory: "Offer history",
                messageSeller: "Message seller",
                addToWatchlist: "Add to Watchlist",
                addToCart: "Add to cart",
                addToCartSuccess: "Added to cart successfully",
                currentOffer: "Your current offer",
                status: "Status",
                shippingPayments: "Shipping, returns, and payments",
                shipping: "Shipping",
                ghnFee: "GHN fee calculated at checkout",
                sellerArea: "Located in seller pickup area. Buyer address required.",
                delivery: "Delivery",
                estimatedDelivery: "Estimated after payment confirmation",
                sellerShips: "Seller ships after order is paid.",
                returns: "Returns",
                returnsPolicy: "Marketplace dispute support if item does not match listing description.",
                payments: "Payments",
                similarItems: "Similar Items",
                aboutItem: "About this item",
                sellerResponsibility: "Seller assumes all responsibility for this listing.",
                itemNumber: "CardVerse item number",
                itemSpecifics: "Item specifics",
                itemDescription: "Item description from the seller",
                noDetailedDescription: "The seller has not added a detailed description for this card yet.",
                listingInfo: "Listing details",
                protectedCheckout: "Protected checkout",
                verifiedSeller: "Verified seller",
                offerHint: "Send a private offer to negotiate",
                buyHint: "Buy instantly with PayOS or CardVerse wallet",
                watchHint: "Save this card and track price changes",
                fastShip: "Domestic GHN",
                paymentReady: "PayOS / Wallet",
                listingId: "Listing ID",
                offers: "Offers",
                sellerTools: "Seller tools",
                editListing: "Edit listing",
                noOffers: "No offers yet for this listing.",
                chat: "Chat",
                accept: "Accept",
                reject: "Reject",
                chosen: "Chosen",
                processed: "Processed",
            };
    const formatVND = (amount: number | null | undefined) => formatCurrency(amount, copy.contact);

    const [card, setCard] = useState<Card | null>(null);
    const [seller, setSeller] = useState<SellerProfile | null>(null);
    const [relatedCards, setRelatedCards] = useState<Card[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [offers, setOffers] = useState<Offer[]>([]);
    const [activeImage, setActiveImage] = useState("");
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [offerOpen, setOfferOpen] = useState(false);
    const [chatOpen, setChatOpen] = useState(false);
    const [chatConversationId, setChatConversationId] = useState<string | null>(null);
    const [startingChatOfferId, setStartingChatOfferId] = useState<string | null>(null);
    const [acceptingOfferId, setAcceptingOfferId] = useState<string | null>(null);
    const [rejectingOfferId, setRejectingOfferId] = useState<string | null>(null);

    const isOwner = user?.id === card?.sellerId;
    const isSale = card?.listingType === "sale";
    const isUnavailable = card?.status === "sold" || card?.status === "in_transaction" || card?.status === "expired";
    const myOffer = offers.find(offer => offer.buyerId === user?.id);

    const images = useMemo(() => {
        if (!card) return [];
        return Array.from(new Set([card.imageUrl, ...(card.imageUrls || [])].filter(Boolean)));
    }, [card]);

    const sellerAddress = useMemo(() => {
        if (!seller?.address_district_id || !seller?.address_ward_code) return null;
        return {
            districtId: seller.address_district_id,
            wardCode: seller.address_ward_code,
        };
    }, [seller]);

    const checkoutCard: CheckoutCard | null = card ? {
        id: card.id,
        name: card.name,
        image_url: card.imageUrl,
        price: card.price ?? 0,
        category: card.category,
        condition: card.condition || "",
        seller_id: card.sellerId,
    } : null;

    const itemSpecifics = useMemo(() => {
        if (!card) return [];
        return [
            [copy.condition, card.condition || copy.ungraded],
            [copy.categoryLabel, card.category],
            [copy.setLabel, card.setName || copy.notSpecified],
            [copy.playerLabel, card.name],
            [copy.manufacturerLabel, card.publisher || copy.notSpecified],
            [copy.seasonLabel, card.season || copy.notSpecified],
            [copy.typeLabel, copy.tradingCard],
            [copy.cardSizeLabel, copy.standard],
            [copy.autographedLabel, card.name.toLowerCase().includes("auto") ? copy.yes : copy.no],
            [copy.originalReprintLabel, copy.original],
            [copy.gradedLabel, card.condition?.toLowerCase().includes("psa") ? copy.yes : copy.no],
            [copy.sportLabel, card.category],
        ];
    }, [card, copy]);

    const listingHighlights = useMemo(() => {
        if (!card) return [];
        return [
            { label: copy.condition, value: card.condition || copy.ungraded, icon: Gem },
            { label: copy.setLabel, value: card.setName || card.publisher || copy.notSpecified, icon: BadgeCheck },
            { label: copy.quantity, value: `${card.quantity || 1} ${copy.available}`, icon: PackageCheck },
            { label: copy.listingId, value: card.id.slice(0, 8).toUpperCase(), icon: Tag },
        ];
    }, [card, copy]);

    const fetchRelatedCards = useCallback(async (baseCard: Card) => {
        const { data } = await supabase
            .from("cards")
            .select("*, profiles:seller_id(display_name, profile_image_url, seller_verified, seller_rating, seller_review_count)")
            .eq("listing_type", "sale")
            .neq("id", baseCard.id)
            .limit(12);

        if (!data) return;

        const mapped = (data as any[]).map(mapCard);
        const closest = mapped.filter(item =>
            item.category === baseCard.category ||
            item.publisher === baseCard.publisher ||
            item.setName === baseCard.setName
        );
        setRelatedCards(closest.length > 0 ? closest : mapped);
    }, [supabase]);

    const fetchCard = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from("cards")
                .select(`
                    *,
                    profiles:seller_id(
                        id,
                        email,
                        display_name,
                        profile_image_url,
                        seller_verified,
                        seller_rating,
                        seller_review_count,
                        address_district_id,
                        address_ward_code
                    )
                `)
                .eq("id", cardId)
                .single();

            if (data && !error) {
                const mapped = mapCard(data);
                setCard(mapped);
                setSeller((data as any).profiles || null);
                setActiveImage(mapped.imageUrl || mapped.imageUrls?.[0] || "");
                void fetchRelatedCards(mapped);
            } else {
                setCard(null);
                setSeller(null);
            }
        } catch (error) {
            console.error("Error fetching card:", error);
            setCard(null);
            setSeller(null);
        } finally {
            setIsLoading(false);
        }
    }, [cardId, fetchRelatedCards, supabase]);

    const fetchOffers = useCallback(async () => {
        const { data } = await supabase
            .from("offers")
            .select("*, buyer:profiles!offers_buyer_id_fkey(display_name, email)")
            .eq("card_id", cardId)
            .order("price", { ascending: false });

        if (data) setOffers((data as any[]).map(mapOffer));
    }, [cardId, supabase]);

    useEffect(() => {
        void fetchCard();
    }, [fetchCard]);

    useEffect(() => {
        if (!card || card.listingType !== "sale") return;

        void fetchOffers();
        const channel = supabase
            .channel(`offers-${cardId}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "offers", filter: `card_id=eq.${cardId}` },
                () => void fetchOffers(),
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [card, cardId, fetchOffers, supabase]);

    const handleBuyNow = () => {
        if (!user) {
            setAuthOpen(true);
            return;
        }
        if (!card || isOwner || isUnavailable) return;
        setCheckoutOpen(true);
    };

    const handleMakeOffer = () => {
        if (!user) {
            setAuthOpen(true);
            return;
        }
        if (!card || isOwner || isUnavailable) return;
        setOfferOpen(true);
    };

    const handleAddToCart = async () => {
        if (!user) {
            setAuthOpen(true);
            return;
        }
        if (!card || isOwner || isUnavailable) return;

        try {
            const response = await fetch("/api/cart", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ card_id: card.id }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || copy.retryLater);
            toast({ title: copy.addToCartSuccess });
            window.dispatchEvent(new Event("cardverse:cart-updated"));
        } catch (error) {
            const description = error instanceof Error ? error.message : copy.retryLater;
            toast({ variant: "destructive", title: copy.chatError, description });
        }
    };

    const handleStartChat = async (offerId?: string) => {
        if (!user) {
            setAuthOpen(true);
            return;
        }
        if (!card) return;
        if (isOwner && !offerId) return;

        setStartingChatOfferId(offerId || "listing");
        try {
            const response = await fetch("/api/chat/conversations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cardId: card.id, offerId }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || copy.openChatFailed);
            setChatConversationId(payload.conversation.id);
            setChatOpen(true);
        } catch (error) {
            const description = error instanceof Error ? error.message : copy.openChatFailed;
            toast({ variant: "destructive", title: copy.chatError, description });
        } finally {
            setStartingChatOfferId(null);
        }
    };

    const handleAcceptOffer = async (offer: Offer) => {
        if (!card || acceptingOfferId) return;
        setAcceptingOfferId(offer.id);

        try {
            // All seller/offer/card validation and card locking happen server-side.
            const response = await fetch(`/api/offers/${offer.id}/accept`, { method: "POST" });
            const payload = await response.json();

            if (!response.ok) {
                toast({
                    variant: "destructive",
                    title: copy.acceptOfferFailed,
                    description: payload.error || copy.retryLater,
                });
                setAcceptingOfferId(null);
                return;
            }

            router.push(payload.checkoutUrl || `/checkout?offerId=${offer.id}`);
        } catch (error) {
            console.error("Error accepting offer:", error);
            toast({
                variant: "destructive",
                title: copy.acceptOfferFailed,
                description: copy.retryLater,
            });
            setAcceptingOfferId(null);
        }
    };

    const handleRejectOffer = async (offer: Offer) => {
        if (!card || rejectingOfferId) return;
        setRejectingOfferId(offer.id);

        try {
            const response = await fetch(`/api/offers/${offer.id}/reject`, { method: "POST" });
            const payload = await response.json();

            if (!response.ok) {
                toast({
                    variant: "destructive",
                    title: copy.rejectOfferFailed,
                    description: payload.error || copy.retryLater,
                });
                return;
            }

            window.dispatchEvent(new Event("cardverse:chat-updated"));
            void fetchOffers();
        } catch (error) {
            console.error("Error rejecting offer:", error);
            toast({
                variant: "destructive",
                title: copy.rejectOfferFailed,
                description: copy.retryLater,
            });
        } finally {
            setRejectingOfferId(null);
        }
    };

    if (isLoading) {
        return (
            <div className="flex min-h-screen flex-col">
                <Header />
                <main className="container mx-auto flex-1 px-4 py-8">
                    <Skeleton className="h-[620px] w-full rounded-xl" />
                </main>
                <Footer />
            </div>
        );
    }

    if (!card) {
        return (
            <div className="flex min-h-screen flex-col">
                <Header />
                <main className="container mx-auto flex-1 px-4 py-16 text-center">
                    <p className="text-xl text-muted-foreground">{copy.notFound}</p>
                    <Button onClick={() => router.back()} className="mt-4">
                        <ArrowLeft className="mr-2 h-4 w-4" /> {copy.back}
                    </Button>
                </main>
                <Footer />
            </div>
        );
    }

    if (!isSale) {
        return (
            <div className="flex min-h-screen flex-col">
                <Header />
                <main className="container mx-auto flex-1 px-4 py-8">
                    <Button variant="ghost" onClick={() => router.back()} className="mb-6">
                        <ArrowLeft className="mr-2 h-4 w-4" /> {copy.back}
                    </Button>
                    <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                        <div className="lg:col-span-2 space-y-4">
                            <Badge variant="secondary">{card.category}</Badge>
                            <h1 className="text-3xl font-bold">{card.name}</h1>
                            <p className="text-muted-foreground">{card.description || copy.noDescription}</p>
                            <div className="rounded-lg border bg-card p-5">
                                <p className="text-sm text-muted-foreground">
                                    {card.listingType === "auction" ? copy.auction : "Razz"}
                                </p>
                                <p className="mt-2 text-3xl font-bold text-primary">
                                    {card.listingType === "auction"
                                        ? formatVND(card.currentBid || card.startingBid || 0)
                                        : formatVND(card.ticketPrice || 0)}
                                </p>
                            </div>
                        </div>
                        <div className="relative aspect-[3/4] overflow-hidden rounded-lg border bg-muted/30">
                            <Image src={optimizeCloudinaryUrl(card.imageUrl, 900)} alt={card.name} fill className="object-contain p-3" />
                        </div>
                    </div>
                </main>
                <Footer />
            </div>
        );
    }

    const displayRelatedCards = relatedCards.length > 0 ? relatedCards : [card];

    return (
        <div className="flex min-h-screen flex-col bg-background">
            <Header />
            <main className="flex-1">
                <div className="mx-auto w-full max-w-[1820px] space-y-8 px-4 py-6 sm:px-6">
                    <div className="flex items-center justify-between gap-4 border-b pb-4">
                        <Button variant="ghost" onClick={() => router.back()} className="h-9 px-2 text-muted-foreground">
                            <ArrowLeft className="mr-2 h-4 w-4" /> {copy.back}
                        </Button>
                    </div>

                    <section className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,920px)_minmax(460px,1fr)] 2xl:grid-cols-[minmax(0,980px)_minmax(520px,1fr)]">
                        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[96px_minmax(0,1fr)]">
                            <div className="order-2 flex gap-3 overflow-x-auto lg:order-1 lg:block lg:space-y-3 lg:overflow-visible">
                                {images.map((image, index) => (
                                    <button
                                        key={`${image}-${index}`}
                                        type="button"
                                        onClick={() => setActiveImage(image)}
                                        className={`relative h-20 w-16 shrink-0 overflow-hidden rounded-lg border bg-card transition lg:h-28 lg:w-full ${
                                            activeImage === image ? "border-foreground ring-2 ring-foreground/20" : "border-border hover:border-muted-foreground"
                                        }`}
                                        aria-label={`${copy.viewImage} ${index + 1}`}
                                    >
                                        <Image src={optimizeCloudinaryUrl(image, 220)} alt="" fill className="object-contain p-1" />
                                    </button>
                                ))}
                            </div>

                            <div className="order-1 lg:order-2">
                                <div className="relative aspect-square overflow-hidden rounded-xl bg-muted lg:h-[680px] lg:aspect-auto xl:h-[720px]">
                                    {activeImage ? (
                                        <Image
                                            src={optimizeCloudinaryUrl(activeImage, 1400)}
                                            alt={card.name}
                                            fill
                                            priority
                                            sizes="(max-width: 1024px) 100vw, 52vw"
                                            className={`object-contain ${card.status === "sold" ? "grayscale" : ""}`}
                                        />
                                    ) : (
                                        <div className="flex h-full items-center justify-center text-muted-foreground">{copy.noImage}</div>
                                    )}
                                    {isUnavailable && (
                                        <div className="absolute left-5 top-5 rounded-full bg-red-600 px-4 py-1.5 text-sm font-bold text-white">
                                            {card.status === "sold" ? copy.sold : card.status === "in_transaction" ? copy.inTransaction : copy.unavailable}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <aside className="space-y-4">
                            <div className="overflow-hidden rounded-xl border bg-card shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
                                <div className="border-b p-5 md:p-6">
                                    <div className="mb-3 flex flex-wrap items-center gap-2">
                                        <Badge className="rounded-full bg-orange-500/15 px-3 py-1 text-orange-300 hover:bg-orange-500/15">
                                            {card.category}
                                        </Badge>
                                        {card.acceptOffers && (
                                            <Badge variant="outline" className="rounded-full border-amber-500/60 px-3 py-1 text-amber-400">
                                                {copy.bestOffer}
                                            </Badge>
                                        )}
                                        {seller?.seller_verified && (
                                            <Badge variant="outline" className="rounded-full border-emerald-500/50 px-3 py-1 text-emerald-400">
                                                <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                                                {copy.verifiedSeller}
                                            </Badge>
                                        )}
                                    </div>
                                    <h1 className="text-2xl font-semibold leading-tight tracking-normal md:text-3xl">
                                        {card.name}
                                    </h1>
                                    <div className="mt-4 flex items-center gap-3">
                                        {seller?.profile_image_url ? (
                                            <Image src={seller.profile_image_url} alt="" width={44} height={44} className="rounded-full object-cover" />
                                        ) : (
                                            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-500 font-bold text-white">
                                                {(seller?.display_name || "C").charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5">
                                                <span className="truncate font-semibold">{seller?.display_name || card.sellerName || copy.seller}</span>
                                                {seller?.seller_verified && <BadgeCheck className="h-4 w-4 shrink-0 text-orange-500" />}
                                            </div>
                                            <p className="text-sm text-muted-foreground">
                                                {seller?.seller_rating ? `${Number(seller.seller_rating).toFixed(1)}% ${copy.positive}` : copy.newSeller} · {seller?.seller_review_count || 0} {copy.itemsSold}
                                            </p>
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="rounded-full border-orange-500 text-orange-500 hover:bg-orange-500/10 hover:text-orange-400"
                                            onClick={() => void handleStartChat()}
                                            disabled={isOwner || startingChatOfferId === "listing"}
                                        >
                                            {startingChatOfferId === "listing" ? (
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            ) : (
                                                <MessageCircle className="mr-2 h-4 w-4" />
                                            )}
                                            {copy.message}
                                        </Button>
                                    </div>
                                </div>

                                <div className="space-y-5 p-5 md:p-6">
                                    <div className="rounded-lg border bg-background/70 p-4">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-sm text-muted-foreground">{copy.buyNow}</p>
                                                <p className="mt-1 text-4xl font-bold tracking-normal text-orange-400">{formatVND(card.price)}</p>
                                                {card.lastSoldPrice && (
                                                    <p className="mt-1 text-sm text-muted-foreground">{copy.approxLastSale} {formatVND(card.lastSoldPrice)}</p>
                                                )}
                                            </div>
                                            <Tag className="mt-2 h-8 w-8 text-orange-400" />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        {listingHighlights.map(({ label, value, icon: Icon }) => (
                                            <div key={label} className="rounded-lg border bg-background/50 p-3">
                                                <div className="mb-1 flex items-center gap-2 text-xs uppercase text-muted-foreground">
                                                    <Icon className="h-3.5 w-3.5" />
                                                    {label}
                                                </div>
                                                <p className="line-clamp-2 text-sm font-semibold">{value}</p>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
                                        <div className="rounded-lg border bg-background/40 px-2 py-3">
                                            <ShieldCheck className="mx-auto mb-1 h-4 w-4 text-emerald-400" />
                                            {copy.protectedCheckout}
                                        </div>
                                        <div className="rounded-lg border bg-background/40 px-2 py-3">
                                            <Truck className="mx-auto mb-1 h-4 w-4 text-sky-400" />
                                            {copy.fastShip}
                                        </div>
                                        <div className="rounded-lg border bg-background/40 px-2 py-3">
                                            <CreditCard className="mx-auto mb-1 h-4 w-4 text-violet-400" />
                                            {copy.paymentReady}
                                        </div>
                                    </div>

                                    {isOwner ? (
                                        <div className="flex flex-col gap-3 rounded-lg border border-orange-500/30 bg-orange-500/10 p-4 text-sm text-orange-300 sm:flex-row sm:items-center sm:justify-between">
                                            <span>{copy.ownListing}</span>
                                            {card.status === "active" && card.listingType === "sale" && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    className="shrink-0 bg-orange-500 text-white hover:bg-orange-600"
                                                    onClick={() => router.push(`/sell/edit/${card.id}`)}
                                                >
                                                    <Pencil className="mr-2 h-4 w-4" />
                                                    {copy.editListing}
                                                </Button>
                                            )}
                                        </div>
                                    ) : isUnavailable ? (
                                        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                                            {card.status === "sold"
                                                ? copy.boughtBySomeone
                                                : copy.reservedOrUnavailable}
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <Button className="h-12 w-full rounded-lg bg-orange-500 text-base font-bold text-white shadow-[0_0_28px_rgba(249,115,22,0.25)] hover:bg-orange-600" onClick={handleBuyNow}>
                                                <CreditCard className="mr-2 h-5 w-5" />
                                                {copy.buyNow}
                                            </Button>
                                            {card.acceptOffers && (
                                                <Button variant="outline" className="h-12 w-full rounded-lg border-amber-500/80 text-base font-bold text-amber-400 hover:bg-amber-500/10 hover:text-amber-300" onClick={handleMakeOffer}>
                                                    <HandCoins className="mr-2 h-5 w-5" />
                                                    {myOffer ? copy.viewOfferHistory : copy.makeOffer}
                                                </Button>
                                            )}
                                            <Button variant="outline" className="h-12 w-full rounded-lg border-emerald-500/70 text-base font-bold text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300" onClick={handleAddToCart}>
                                                <ShoppingCart className="mr-2 h-5 w-5" />
                                                {copy.addToCart}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {myOffer && !isOwner && (
                                <div className="rounded-lg border bg-muted/40 p-4 text-sm">
                                    <p className="text-muted-foreground">{copy.currentOffer}</p>
                                    <p className="text-lg font-semibold">{formatVND(myOffer.price)}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {copy.status}: {myOffer.status === "chosen" ? copy.chosen : myOffer.status === "rejected" ? copy.rejected : myOffer.status === "pending" ? copy.pending : copy.processed}
                                    </p>
                                </div>
                            )}

                            <div className="space-y-4 rounded-xl border bg-card p-5">
                                <h2 className="text-xl font-semibold">{copy.shippingPayments}</h2>
                                <div className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-4 text-sm">
                                    <span className="font-medium">{copy.shipping}:</span>
                                    <div>
                                        <p><b>{copy.ghnFee}</b></p>
                                        <p className="text-muted-foreground">{copy.sellerArea}</p>
                                    </div>
                                    <span className="font-medium">{copy.delivery}:</span>
                                    <div>
                                        <p>{copy.estimatedDelivery}</p>
                                        <p className="text-muted-foreground">{copy.sellerShips}</p>
                                    </div>
                                    <span className="font-medium">{copy.returns}:</span>
                                    <p>{copy.returnsPolicy}</p>
                                    <span className="font-medium">{copy.payments}:</span>
                                    <div className="flex flex-wrap gap-2">
                                        {["PayOS", "Wallet", "VISA", "Bank"].map(method => (
                                            <span key={method} className="rounded border bg-background px-2 py-1 text-xs font-semibold">{method}</span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </aside>
                    </section>

                    <section className="rounded-lg border bg-card">
                        <div className="border-b px-5 py-3">
                            <span className="rounded-t-md border bg-background px-4 py-3 text-sm font-semibold text-orange-500">{copy.aboutItem}</span>
                        </div>
                        <div className="p-5 md:p-6">
                            <div className="mb-6 flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                <span>{copy.sellerResponsibility}</span>
                                <span>{copy.itemNumber}: <b>{card.id.slice(0, 8).toUpperCase()}</b></span>
                            </div>
                            <h2 className="mb-5 text-xl font-bold tracking-normal md:text-2xl">{copy.itemSpecifics}</h2>
                            <div className="grid grid-cols-1 gap-x-12 gap-y-3 md:grid-cols-2">
                                {itemSpecifics.map(([label, value]) => (
                                    <div key={label} className="grid grid-cols-[120px_1fr] gap-3 border-b border-border/40 py-1.5 text-sm sm:grid-cols-[160px_1fr]">
                                        <span className="text-muted-foreground">{label}</span>
                                        <span className="font-medium [overflow-wrap:anywhere]">{value}</span>
                                    </div>
                                ))}
                            </div>
                            <h2 className="mb-4 mt-8 text-xl font-bold tracking-normal md:text-2xl">{copy.itemDescription}</h2>
                            <div className="min-h-32 whitespace-pre-line rounded-md bg-background p-4 text-sm leading-7 md:p-5">
                                {card.description || copy.noDetailedDescription}
                            </div>
                        </div>
                    </section>

                    {isOwner && (
                        <section className="space-y-3 rounded-lg border bg-card p-5">
                            <div className="flex items-center justify-between gap-3">
                                <h2 className="text-xl font-semibold">{copy.offers} ({offers.length})</h2>
                                <Badge variant="outline">{copy.sellerTools}</Badge>
                            </div>
                            {offers.length === 0 ? (
                                <p className="text-sm text-muted-foreground">{copy.noOffers}</p>
                            ) : (
                                <div className="space-y-3">
                                    {offers.map(offer => (
                                        <div key={offer.id} className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 md:flex-row md:items-center md:justify-between">
                                            <div>
                                                <p className="text-lg font-semibold">{formatVND(offer.price)}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {offer.buyerEmail} · {formatDistanceToNow(new Date(offer.createdAt), { addSuffix: true, locale: dateLocale })}
                                                </p>
                                                {offer.message && <p className="mt-1 text-sm text-muted-foreground">{offer.message}</p>}
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="border-orange-500 text-orange-500 hover:bg-orange-500/10 hover:text-orange-400"
                                                    onClick={() => void handleStartChat(offer.id)}
                                                    disabled={startingChatOfferId === offer.id}
                                                >
                                                    {startingChatOfferId === offer.id ? (
                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <MessageCircle className="mr-2 h-4 w-4" />
                                                    )}
                                                    {copy.chat}
                                                </Button>
                                                {offer.status === "pending" ? (
                                                    <>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="border-red-500/70 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                                                            onClick={() => handleRejectOffer(offer)}
                                                            disabled={!!acceptingOfferId || !!rejectingOfferId}
                                                        >
                                                            {rejectingOfferId === offer.id ? (
                                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                            ) : null}
                                                            {copy.reject}
                                                        </Button>
                                                        <Button size="sm" onClick={() => handleAcceptOffer(offer)} disabled={!!acceptingOfferId || !!rejectingOfferId}>
                                                            {acceptingOfferId === offer.id ? (
                                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                            ) : (
                                                                <CheckCircle className="mr-2 h-4 w-4" />
                                                            )}
                                                            {copy.accept}
                                                        </Button>
                                                    </>
                                                ) : (
                                                    <Badge className={`w-fit ${offer.status === "rejected" ? "bg-red-500" : "bg-green-500"}`}>
                                                        {offer.status === "chosen" ? copy.chosen : offer.status === "rejected" ? copy.reject : copy.processed}
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}

                    <section className="space-y-4 rounded-xl border bg-card p-5 md:p-6">
                        <h2 className="text-xl font-semibold">{copy.aboutSeller}</h2>
                        <div className="flex flex-wrap items-center gap-4">
                            {seller?.profile_image_url ? (
                                <Image src={seller.profile_image_url} alt="" width={72} height={72} className="h-16 w-16 rounded-full object-cover" />
                            ) : (
                                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-500 text-2xl font-bold text-white">
                                    {(seller?.display_name || "C").charAt(0).toUpperCase()}
                                </div>
                            )}
                            <div className="min-w-0">
                                <p className="flex items-center gap-1.5 text-lg font-semibold">
                                    <span className="truncate">{seller?.display_name || card.sellerName || copy.seller}</span>
                                    {seller?.seller_verified && <BadgeCheck className="h-4 w-4 shrink-0 text-orange-500" />}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {seller?.seller_rating ? `${Number(seller.seller_rating).toFixed(1)}% ${copy.positive}` : copy.newSeller} · {seller?.seller_review_count || 0} {copy.itemsSold}
                                </p>
                            </div>
                            {!isOwner && (
                                <Button
                                    variant="outline"
                                    className="rounded-full border-orange-500 font-bold text-orange-500 hover:bg-orange-500/10 hover:text-orange-400 sm:ml-auto"
                                    onClick={() => void handleStartChat()}
                                    disabled={startingChatOfferId === "listing"}
                                >
                                    {startingChatOfferId === "listing" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}
                                    {copy.messageSeller}
                                </Button>
                            )}
                        </div>
                    </section>

                    <RelatedRail title={copy.relatedItems} cards={displayRelatedCards} labels={{ cond: copy.condLabel, price: copy.priceLabel, sold: copy.sold, preOwned: copy.preOwned, contact: copy.contact }} />
                </div>
            </main>
            <Footer />

            <CheckoutModal
                open={checkoutOpen}
                onOpenChange={setCheckoutOpen}
                card={checkoutCard}
                sellerAddress={sellerAddress}
                onSuccess={() => {
                    setCheckoutOpen(false);
                    void fetchCard();
                }}
            />
            <OfferModal
                open={offerOpen}
                onOpenChange={setOfferOpen}
                card={card ? {
                    id: card.id,
                    name: card.name,
                    imageUrl: card.imageUrl,
                    price: card.price ?? 0,
                    sellerId: card.sellerId,
                    minOfferPercent: card.minOfferPercent ?? 0,
                } : null}
                onSuccess={(conversationId) => {
                    setOfferOpen(false);
                    void fetchOffers();
                    if (conversationId) {
                        setChatConversationId(conversationId);
                        setChatOpen(true);
                    }
                }}
            />
            <ChatDrawer
                open={chatOpen}
                onOpenChange={setChatOpen}
                initialConversationId={chatConversationId}
            />
        </div>
    );
}
