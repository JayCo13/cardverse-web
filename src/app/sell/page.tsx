
'use client';

import { namesMatch } from '@/lib/person-name';
import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShieldCheck, ShieldAlert, Upload, Loader2, Package, Plus, Clock, CheckCircle, XCircle, Phone, FileCheck, ChevronRight, ChevronLeft, Sparkles, AlertTriangle, MapPin, Truck, HandCoins, EyeOff, Eye, Pencil, Trash2 } from 'lucide-react';
import { type PickupAddress } from '@/components/pickup-address-picker';
import { ShippingQuotePreview } from '@/components/shipping-quote-preview';
import { ShopShippingSetup } from '@/components/shop-shipping-setup';
import { noDataLabel } from '@/lib/no-data-label';
import { carrierStatusColorClass, carrierStatusLabel } from '@/lib/carrier-status-labels';
import { ORDER_STATUS_CONFIG, orderStatusLabel } from '@/lib/order-status';
import { getAccountSummary, invalidateAccountSummary } from '@/lib/account-summary';
import { useAuth } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { useToast } from '@/hooks/use-toast';
import { useLocalization } from '@/context/localization-context';
import { flexibleProductsEnabled, productCopy } from '@/lib/product-listing';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { getCloudinarySignature, uploadImageDirectToCloudinary, type CloudinarySignaturePayload } from '@/lib/cloudinary-direct';
import { getCloudinaryKycScanUrl, toDisplaySafeUrl, optimizeCloudinaryUrl } from '@/lib/cloudinary-url';
import { isHeicFile, convertHeicToJpeg } from '@/lib/heic';
import { formatCompactCount } from '@/lib/format';
import { SenderAddressForm } from '@/components/sender-address-form';
import Link from 'next/link';
import Image from 'next/image';

type Verification = {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason?: string;
  created_at: string;
};

type SellerOrder = {
  id: string;
  status: string;
  carrier_status: string | null;
  carrier_status_at: string | null;
  amount: number;
  platform_fee: number;
  created_at: string;
  card: { name: string; image_url: string } | null;
};

type MyListing = {
  id: string;
  name: string;
  image_url: string | null;
  price: number | null;
  status: string;
  listing_visibility: 'visible' | 'hidden' | 'deleted';
  listing_type: string;
  category: string | null;
  condition: string | null;
  created_at: string;
};

type OrderSummary = { total: number; waitingShip: number; shipping: number; completed: number; totalEarnings: number };
type ListingSummary = { active: number; sold: number; draft: number; hidden: number; total: number };
type ListingFilter = 'all' | 'active' | 'sold' | 'draft' | 'hidden';
type ListingAction = 'hide' | 'restore' | 'delete';
type ListingPageState = { items: MyListing[]; nextCursor: string | null; loaded: boolean; loading: boolean; error: boolean };

const EMPTY_ORDER_SUMMARY: OrderSummary = { total: 0, waitingShip: 0, shipping: 0, completed: 0, totalEarnings: 0 };
const EMPTY_LISTING_SUMMARY: ListingSummary = { active: 0, sold: 0, draft: 0, hidden: 0, total: 0 };
const emptyListingPages = (): Record<ListingFilter, ListingPageState> => ({
  all: { items: [], nextCursor: null, loaded: false, loading: false, error: false },
  active: { items: [], nextCursor: null, loaded: false, loading: false, error: false },
  sold: { items: [], nextCursor: null, loaded: false, loading: false, error: false },
  draft: { items: [], nextCursor: null, loaded: false, loading: false, error: false },
  hidden: { items: [], nextCursor: null, loaded: false, loading: false, error: false },
});

const KpiCard = memo(function KpiCard({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className={`min-w-0 rounded-lg border p-3 ${tone}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-base font-bold tabular-nums sm:text-lg lg:text-xl">{value}</p>
    </div>
  );
});

const ListingRow = memo(function ListingRow({ listing, statusLabel, price, pendingOffers, offerLabel, editLabel, hideLabel, restoreLabel, deleteLabel, onAction }: {
  listing: MyListing;
  statusLabel: string;
  price: string;
  pendingOffers: number;
  offerLabel: string;
  editLabel: string;
  hideLabel: string;
  restoreLabel: string;
  deleteLabel: string;
  onAction: (listing: MyListing, action: ListingAction) => void;
}) {
  const hidden = listing.listing_visibility === 'hidden';
  return (
    <div className="flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0">
      <Link href={hidden ? `/sell/edit/${listing.id}` : `/cards/${listing.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded bg-muted">
          {listing.image_url ? (
            <Image src={optimizeCloudinaryUrl(listing.image_url, 160)} alt="" fill sizes="56px" className="object-cover" />
          ) : (
            <Package className="m-auto h-full w-5 text-muted-foreground/40" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{listing.name}</p>
          <p className="mt-0.5 text-sm font-semibold text-primary">{price}</p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">{statusLabel}</Badge>
      </Link>
      {pendingOffers > 0 && (
        <Button variant="outline" size="sm" asChild className="h-9 shrink-0 border-orange-500/40 px-2 text-orange-400">
          <Link href={`/offers?view=received&cardId=${listing.id}`} aria-label={`${pendingOffers} ${offerLabel}`}>
            <HandCoins className="mr-1 h-3.5 w-3.5" />{pendingOffers}
          </Link>
        </Button>
      )}
      <div className="flex w-full justify-end gap-2 pl-[68px] sm:w-auto sm:pl-0">
        {hidden ? <>
          <Button variant="ghost" size="sm" asChild className="h-8 px-2">
            <Link href={`/sell/edit/${listing.id}`}><Pencil className="mr-1 h-3.5 w-3.5" />{editLabel}</Link>
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => onAction(listing, 'restore')}>
            <Eye className="mr-1 h-3.5 w-3.5" />{restoreLabel}
          </Button>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-red-400 hover:text-red-300" onClick={() => onAction(listing, 'delete')}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />{deleteLabel}
          </Button>
        </> : listing.status === 'active' ? (
          <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground" onClick={() => onAction(listing, 'hide')}>
            <EyeOff className="mr-1 h-3.5 w-3.5" />{hideLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
});

const OrderRow = memo(function OrderRow({ order, statusLabel, statusClass, carrierLabel, carrierClass, unknownCard, date, price }: {
  order: SellerOrder;
  statusLabel: string;
  statusClass: string;
  carrierLabel: string | null;
  carrierClass: string;
  unknownCard: string;
  date: string;
  price: string;
}) {
  return (
    <Link
      href={`/orders/${order.id}`}
      className="flex items-center gap-3 border-b py-2 transition-colors last:border-b-0 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded bg-muted">
        {order.card?.image_url ? (
          <Image src={optimizeCloudinaryUrl(order.card.image_url, 120)} alt="" fill sizes="40px" className="object-cover" />
        ) : (
          <Package className="m-auto h-full w-4 text-muted-foreground/40" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{order.card?.name || unknownCard}</p>
        <p className="text-xs text-muted-foreground">{date}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold">{price}</p>
        <Badge variant="outline" className={`mt-0.5 text-[10px] ${statusClass}`}>{statusLabel}</Badge>
        {carrierLabel && <p className={`mt-1 text-[10px] font-medium ${carrierClass}`}>{carrierLabel}</p>}
      </div>
    </Link>
  );
});

/**
 * Identity session handled by the external provider (Didit). The browser only
 * ever sees these fields — the document images, MRZ and biometric scores stay
 * server-side.
 */
type KycSession = {
  id: string;
  provider: string;
  status:
    | 'Not Started'
    | 'In Progress'
    | 'Awaiting User'
    | 'Approved'
    | 'Declined'
    | 'In Review'
    | 'Resubmitted'
    | 'Abandoned'
    | 'Expired'
    | 'Kyc Expired';
  verified_full_name: string | null;
  consumed: boolean;
  created_at: string;
};

type UploadedKycAssets = {
  bankOriginalUrl: string | null;
  bankJpgUrl: string | null;
};

/**
 * Read a JSON API response without assuming the body is JSON.
 *
 * A 404, a proxy error page, or a redirect to HTML all arrive here as
 * `<!DOCTYPE ...`, and calling res.json() on that throws a parse error that
 * tells the user nothing. Surface the status instead, which is what actually
 * identifies the problem.
 */
async function readJson(res: Response): Promise<Record<string, any>> {
    const text = await res.text();
    try {
        return JSON.parse(text) as Record<string, any>;
    } catch {
        // Name the endpoint and the status. Without them the message says only
        // that something returned a page, which is the same for a route that
        // 404s, one that times out, and one that crashed — three different
        // problems that were being reported identically.
        const path = new URL(res.url, window.location.origin).pathname;
        const isHtml = text.trimStart().startsWith('<');
        throw new Error(
            isHtml
                ? `Máy chủ lỗi khi gọi ${path} (HTTP ${res.status}). Nhiều khả năng hàm bị quá thời gian hoặc dừng đột ngột.`
                : `Phản hồi không hợp lệ từ ${path} (HTTP ${res.status}).`
        );
    }
}

/** Bank as served by /api/banks (VietQR directory, lookup-capable only). */
type Bank = {
  code: string;
  bin: string;
  name: string;
  shortName: string;
  logo: string;
};

export default function SellPage() {
  const desktop = useMediaQuery('(min-width: 768px)');
  const router = useRouter();
  const { t, locale } = useLocalization();
  const { user, profile, isLoading: authLoading } = useAuth();
  const { setOpen } = useAuthModal();
  const { toast } = useToast();
  const [verification, setVerification] = useState<Verification | null>(null);
  const [isLoadingVerification, setIsLoadingVerification] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sellerOrders, setSellerOrders] = useState<SellerOrder[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [orderSummary, setOrderSummary] = useState<OrderSummary>(EMPTY_ORDER_SUMMARY);
  const [listingSummary, setListingSummary] = useState<ListingSummary>(EMPTY_LISTING_SUMMARY);
  const sellerOrdersRequest = useRef<Promise<boolean> | null>(null);
  const sellerOrdersLastStartedAt = useRef(0);
  const [listingTab, setListingTab] = useState<Exclude<ListingFilter, 'all'>>('active');
  const [listingPages, setListingPages] = useState<Record<ListingFilter, ListingPageState>>(emptyListingPages);
  const listingPagesRef = useRef(listingPages);
  const listingRequests = useRef<Partial<Record<ListingFilter, Promise<boolean>>>>({});
  // Bumped by every local listing change. A listings or dashboard request
  // that began before the bump carries pre-change rows and counts, and must
  // not overwrite what applyListingChange() just wrote.
  const listingEpoch = useRef(0);
  const [pendingOfferCounts, setPendingOfferCounts] = useState<Record<string, number>>({});
  const [pendingOffersTotal, setPendingOffersTotal] = useState(0);
  const [listingAction, setListingAction] = useState<{ listing: MyListing; action: ListingAction } | null>(null);
  const [isManagingListing, setIsManagingListing] = useState(false);
  const [isLoadingAddress, setIsLoadingAddress] = useState(true);
  // The one carrier-owned sender address. Null after loading means the seller
  // has not configured one yet; the form then opens for the first setup.
  const [goshipPickup, setGoshipPickup] = useState<PickupAddress | null>(null);
  // Shop-level shipping options: selected carriers + per-carrier tiered fees
  // (formatted strings like "15.000") keyed by carrier code.
  const [shippingConfigOpen, setShippingConfigOpen] = useState(false);

  const [shippingSectionOpen, setShippingSectionOpen] = useState(false);

  /**
   * Whether the desktop floating action has taken over from the header one.
   *
   * The button in the title row scrolls away with the title. Rather than pin the
   * header, the action reappears at the corner once it is gone, so it is never
   * more than a glance away no matter how long the listing grid runs.
   */
  const [showFloatingListing, setShowFloatingListing] = useState(false);
  // Wizard step
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1: identity verification (external provider) + payout details
  const [fullName, setFullName] = useState('');
  const [bankName, setBankName] = useState('');
  const [kycSession, setKycSession] = useState<KycSession | null>(null);
  const [isStartingKyc, setIsStartingKyc] = useState(false);
  const [isRefreshingKyc, setIsRefreshingKyc] = useState(false);
  const [kycPollingTimedOut, setKycPollingTimedOut] = useState(false);
  const [kycError, setKycError] = useState<string | null>(null);

  const [bankScreenshotFile, setBankScreenshotFile] = useState<File | null>(null);
  const [processingType, setProcessingType] = useState<'bank' | null>(null);
  const [editableBankAccountName, setEditableBankAccountName] = useState('');
  const [editableBankAccountNumber, setEditableBankAccountNumber] = useState('');

  // Bank account verification (VietQR → NAPAS)
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankBin, setBankBin] = useState('');
  const [isLookingUpBank, setIsLookingUpBank] = useState(false);
  const [bankLookupError, setBankLookupError] = useState<string | null>(null);
  // True once the banking network confirmed the holder AND it matches the ID.
  const [isBankVerified, setIsBankVerified] = useState(false);
  // Lookup could not run at all (provider outage, quota, plan). Not the
  // seller's fault, so they fall back to typing the holder name and the
  // submission goes to manual review rather than being blocked.
  const [isBankLookupUnavailable, setIsBankLookupUnavailable] = useState(false);
  const [uploadedKycAssets, setUploadedKycAssets] = useState<UploadedKycAssets>({
    bankOriginalUrl: null,
    bankJpgUrl: null,
  });
  const [kycUploadSignature, setKycUploadSignature] = useState<CloudinarySignaturePayload | null>(null);
  const copy = locale === 'ja-JP'
    ? {
        signInToSell: 'カードを売るにはログインしてください',
        signIn: 'ログイン',
        pendingTitle: '最終管理者確認を待っています',
        pendingDesc: 'プロフィールは自動事前審査を通過しました。管理者ができるだけ早く最終確認します。',
        submittedAt: '送信日時',
        rejectedTitle: '申請が却下されました',
        reason: '理由',
        rejectedFallback: '不明です。サポートに連絡してください。',
        resubmit: '再申請する',
        dashboardTitle: 'Seller Dashboard',
        dashboardDesc: '出品と注文を管理',
        listCard: '新しいカードを出品',
        waitingShip: '発送待ち',
        shipping: '配送中',
        completed: '完了',
        totalEarnings: '総収益',
        pickupAddress: '発送元住所',
        pickupAddressDesc: '荷物を送り出す住所です。購入時の受取先住所とは別で、そちらはプロフィールで変更します。',
        update: '更新',
        pickupNotice: 'カードを出品する前に集荷先住所を設定してください。この住所を使って購入者向けの送料を計算します。',
        savePickup: '集荷先住所を保存',
        cancel: 'キャンセル',
        myListings: '自分の出品',
        activeListings: '{count}件を販売中',
        viewMarketplace: 'マーケットを見る',
        noListings: 'まだカードを出品していません。',
        firstListing: '最初のカードを出品',
        sold: '販売済み',
        active: '販売中',
        recentOrders: '最近の注文',
        viewAll: 'すべて見る',
        noOrders: '注文はまだありません',
        unknownCard: '不明なカード',
        verifyDesc: 'CardVerseHubでカードを出品するには、3つの確認ステップを完了してください。',
        step1: '本人確認',
        step2: '電話番号確認',
        step3: '確認して送信',
      }
    : locale === 'vi-VN'
      ? {
          signInToSell: 'Đăng nhập để bán thẻ',
          signIn: 'Đăng nhập',
          pendingTitle: 'Đang chờ Admin duyệt lần cuối',
          pendingDesc: 'Hồ sơ của bạn đã được hệ thống tiền duyệt thành công. Admin sẽ xác nhận lần cuối trong thời gian sớm nhất.',
          submittedAt: 'Gửi lúc',
          rejectedTitle: 'Yêu cầu bị từ chối',
          reason: 'Lý do',
          rejectedFallback: 'Không rõ. Vui lòng liên hệ hỗ trợ.',
          resubmit: 'Gửi lại yêu cầu xác minh',
          dashboardTitle: 'Seller Dashboard',
          dashboardDesc: 'Quản lý bài đăng và đơn hàng',
          listCard: 'Đăng thẻ mới',
          waitingShip: 'Chờ giao hàng',
          shipping: 'Đang giao',
          completed: 'Hoàn tất',
          totalEarnings: 'Tổng thu nhập',
          pickupAddress: 'Địa chỉ gửi hàng',
          pickupAddressDesc: 'Nơi bạn gửi hàng đi. Địa chỉ nhận hàng khi mua được sửa tại trang Hồ sơ.',
          update: 'Cập nhật',
          pickupNotice: 'Bạn cần thiết lập địa chỉ lấy hàng trước khi đăng bán thẻ. Chúng tôi dùng địa chỉ này để tính cước phí ship cho người mua.',
          savePickup: 'Lưu địa chỉ lấy hàng',
          cancel: 'Hủy',
          myListings: 'Bài đăng của tôi',
          activeListings: '{count} đang bán',
          viewMarketplace: 'Xem trên chợ',
          noListings: 'Bạn chưa đăng bán thẻ nào.',
          firstListing: 'Đăng bán thẻ đầu tiên',
          sold: 'Đã bán',
          active: 'Đang bán',
          recentOrders: 'Đơn hàng gần đây',
          viewAll: 'Xem tất cả',
          noOrders: 'Chưa có đơn hàng nào',
          unknownCard: 'Thẻ không xác định',
          verifyDesc: 'Hoàn thành 3 bước xác minh để bắt đầu đăng bán thẻ trên CardVerseHub.',
          step1: 'Xác minh danh tính',
          step2: 'Xác minh số điện thoại',
          step3: 'Xác nhận và gửi',
        }
      : {
          signInToSell: 'Sign in to sell cards',
          signIn: 'Sign in',
          pendingTitle: 'Waiting for final admin review',
          pendingDesc: 'Your profile passed the automated pre-check. Admin will confirm it as soon as possible.',
          submittedAt: 'Submitted at',
          rejectedTitle: 'Request rejected',
          reason: 'Reason',
          rejectedFallback: 'Unknown. Please contact support.',
          resubmit: 'Submit verification again',
          dashboardTitle: 'Seller Dashboard',
          dashboardDesc: 'Manage listings and orders',
            listCard: 'List a new card',
          waitingShip: 'Waiting to ship',
          shipping: 'Shipping',
          completed: 'Completed',
          totalEarnings: 'Total earnings',
          pickupAddress: 'Where you ship from',
        pickupAddressDesc: 'Where your parcels leave from. Change the address you receive at when buying on your profile.',
          update: 'Update',
          pickupNotice: 'Set a pickup address before listing cards. We use this address to calculate shipping fees for buyers.',
          savePickup: 'Save pickup address',
          cancel: 'Cancel',
          myListings: 'My listings',
          activeListings: '{count} active',
          viewMarketplace: 'View marketplace',
          noListings: 'You have not listed any cards yet.',
          firstListing: 'List your first card',
          sold: 'Sold',
          active: 'Active',
          recentOrders: 'Recent orders',
          viewAll: 'View all',
          noOrders: 'No orders yet',
          unknownCard: 'Unknown card',
          verifyDesc: 'Complete 3 verification steps to start listing cards on CardVerseHub.',
          step1: 'Identity verification',
          step2: 'Phone verification',
          step3: 'Review and submit',
        };
  const tx = (vi: string, en: string, ja: string) => (locale === 'ja-JP' ? ja : locale === 'vi-VN' ? vi : en);
  // With non-card listings on, the seller is no longer only listing cards, so
  // the two calls to action stop saying so.
  const listCardLabel = flexibleProductsEnabled ? productCopy(locale).listNew : copy.listCard;
  const firstListingLabel = flexibleProductsEnabled ? productCopy(locale).firstListing : copy.firstListing;
  useEffect(() => {
    // Reads on scroll only — no layout is measured, so this cannot thrash.
    const onScroll = () => setShowFloatingListing(window.scrollY > 220);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const goToNewListing = () => router.push('/sell/create');

  const handleFileChange = async (type: 'bank', file: File | null) => {
    let processed = file;

    // Convert HEIC/HEIF to JPEG immediately on selection so nothing downstream
    // ever has to deal with HEIC (preview, upload, scan all use JPEG).
    if (file && isHeicFile(file)) {
      try {
        setProcessingType(type);
        processed = await convertHeicToJpeg(file);
      } catch (err) {
        console.error('[KYC] HEIC → JPEG conversion failed:', err);
        toast({
          variant: 'destructive',
          title: tx('Không đọc được ảnh', 'Unable to read image', '画像を読み込めません'),
          description: tx('Vui lòng thử lại hoặc chọn ảnh định dạng JPG/PNG.', 'Try again or choose a JPG/PNG image.', 'もう一度試すか、JPG/PNG画像を選択してください。'),
        });
        setProcessingType(null);
        return;
      } finally {
        setProcessingType(null);
      }
    }

    setBankScreenshotFile(processed);
    setUploadedKycAssets({ bankOriginalUrl: null, bankJpgUrl: null });
  };

  const getOrCreateKycSignature = async () => {
    if (kycUploadSignature) {
      return kycUploadSignature;
    }

    const startedAt = performance.now();
    const signature = await getCloudinarySignature();
    console.log(`[KYC Upload] Batch signature ready in ${(performance.now() - startedAt).toFixed(0)}ms`);
    setKycUploadSignature(signature);
    return signature;
  };

  // Step 2: contact phone
  const [phoneNumber, setPhoneNumber] = useState('');
  // Submit outcomes other than success. `blockedAxis` is terminal — re-submitting
  // returns the same 409 — so it gets a modal rather than a dismissible toast.
  const [blockedAxis, setBlockedAxis] = useState<'document' | 'bank' | 'both' | null>(null);
  const [retryFlags, setRetryFlags] = useState<string[]>([]);

  const isKycApproved = kycSession?.status === 'Approved' && !kycSession.consumed;
  const isKycInFlight = kycSession?.status === 'In Progress'
    || kycSession?.status === 'Not Started'
    || kycSession?.status === 'Awaiting User'
    || kycSession?.status === 'In Review'
    || kycSession?.status === 'Resubmitted';
  const isKycFailed = kycSession?.status === 'Declined'
    || kycSession?.status === 'Abandoned'
    || kycSession?.status === 'Expired'
    || kycSession?.status === 'Kyc Expired';
  const isKycUnderReview = kycSession?.status === 'In Review';

  // The name the provider actually read off the document. The server re-checks
  // every condition below before approving; this only keeps the user from
  // walking into a submission that is certain to bounce.
  // Use the same comparison as the server, which makes the final decision.
  const verifiedName = kycSession?.verified_full_name || '';
  const isSubmittedNameMatch = namesMatch(fullName, verifiedName)
    && namesMatch(editableBankAccountName, verifiedName);

  useEffect(() => {
    if (!authLoading && !user) setOpen(true);
  }, [authLoading, user, setOpen]);

  /**
   * Arrive from /sell/create's "set up shipping" gate and land on the section,
   * open, rather than at the top of a long dashboard.
   *
   * The native hash jump fires before the dashboard has rendered its cards, so
   * scroll once the shipping state has actually loaded. On a phone the section
   * is a drawer, so open that instead of scrolling to a collapsed row.
   */
  useEffect(() => {
    if (isLoadingVerification) return;
    if (typeof window === 'undefined' || window.location.hash !== '#shop-shipping') return;
    const target = document.getElementById('shop-shipping');
    if (!target) return;
    setShippingSectionOpen(true);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (window.matchMedia('(max-width: 767px)').matches) setShippingConfigOpen(true);
  }, [isLoadingVerification]);

  useEffect(() => {
    if (authLoading) return;
    if (user) {
      fetchVerification();
      // Pick up a session the user finished in another tab or before a reload.
      refreshKycSession({ silent: true });
    } else {
      setIsLoadingVerification(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  const fetchVerification = async (attempt = 0) => {
    try {
      const res = await fetch('/api/seller/verify');
      if (!res.ok) {
        // Right after a page refresh the Supabase auth cookie may not be synced
        // server-side yet, so this returns 401. Retry a few times before giving
        // up — otherwise an already-registered seller wrongly sees the signup
        // form again instead of their pending/approved status.
        if (attempt < 4) {
          // Awaited (not fire-and-forget) so a caller waiting on this promise
          // is covered for the whole retry chain, not just the first attempt.
          await new Promise(resolve => setTimeout(resolve, 600));
          return fetchVerification(attempt + 1);
        }
        setIsLoadingVerification(false);
        return;
      }
      const data = await res.json();
      setVerification(data.verification ?? null);

      if (data.verification?.status === 'approved') {
        // Usually already in flight from the profile hint below; only redo
        // the parts that failed (e.g. a 401 while the cookie was syncing).
        const warm = dashboardWarm.current;
        dashboardWarm.current = null;
        if (warm) {
          void warm.then(results => { if (results.some(ok => !ok)) void loadDashboard(); });
        } else {
          void loadDashboard();
        }
      }
      setIsLoadingVerification(false);
    } catch (err) {
      console.error('Failed to fetch verification:', err);
      if (attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 600));
        return fetchVerification(attempt + 1);
      }
      setIsLoadingVerification(false);
    }
  };

  const fetchSellerOrders = useCallback((options?: { background?: boolean }) => {
    // A tab restore commonly emits visibilitychange, focus and pageshow as one
    // burst. Share the active request, then ignore the tail of that burst so
    // this endpoint (which also performs order lifecycle maintenance) is not
    // called two or three times for the same user action.
    if (sellerOrdersRequest.current) return sellerOrdersRequest.current;
    const now = Date.now();
    if (options?.background && now - sellerOrdersLastStartedAt.current < 1_000) {
      return Promise.resolve(true);
    }
    sellerOrdersLastStartedAt.current = now;
    if (!options?.background) setIsLoadingOrders(true);

    const epoch = listingEpoch.current;
    const request = (async () => {
      try {
        const res = await fetch('/api/seller/dashboard', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setSellerOrders(data.recentOrders || []);
        setOrderSummary(data.summary?.orders || EMPTY_ORDER_SUMMARY);
        // Orders are untouched by a listing action; the listing counts are
        // not, so a response from before one is stale on that half only.
        if (epoch === listingEpoch.current) {
          setListingSummary(data.summary?.listings || EMPTY_LISTING_SUMMARY);
        }
        return true;
      } catch (err) {
        console.error('Failed to fetch seller orders:', err);
        return false;
      } finally {
        if (!options?.background) setIsLoadingOrders(false);
      }
    })();

    sellerOrdersRequest.current = request;
    void request.finally(() => {
      if (sellerOrdersRequest.current === request) sellerOrdersRequest.current = null;
    });
    return request;
  }, []);

  useEffect(() => {
    if (!user || verification?.status !== 'approved') return;

    const refreshOrders = () => void fetchSellerOrders({ background: true });
    const refreshVisibleOrders = () => {
      if (document.visibilityState === 'visible') refreshOrders();
    };

    window.addEventListener('focus', refreshOrders);
    window.addEventListener('pageshow', refreshOrders);
    document.addEventListener('visibilitychange', refreshVisibleOrders);
    return () => {
      window.removeEventListener('focus', refreshOrders);
      window.removeEventListener('pageshow', refreshOrders);
      document.removeEventListener('visibilitychange', refreshVisibleOrders);
    };
  }, [fetchSellerOrders, user, verification?.status]);

  const fetchSellerListings = useCallback((filter: ListingFilter, append = false) => {
    const activeRequest = listingRequests.current[filter];
    if (activeRequest) return activeRequest;

    const current = listingPagesRef.current[filter];
    if (append && !current.nextCursor) return Promise.resolve(true);

    const loadingState = { ...current, loading: true, error: false };
    listingPagesRef.current = { ...listingPagesRef.current, [filter]: loadingState };
    setListingPages(listingPagesRef.current);

    const epoch = listingEpoch.current;
    const request = (async () => {
      try {
        const params = new URLSearchParams({
          status: filter,
          limit: String(filter === 'all' ? 8 : 5),
        });
        if (append && current.nextCursor) params.set('cursor', current.nextCursor);
        const res = await fetch(`/api/seller/listings?${params}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        if (epoch !== listingEpoch.current) {
          // A listing was hidden, restored or deleted while this was in
          // flight. `current` is a snapshot from before that, so appending to
          // it would bring the removed row back. Drop the result; a page the
          // change left unloaded is fetched again from the fresh state.
          const latest = listingPagesRef.current[filter];
          listingPagesRef.current = { ...listingPagesRef.current, [filter]: { ...latest, loading: false } };
          setListingPages(listingPagesRef.current);
          delete listingRequests.current[filter];
          if (!latest.loaded) void fetchSellerListings(filter);
          return true;
        }

        const next: ListingPageState = {
          items: append ? [...current.items, ...(data.items || [])] : (data.items || []),
          nextCursor: data.nextCursor || null,
          loaded: true,
          loading: false,
          error: false,
        };
        listingPagesRef.current = { ...listingPagesRef.current, [filter]: next };
        setListingPages(listingPagesRef.current);
        return true;
      } catch (err) {
        console.error('Failed to fetch seller listings:', err);
        const failed = { ...listingPagesRef.current[filter], loaded: true, loading: false, error: true };
        listingPagesRef.current = { ...listingPagesRef.current, [filter]: failed };
        setListingPages(listingPagesRef.current);
        return false;
      }
    })();

    listingRequests.current[filter] = request;
    // Only our own slot: the stale branch above may already have started the
    // replacement request under this filter.
    void request.finally(() => {
      if (listingRequests.current[filter] === request) delete listingRequests.current[filter];
    });
    return request;
  }, []);

  const activeListingFilter: ListingFilter = listingTab;

  useEffect(() => {
    if (!user || verification?.status !== 'approved') return;
    if (!listingPagesRef.current[activeListingFilter].loaded) {
      void fetchSellerListings(activeListingFilter);
    }
  }, [activeListingFilter, fetchSellerListings, user, verification?.status]);

  /**
   * The same counts the header badge reads, from the same request.
   *
   * The dashboard and the header both wanted the seller's pending offers and
   * each asked for them separately, so opening /sell spent two round trips on
   * one number. They now share whatever is already in flight.
   */
  const fetchOfferSummary = async (options?: { force?: boolean }) => {
    if (!user) return false;
    try {
      const summary = await getAccountSummary(user.id, options);
      if (!summary) return false;
      setPendingOffersTotal(summary.receivedPending);
      setPendingOfferCounts(summary.cardPendingCounts);
      return true;
    } catch (err) {
      console.error('Failed to fetch offer summary:', err);
      return false;
    }
  };

  /**
   * Move one listing between tabs locally after `manage_own_listing` succeeds.
   *
   * The RPC only permits three transitions — visible+active → hidden, hidden →
   * visible+active, hidden → deleted — so the counts can be adjusted here with
   * the same rules `get_seller_dashboard_summary` counts by. The tab the row
   * moves into is marked unloaded rather than patched: its order is by
   * created_at, and the next visit fetches it in the right order anyway.
   */
  const applyListingChange = (listing: MyListing, action: ListingAction, moved: boolean) => {
    listingEpoch.current++;
    const target: 'visible' | 'hidden' | 'deleted' = action === 'hide' ? 'hidden' : action === 'restore' ? 'visible' : 'deleted';
    const unloaded: ListingPageState = { items: [], nextCursor: null, loaded: false, loading: false, error: false };
    const pages = { ...listingPagesRef.current };
    for (const key of Object.keys(pages) as ListingFilter[]) {
      const page = pages[key];
      // Every permitted transition involves an `active` card, so a visible
      // outcome lands in the active tab and never in sold or draft.
      const stillBelongs = key === 'all' ? target !== 'deleted'
        : key === 'hidden' ? target === 'hidden'
          : key === 'active' ? target === 'visible'
            : false;
      if (page.items.some(item => item.id === listing.id)) {
        pages[key] = stillBelongs
          ? { ...page, items: page.items.map(item => item.id === listing.id ? { ...item, listing_visibility: target } : item) }
          : { ...page, items: page.items.filter(item => item.id !== listing.id) };
      } else if (page.loaded && stillBelongs) {
        pages[key] = unloaded;
      }
    }
    listingPagesRef.current = pages;
    setListingPages(pages);

    if (!moved) return;
    setListingSummary(prev => {
      const dec = (n: number) => Math.max(0, n - 1);
      if (action === 'hide') return { ...prev, active: dec(prev.active), hidden: prev.hidden + 1 };
      if (action === 'restore') return { ...prev, hidden: dec(prev.hidden), active: prev.active + 1 };
      return { ...prev, hidden: dec(prev.hidden), total: dec(prev.total) };
    });
  };

  const manageListing = async () => {
    if (!listingAction || isManagingListing) return;
    setIsManagingListing(true);
    try {
      const response = await fetch(`/api/marketplace/listings/${listingAction.listing.id}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: listingAction.action }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.code === 'listing_transaction_locked'
          ? tx('Listing đang có offer đã chọn, thanh toán hoặc đơn hàng nên chưa thể thay đổi.', 'This listing has a selected offer, payment, or active order and cannot be changed yet.', '選択済みオファー、支払い、または進行中の注文があるため変更できません。')
          : payload?.code === 'seller_not_approved'
            ? tx('Tài khoản seller hiện không đủ điều kiện để hiện lại bài.', 'This seller account is not eligible to restore the listing.', '現在この出品を再公開できる販売者状態ではありません。')
            : tx('Không thể cập nhật listing lúc này.', 'Could not update the listing.', '現在出品を更新できません。');
        throw new Error(message);
      }

      const action = listingAction.action;
      const rejectedCount = Number(payload?.rejectedOfferCount || 0);

      // The RPC has already told us the outcome, so show it now rather than
      // refetching everything and holding the dialog open meanwhile. This used
      // to wipe every tab, flip the grid to skeletons, and wait on three
      // requests (one of which does order maintenance first) before the toast
      // — two to three seconds of spinner for a one-row change.
      applyListingChange(listingAction.listing, action, !payload?.replayed);
      setListingAction(null);
      toast({
        title: action === 'hide'
          ? tx('Đã ẩn listing', 'Listing hidden', '出品を非表示にしました')
          : action === 'restore'
            ? tx('Đã hiện lại listing', 'Listing restored', '出品を再公開しました')
            : tx('Đã xóa listing', 'Listing deleted', '出品を削除しました'),
        description: action === 'hide' && rejectedCount > 0
          ? tx(`${rejectedCount} offer đang chờ đã được từ chối.`, `${rejectedCount} pending offer(s) were rejected.`, `保留中のオファー${rejectedCount}件を拒否しました。`)
          : undefined,
      });

      // Reconcile in the background. The offer counts moved (hide rejects
      // pending offers), and the header reacts to the same event, so one
      // dispatch refreshes both from a single shared request. The dashboard
      // read is `background` so it does not put the grid back into skeletons.
      invalidateAccountSummary();
      window.dispatchEvent(new CustomEvent('cardverse:offers-updated'));
      // A dashboard read already in flight (a focus refresh, say) predates
      // the change and would only be joined, not replaced — so queue ours
      // behind it. Its own listing counts are dropped by the epoch check.
      const stale = sellerOrdersRequest.current;
      void (stale ?? Promise.resolve()).then(() => {
        sellerOrdersLastStartedAt.current = 0; // past the burst throttle
        return fetchSellerOrders({ background: true });
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: tx('Không thể cập nhật listing', 'Could not update listing', '出品を更新できません'),
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsManagingListing(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    // Forced, not invalidated first: the header reacts to the same event and
    // the two reads share one request (see FORCE_SHARE_MS in account-summary).
    const refresh = () => void fetchOfferSummary({ force: true });
    window.addEventListener('cardverse:offers-updated', refresh);
    return () => window.removeEventListener('cardverse:offers-updated', refresh);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchPickupAddress = async () => {
    if (!user) return false;
    setIsLoadingAddress(true);
    try {
      const response = await fetch('/api/shipping/pickup-address', { cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
      setGoshipPickup((body?.data || null) as PickupAddress | null);
      return true;
    } catch (err) {
      console.error('Failed to fetch pickup address:', err);
      return false;
    } finally {
      setIsLoadingAddress(false);
    }
  };

  /**
   * Everything the approved-seller dashboard shows, in one parallel batch.
   *
   * The dashboard used to wait for /api/seller/verify before asking for any
   * of it. The auth profile already carries `seller_verified`, so when that
   * says yes the batch starts alongside the verify call; the verify result
   * still decides what is rendered, and re-runs the batch if any part failed.
   */
  const loadDashboard = () =>
    Promise.all([fetchSellerOrders(), fetchSellerListings('active'), fetchOfferSummary(), fetchPickupAddress()]);
  const dashboardWarm = useRef<Promise<boolean[]> | null>(null);

  useEffect(() => {
    if (authLoading || !user || !profile?.seller_verified || dashboardWarm.current) return;
    if (!isLoadingVerification) return; // verify already answered; nothing to get ahead of
    dashboardWarm.current = loadDashboard();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, profile?.seller_verified]);

  // Format a raw money string with thousand separators, e.g. "15000" → "15.000".
  const formatVndInput = (v: string) => {
    const d = (v || '').replace(/[^\d]/g, '');
    return d ? Number(d).toLocaleString('vi-VN') : '';
  };

  const uploadBankScreenshot = async (bankFile: File) => {
    if (uploadedKycAssets.bankOriginalUrl && uploadedKycAssets.bankJpgUrl) {
      return uploadedKycAssets;
    }

    const signature = await getOrCreateKycSignature();
    const upload = await uploadImageDirectToCloudinary(bankFile, signature);
    const next: UploadedKycAssets = {
      bankOriginalUrl: toDisplaySafeUrl(bankFile.name, upload.secureUrl),
      bankJpgUrl: getCloudinaryKycScanUrl(upload.secureUrl),
    };

    setUploadedKycAssets(next);
    return next;
  };

  // ── Identity verification via the external provider ──
  //
  // We never touch the ID document ourselves: the provider hosts the capture
  // flow (document + liveness + face match), and its verdict reaches us through
  // a signed webhook. The browser only learns the resulting status.

  /**
   * `poll` decides whether the server may call the provider.
   *
   * Only a user who is actually waiting on a verdict needs that: the in-flight
   * poll loop below and the explicit "check again" buttons. A plain page load
   * reads the stored status instead, which is what the webhook keeps current
   * and costs a database read rather than a live call to Didit.
   */
  const refreshKycSession = async (options?: { silent?: boolean; poll?: boolean }) => {
    if (!options?.silent) setIsRefreshingKyc(true);
    try {
      const res = await fetch(options?.poll ? '/api/seller/kyc/session?poll=1' : '/api/seller/kyc/session');
      if (!res.ok) return null;
      const data = await readJson(res);
      const session = (data.session ?? null) as KycSession | null;
      setKycSession(session);
      if (session?.status !== 'In Review') setKycPollingTimedOut(false);

      // Pre-fill the name the provider actually read, so the user is not left
      // guessing which spelling the document carries.
      if (session?.status === 'Approved' && session.verified_full_name) {
        setFullName(prev => prev || session.verified_full_name || '');
        setEditableBankAccountName(prev => prev || session.verified_full_name || '');
      }
      return session;
    } catch (err) {
      console.error('[KYC] Failed to refresh session:', err);
      return null;
    } finally {
      if (!options?.silent) setIsRefreshingKyc(false);
    }
  };

  // Bank directory. Cached server-side for a day, so this is cheap.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/banks');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setBanks((data.banks || []) as Bank[]);
      } catch (err) {
        console.error('[Bank] Failed to load bank list:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Any change to the account invalidates a previous confirmation.
  const resetBankVerification = () => {
    setIsBankVerified(false);
    setIsBankLookupUnavailable(false);
    setBankLookupError(null);
    setEditableBankAccountName('');
  };

  const lookupBankAccount = async () => {
    setIsLookingUpBank(true);
    setBankLookupError(null);
    try {
      const res = await fetch('/api/seller/bank-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bin: bankBin, account_number: editableBankAccountNumber }),
      });
      const data = await readJson(res);

      if (!res.ok) {
        setIsBankVerified(false);
        setEditableBankAccountName('');
        // 'unavailable' means the check could not run — never the seller's
        // fault, so let them continue by hand instead of dead-ending.
        setIsBankLookupUnavailable(data.status === 'unavailable');
        setBankLookupError(data.error || tx('Không tra cứu được tài khoản.', 'Could not look up the account.', '口座を照会できませんでした。'));
        return;
      }

      setIsBankLookupUnavailable(false);

      setEditableBankAccountName(data.account_name || '');
      setIsBankVerified(!!data.matches_identity);

      if (!data.matches_identity) {
        setBankLookupError(tx(
          'Tên chủ tài khoản không khớp với giấy tờ đã xác minh. Vui lòng dùng tài khoản đứng tên bạn.',
          'The account holder does not match your verified document. Use an account in your own name.',
          '口座名義が確認済みの書類と一致しません。ご本人名義の口座をご利用ください。'
        ));
      }
    } catch (err: any) {
      setIsBankVerified(false);
      setBankLookupError(err?.message || tx('Lỗi kết nối.', 'Connection error.', '接続エラーです。'));
    } finally {
      setIsLookingUpBank(false);
    }
  };

  const startKycVerification = async () => {
    setIsStartingKyc(true);
    setKycError(null);
    setKycPollingTimedOut(false);
    let redirecting = false;
    try {
      const res = await fetch('/api/seller/kyc/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: locale === 'ja-JP' ? 'ja' : locale === 'vi-VN' ? 'vi' : 'en',
          full_name: fullName.trim() || undefined,
        }),
      });

      const data = await readJson(res);
      if (!res.ok) {
        if (data.code === 'kyc_under_review' && data.session) {
          // POST returns the authoritative session when this tab missed the
          // initial GET or still holds stale state. Apply it before returning
          // so the review/polling/support UI replaces the start button.
          setKycSession(data.session as KycSession);
          setKycPollingTimedOut(false);
        }
        setKycError(
          data.code === 'kyc_under_review'
            ? t('seller_kyc_under_review_error')
            : data.error || tx('Không thể khởi tạo phiên xác minh.', 'Could not start the verification session.', '確認セッションを開始できませんでした。')
        );
        return;
      }

      setKycSession(data.session as KycSession);
      // Same tab: the provider redirects back to /sell/kyc/callback when done.
      // Deliberately still starting: the navigation is not instant, and
      // releasing the button here let a second press open another session.
      // Only a failure resets it.
      redirecting = true;
      window.location.href = data.url as string;
    } catch (err: any) {
      setKycError(err?.message || tx('Lỗi kết nối. Vui lòng thử lại.', 'Connection error. Please try again.', '接続エラーです。もう一度お試しください。'));
    } finally {
      if (!redirecting) setIsStartingKyc(false);
    }
  };

  // Poll while a session is open. The webhook is the source of truth, but it
  // can arrive late, and the user is sitting on this screen waiting.
  useEffect(() => {
    if (!user || !isKycInFlight) {
      setKycPollingTimedOut(false);
      return;
    }

    // Each tick can cost a provider API call server-side, so stop after ~5
    // minutes. The webhook is the real delivery path; after that the UI offers
    // an explicit check and support instead of asking the user to reopen it.
    let ticks = 0;
    const timer = setInterval(() => {
      if (++ticks > 60) {
        setKycPollingTimedOut(true);
        clearInterval(timer);
        return;
      }
      refreshKycSession({ silent: true, poll: true });
    }, 5000);
    return () => clearInterval(timer);
  }, [user, isKycInFlight]);

  const handlePhoneChange = (value: string) => {
    const cleaned = value.replace(/[^0-9]/g, '');
    setPhoneNumber(cleaned);
  };

  // Final submit
  const handleKYCSubmit = async () => {
    if (!fullName || !bankBin || !phoneNumber || !editableBankAccountName || !editableBankAccountNumber) {
      toast({ variant: 'destructive', title: tx('Vui lòng điền đầy đủ thông tin ở tất cả các bước', 'Complete all required information in every step', '各ステップの必須情報をすべて入力してください') });
      return;
    }

    if (!isBankVerified && !isBankLookupUnavailable) {
      toast({ variant: 'destructive', title: tx('Chưa xác minh tài khoản ngân hàng', 'Bank account not verified', '銀行口座が未確認です'), description: tx('Nhấn "Kiểm tra tài khoản" ở Bước 1 và đảm bảo tên chủ tài khoản khớp với giấy tờ.', 'Use "Check account" in Step 1 and make sure the holder matches your document.', 'ステップ1の「口座を確認」を実行し、名義が書類と一致することを確認してください。') });
      return;
    }

    if (!isKycApproved || !kycSession) {
      toast({ variant: 'destructive', title: tx('Chưa hoàn tất xác minh danh tính', 'Identity verification not complete', '本人確認が完了していません'), description: tx('Vui lòng quay lại Bước 1 và hoàn tất xác minh.', 'Return to Step 1 and finish verification.', 'ステップ1に戻って本人確認を完了してください。') });
      return;
    }

    if (!isSubmittedNameMatch) {
      toast({ variant: 'destructive', title: tx('Thông tin không khớp', 'Information does not match', '情報が一致しません'), description: tx('Họ tên và tên chủ tài khoản phải trùng với giấy tờ đã xác minh.', 'Full name and account holder must match the verified document.', '氏名と口座名義は確認済みの書類と一致する必要があります。') });
      return;
    }

    if (!isPhoneValid) {
      toast({ variant: 'destructive', title: tx('Số điện thoại không hợp lệ', 'Invalid phone number', '無効な電話番号です'), description: tx('Vui lòng nhập số điện thoại Việt Nam hợp lệ.', 'Please enter a valid Vietnamese phone number.', '有効なベトナムの電話番号を入力してください。') });
      return;
    }

    setIsSubmitting(true);
    setRetryFlags([]);
    try {
      // Optional evidence for the admin; identity no longer depends on it.
      let bankScreenshotUrl: string | null = null;
      if (bankScreenshotFile) {
        const assets = await uploadBankScreenshot(bankScreenshotFile);
        bankScreenshotUrl = assets.bankOriginalUrl;
      }

      const res = await fetch('/api/seller/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName,
          bank_name: bankName,
          bank_bin: bankBin,
          bank_account_number: editableBankAccountNumber,
          bank_account_name: editableBankAccountName,
          bank_screenshot_url: bankScreenshotUrl,
          phone_number: phoneNumber,
          kyc_session_id: kycSession.id,
        }),
      });

      const data = await readJson(res);

      // A reused document or bank account is refused for good: show a modal and
      // stop, rather than a toast that fades and invites another pointless try.
      if (res.status === 409 && data.code === 'duplicate_identity') {
        setBlockedAxis(data.matched_axis === 'bank' || data.matched_axis === 'both' ? data.matched_axis : 'document');
        return;
      }

      // Fixable: keep the reasons on screen next to the submit button.
      if (res.status === 422) {
        setRetryFlags(Array.isArray(data.retry_flags) && data.retry_flags.length > 0
          ? data.retry_flags
          : [data.error]);
        return;
      }

      if (!res.ok) throw new Error(data.error);

      if (data.auto_approved) {
        toast({
          title: t('seller_kyc_auto_approved_title'),
          description: t('seller_kyc_auto_approved_description'),
        });
      } else {
        toast({
          title: t('seller_kyc_submitted_title'),
          description: t('seller_kyc_submitted_description'),
        });
      }
      // Awaited: the submit button stays disabled until the verification
      // state replaces the form, otherwise it lights up again for a moment.
      // The submission already succeeded, so a reload failure is not its failure.
      try { await fetchVerification(); } catch (e) { console.error('[Sell] reload after KYC submit failed', e); }
    } catch (err: any) {
      toast({ variant: 'destructive', title: tx('Lỗi', 'Error', 'エラー'), description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatVND = (amount: number) => new Intl.NumberFormat('vi-VN').format(amount) + 'đ';

  // Shipping readiness is what gates listing, so both the collapsed summary
  // card and the save button read it from one place, through the same predicate
  // the checkout routes use. The form keeps fees as formatted strings; parse
  // them back, keeping a typed 0 (free shipping) distinct from a blank box.

  const renderListingTab = (key: Exclude<ListingFilter, 'all'>, statusLabel: string) => {
    const page = listingPages[key];
    return (
      <TabsContent value={key}>
        {page.error ? (
          <div className="py-6 text-center">
            <p className="text-sm text-muted-foreground">{tx('Không tải được bài đăng.', 'Could not load listings.', '出品を読み込めませんでした。')}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void fetchSellerListings(key)}>
              {tx('Thử lại', 'Retry', '再試行')}
            </Button>
          </div>
        ) : !page.loaded && page.loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
          </div>
        ) : page.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{copy.noListings}</p>
        ) : (
          <>
            <div>{page.items.map(listing => (
              <ListingRow
                key={listing.id}
                listing={listing}
                statusLabel={listing.listing_visibility === 'hidden' ? tx('Đã ẩn', 'Hidden', '非表示') : listing.status === 'sold' ? copy.sold : statusLabel}
                price={listing.price ? formatVND(listing.price) : noDataLabel(locale)}
                pendingOffers={pendingOfferCounts[listing.id] || 0}
                offerLabel={tx('offer đang chờ', 'pending offers', '件の保留中オファー')}
                editLabel={tx('Sửa', 'Edit', '編集')}
                hideLabel={tx('Ẩn', 'Hide', '非表示')}
                restoreLabel={tx('Hiện lại', 'Restore', '再公開')}
                deleteLabel={tx('Xóa', 'Delete', '削除')}
                onAction={(item, action) => setListingAction({ listing: item, action })}
              />
            ))}</div>
            {page.nextCursor && (
              <button type="button" disabled={page.loading} onClick={() => void fetchSellerListings(key, true)} className="mt-3 w-full text-sm font-medium text-primary disabled:opacity-50">
                {page.loading ? tx('Đang tải…', 'Loading…', '読み込み中…') : `${copy.viewAll} ›`}
              </button>
            )}
          </>
        )}
      </TabsContent>
    );
  };

  const isPhoneValid = /^0[3-9]\d{8}$/.test(phoneNumber);

  // ── LOADING STATE ──
  if (authLoading || isLoadingVerification) {
    return (
      <div className="flex flex-1 flex-col">
        <main className="flex-1 container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto space-y-6">
            <Skeleton className="h-10 w-64 mx-auto" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </main>
      </div>
    );
  }

  // ── NOT LOGGED IN ──
  if (!user) {
    return (
      <div className="flex flex-1 flex-col">
        <main className="flex-1 container mx-auto px-4 py-8 flex flex-col items-center justify-center">
          <ShieldAlert className="h-16 w-16 text-muted-foreground mb-4" />
          <h2 className="text-2xl font-semibold mb-2">{copy.signInToSell}</h2>
          <Button onClick={() => setOpen(true)}>{copy.signIn}</Button>
        </main>
      </div>
    );
  }

  // ── KYC PENDING ──
  if (verification?.status === 'pending') {
    return (
      <div className="flex flex-1 flex-col">
        <main className="flex-1 container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto text-center">
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-8 space-y-4">
              <Clock className="h-16 w-16 text-yellow-500 mx-auto" />
              <h2 className="text-2xl font-bold text-yellow-400">{copy.pendingTitle}</h2>
              <p className="text-muted-foreground">{copy.pendingDesc}</p>
              <p className="text-xs text-muted-foreground">
                {copy.submittedAt}: {new Date(verification.created_at).toLocaleString(locale)}
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── KYC REJECTED ──
  if (verification?.status === 'rejected') {
    return (
      <div className="flex flex-1 flex-col">
        <main className="flex-1 container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto text-center space-y-6">
            <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-8 space-y-4">
              <XCircle className="h-16 w-16 text-red-500 mx-auto" />
              <h2 className="text-2xl font-bold text-red-400">{copy.rejectedTitle}</h2>
              <p className="text-muted-foreground">
                {copy.reason}: {verification.rejection_reason || copy.rejectedFallback}
              </p>
              <Button onClick={() => setVerification(null)} variant="outline">
                {copy.resubmit}
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── KYC APPROVED — SELLER DASHBOARD ──
  if (verification?.status === 'approved') {
    const listingPage = listingPages[activeListingFilter];
    const myListings = listingPage.items;
    const isLoadingListings = isLoadingOrders || !listingPage.loaded || (listingPage.loading && myListings.length === 0);
    const shippingSummary = tx(
      'Chọn hãng đến lấy hàng. GoShip tự tính phí theo địa chỉ người mua.',
      'Choose pickup carriers. GoShip calculates the fee for each buyer’s address.',
      '集荷業者を選択します。送料は購入者の住所に応じてGoShipが計算します。',
    );

    return (
      <div className="flex flex-1 flex-col">
        <main className="flex-1 container mx-auto px-4 py-8 pb-24 md:pb-8">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold flex items-center gap-2" style={{ fontFamily: "'Orbitron', sans-serif" }}>
                  <ShieldCheck className="h-8 w-8 text-green-500" />
                  {copy.dashboardTitle}
                </h1>
                <p className="text-muted-foreground mt-1">{copy.dashboardDesc}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {/* The primary action, opposite the title where a dashboard's
                    main action belongs. Desktop only: the phone keeps the
                    floating button, which sits under the thumb. A real link, so
                    it can be opened in a new tab like any other. */}
                <Button
                  asChild
                  className="hidden h-11 gap-2 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 px-6 text-[15px] font-semibold text-white shadow-lg shadow-orange-500/25 transition-all hover:from-orange-600 hover:to-amber-600 hover:shadow-xl hover:shadow-orange-500/40 active:scale-95 md:inline-flex"
                >
                  <Link href="/sell/create" className="whitespace-nowrap">
                    {/* The Button base pins any svg it contains to 16px, so the
                        ring around it is sized off that rather than the icon. */}
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20">
                      <Plus strokeWidth={3} />
                    </span>
                    {listCardLabel}
                  </Link>
                </Button>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-4">
              <KpiCard label={copy.waitingShip} value={orderSummary.waitingShip} tone="border-blue-500/20 bg-blue-500/5 text-blue-400" />
              <KpiCard label={copy.shipping} value={orderSummary.shipping} tone="border-yellow-500/20 bg-yellow-500/5 text-yellow-400" />
              <KpiCard label={copy.completed} value={orderSummary.completed} tone="border-green-500/20 bg-green-500/5 text-green-400" />
              <KpiCard label={copy.totalEarnings} value={formatVND(orderSummary.totalEarnings)} tone="border-orange-500/20 bg-orange-500/5 text-orange-400" />
            </div>


            {/* Pickup Address — required so shipping fees can be calculated */}
            {/* One address, because there is one place a seller ships from.

                Two forms used to stand here and they asked for the same
                physical place twice: profiles.address_* in the 2025 structure,
                and goship_pickup in the carrier's. Tracing every read of the
                first found exactly two — a "has somewhere to collect from" gate
                and the province NAME that picks the distance tier — and both are
                answered better by the carrier's own list, which is the geography
                the bill is actually computed in. So saving below writes both,
                and /api/shipping/pickup-address explains why that is not the
                name-matching that would send a driver to the wrong city.

                What used to sit above them was worse than a duplicate: it was
                the AddressBook, the list of places the user RECEIVES parcels,
                under a heading that said "Địa chỉ lấy hàng". Adding a row there
                changed a delivery address and nothing about pickup — and because
                its onAddressesChange wrote the same state as fetchPickupAddress,
                it CLEARED the orange warning below. A seller could finish setup,
                see no warning, and learn their listings were unbuyable only when
                a stranger's checkout failed. */}
            <Card id="pickup-address" className={!goshipPickup && !isLoadingAddress ? 'border-orange-500/40 bg-orange-500/5' : ''}>
              <CardHeader>
                <CardTitle>
                  <span className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-orange-400" />
                    {copy.pickupAddress}
                  </span>
                </CardTitle>
                <CardDescription>{copy.pickupAddressDesc}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {!goshipPickup && !isLoadingAddress && (
                  <div className="flex items-start gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 text-sm text-orange-300">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{copy.pickupNotice}</span>
                  </div>
                )}

                {isLoadingAddress ? (
                  <Skeleton className="h-16 w-full rounded-lg" />
                ) : (
                  <SenderAddressForm initialAddress={goshipPickup} onSaved={setGoshipPickup} />
                )}

                {/* Only once an origin exists: the quote is measured from it,
                    and offering the form first invites the one error it cannot
                    answer. */}
                {goshipPickup && <ShippingQuotePreview />}
              </CardContent>
            </Card>

            {/* Shop shipping options. Both variants sit inside one anchor so
                /sell#shop-shipping lands correctly on either breakpoint. */}
            <div id="shop-shipping" className="scroll-mt-24 space-y-6">
            <button
              type="button"
              onClick={() => setShippingConfigOpen(true)}
              className="flex w-full items-start justify-between rounded-lg border bg-card p-4 text-left md:hidden"
            >
              <span className="flex min-w-0 items-start gap-3">
                <Truck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block font-medium">{tx('Vận chuyển của shop', 'Shop shipping', 'ショップ配送')}</span>
                  <span className="mt-1 block truncate text-sm text-muted-foreground">{shippingSummary}</span>
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </button>

            {/* Match the sender-address card: a stable heading followed by a
                compact saved-state row. Editing expands only the fields below,
                and saving returns to the summary instead of collapsing the
                whole section into an ambiguous accordion header. */}
            <Card className="hidden md:block">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5 shrink-0 text-orange-400" />
                  {tx('Vận chuyển của shop', 'Shop shipping', 'ショップ配送')}
                </CardTitle>
                <CardDescription>{shippingSummary}</CardDescription>
              </CardHeader>
              <CardContent id="shop-shipping-panel">
                <ShopShippingSetup
                  summaryMode
                  startEditing={shippingSectionOpen}
                  onSaved={() => setShippingSectionOpen(false)}
                />
              </CardContent>
            </Card>
            </div>

            {/* My Listings */}
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="flex min-w-0 items-center gap-2 text-lg font-semibold md:text-2xl">
                      <Package className="h-5 w-5 shrink-0 text-orange-400" />
                      <span className="truncate">{copy.myListings}</span>
                      {!isLoadingListings && listingSummary.total > 0 && (
                        <span className="hidden shrink-0 text-sm font-normal text-muted-foreground md:inline">
                          ({copy.activeListings.replace('{count}', String(listingSummary.active))})
                        </span>
                      )}
                    </CardTitle>
                    {!isLoadingListings && (
                      <p className="mt-1 text-xs text-muted-foreground md:hidden">
                        {copy.activeListings.replace('{count}', formatCompactCount(listingSummary.active, locale))}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="outline" size="sm" asChild className="border-orange-500/40 text-orange-400">
                      <Link href="/offers?view=received" className="whitespace-nowrap">
                        <HandCoins className="mr-1.5 h-4 w-4" />
                        <span className="hidden sm:inline">{tx('Offer đã nhận', 'Received offers', '受信オファー')}</span>
                        {pendingOffersTotal > 0 && <Badge className="ml-1.5 bg-orange-500 px-1.5 text-[10px] text-white">{pendingOffersTotal > 99 ? '99+' : pendingOffersTotal}</Badge>}
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" className="hidden shrink-0 sm:inline-flex" asChild>
                      <Link href="/buy" className="whitespace-nowrap">{copy.viewMarketplace}</Link>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingListings ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {[1, 2, 3, 4].map(i => <Skeleton key={i} className="aspect-[3/4] w-full rounded-lg" />)}
                  </div>
                ) : listingPage.error ? (
                  <div className="py-8 text-center">
                    <p className="text-sm text-muted-foreground">{tx('Không tải được bài đăng.', 'Could not load listings.', '出品を読み込めませんでした。')}</p>
                    <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void fetchSellerListings(activeListingFilter)}>
                      {tx('Thử lại', 'Retry', '再試行')}
                    </Button>
                  </div>
                ) : listingSummary.total === 0 && myListings.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground mb-4">{copy.noListings}</p>
                    <Button asChild className="bg-orange-500 hover:bg-orange-600">
                      <Link href="/sell/create">
                        <Plus className="h-4 w-4 mr-2" />
                        {firstListingLabel}
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <>
                    {!desktop && <Tabs value={listingTab} onValueChange={(value) => setListingTab(value as Exclude<ListingFilter, 'all'>)} className="md:hidden">
                      <TabsList className="grid h-auto w-full grid-cols-4">
                        <TabsTrigger value="active" className="min-w-0 flex-1 truncate px-2 text-xs">{copy.active} ({formatCompactCount(listingSummary.active, locale)})</TabsTrigger>
                        <TabsTrigger value="sold" className="min-w-0 flex-1 truncate px-2 text-xs">{copy.sold} ({formatCompactCount(listingSummary.sold, locale)})</TabsTrigger>
                        <TabsTrigger value="draft" className="min-w-0 flex-1 truncate px-2 text-xs">{tx('Nháp', 'Drafts', '下書き')} ({formatCompactCount(listingSummary.draft, locale)})</TabsTrigger>
                        <TabsTrigger value="hidden" className="min-w-0 flex-1 truncate px-2 text-xs">{tx('Đã ẩn', 'Hidden', '非表示')} ({formatCompactCount(listingSummary.hidden, locale)})</TabsTrigger>
                      </TabsList>
                      {renderListingTab('active', copy.active)}
                      {renderListingTab('sold', copy.sold)}
                      {renderListingTab('draft', tx('Nháp', 'Drafts', '下書き'))}
                      {renderListingTab('hidden', tx('Đã ẩn', 'Hidden', '非表示'))}
                    </Tabs>}

                    {desktop && <>
                      <Tabs value={listingTab} onValueChange={(value) => setListingTab(value as Exclude<ListingFilter, 'all'>)} className="mb-4 hidden md:block">
                        <TabsList className="grid h-auto w-full grid-cols-4">
                          <TabsTrigger value="active">{copy.active} ({formatCompactCount(listingSummary.active, locale)})</TabsTrigger>
                          <TabsTrigger value="sold">{copy.sold} ({formatCompactCount(listingSummary.sold, locale)})</TabsTrigger>
                          <TabsTrigger value="draft">{tx('Nháp', 'Drafts', '下書き')} ({formatCompactCount(listingSummary.draft, locale)})</TabsTrigger>
                          <TabsTrigger value="hidden">{tx('Đã ẩn', 'Hidden', '非表示')} ({formatCompactCount(listingSummary.hidden, locale)})</TabsTrigger>
                        </TabsList>
                      </Tabs>
                      {myListings.length === 0 && (
                        <p className="hidden py-8 text-center text-sm text-muted-foreground md:block">{copy.noListings}</p>
                      )}
                      <div className="hidden grid-cols-2 gap-3 sm:grid-cols-3 md:grid md:grid-cols-4">
                        {myListings.map((listing) => {
                          const isSold = listing.status === 'sold';
                          const isHidden = listing.listing_visibility === 'hidden';
                          return (
                            <div
                              key={listing.id}
                              className="group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-all hover:border-orange-500/40 hover:shadow-md"
                            >
                              <Link href={isHidden ? `/sell/edit/${listing.id}` : `/cards/${listing.id}`} className="absolute inset-0 z-[1]" aria-label={listing.name} />
                              <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted">
                                {listing.image_url ? (
                                  <Image
                                    src={optimizeCloudinaryUrl(listing.image_url, 300)}
                                    alt={listing.name}
                                    fill
                                    sizes="(max-width: 768px) 50vw, 25vw"
                                    className={`object-cover transition-transform duration-300 group-hover:scale-105 ${isSold ? 'grayscale' : ''}`}
                                  />
                                ) : (
                                  <div className="flex h-full items-center justify-center">
                                    <Package className="h-8 w-8 text-muted-foreground/40" />
                                  </div>
                                )}
                                <span className={`absolute left-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${isSold || isHidden ? 'bg-muted text-muted-foreground' : 'bg-green-500/90 text-white'}`}>
                                  {isHidden ? tx('Đã ẩn', 'Hidden', '非表示') : isSold ? copy.sold : copy.active}
                                </span>
                                {(pendingOfferCounts[listing.id] || 0) > 0 && (
                                  <Link href={`/offers?view=received&cardId=${listing.id}`} className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-orange-600" aria-label={`${pendingOfferCounts[listing.id]} ${tx('offer đang chờ', 'pending offers', '件の保留中オファー')}`}>
                                    <HandCoins className="h-3 w-3" />{pendingOfferCounts[listing.id]}
                                  </Link>
                                )}
                              </div>
                              <div className="flex flex-1 flex-col p-2.5">
                                <p className="line-clamp-1 text-sm font-medium">{listing.name}</p>
                                <p className="mt-1 text-sm font-bold text-orange-400">{listing.price ? formatVND(listing.price) : noDataLabel(locale)}</p>
                                <div className="relative z-10 mt-2 flex flex-wrap gap-1.5">
                                  {isHidden ? <>
                                    <Button variant="ghost" size="sm" asChild className="h-8 flex-1 px-2">
                                      <Link href={`/sell/edit/${listing.id}`}><Pencil className="mr-1 h-3.5 w-3.5" />{tx('Sửa', 'Edit', '編集')}</Link>
                                    </Button>
                                    <Button variant="outline" size="sm" className="h-8 flex-1 px-2" onClick={() => setListingAction({ listing, action: 'restore' })}>
                                      <Eye className="mr-1 h-3.5 w-3.5" />{tx('Hiện', 'Show', '再公開')}
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-300" aria-label={tx('Xóa listing', 'Delete listing', '出品を削除')} onClick={() => setListingAction({ listing, action: 'delete' })}>
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </> : listing.status === 'active' ? (
                                    <Button variant="ghost" size="sm" className="h-8 w-full text-muted-foreground" onClick={() => setListingAction({ listing, action: 'hide' })}>
                                      <EyeOff className="mr-1 h-3.5 w-3.5" />{tx('Ẩn bài đăng', 'Hide listing', '出品を非表示')}
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {listingPage.nextCursor && (
                        <Button type="button" variant="outline" className="mx-auto mt-4 flex" disabled={listingPage.loading} onClick={() => void fetchSellerListings(activeListingFilter, true)}>
                          {listingPage.loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          {listingPage.loading ? tx('Đang tải…', 'Loading…', '読み込み中…') : tx('Xem thêm bài đăng', 'Load more listings', 'さらに表示')}
                        </Button>
                      )}
                    </>}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Recent Orders */}
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="truncate text-lg font-semibold md:text-2xl">{copy.recentOrders}</CardTitle>
                    {!isLoadingOrders && (
                      <p className="mt-1 text-xs text-muted-foreground md:hidden">
                        {formatCompactCount(orderSummary.total, locale)} {tx('đơn hàng', 'orders', '件の注文')}
                      </p>
                    )}
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0" asChild>
                    {/* "View all" of the seller's own orders, so name the tab
                        rather than leaving it to the list's account-level
                        default. */}
                    <Link href="/orders?tab=seller" className="whitespace-nowrap">{copy.viewAll}</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingOrders ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
                  </div>
                ) : sellerOrders.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">{copy.noOrders}</p>
                ) : (
                  <>
                    {!desktop ? <div className="md:hidden">
                      {sellerOrders.slice(0, 3).map(order => {
                        const statusInfo = ORDER_STATUS_CONFIG[order.status] || { color: '' };
                        const carrierLabel = carrierStatusLabel(order.carrier_status, locale);
                        return <OrderRow key={order.id} order={order} statusLabel={orderStatusLabel(order.status, locale)} statusClass={statusInfo.color} carrierLabel={carrierLabel} carrierClass={carrierStatusColorClass(order.carrier_status)} unknownCard={copy.unknownCard} date={new Date(order.created_at).toLocaleDateString(locale)} price={formatVND(order.amount - order.platform_fee)} />;
                      })}
                      {sellerOrders.length > 3 && (
                        <Link href="/orders?tab=seller" className="mt-3 block text-center text-sm font-medium text-primary">{copy.viewAll} ›</Link>
                      )}
                    </div> : null}

                    {desktop ? <div className="hidden space-y-3 md:block">
                      {sellerOrders.slice(0, 5).map((order) => {
                        const statusInfo = ORDER_STATUS_CONFIG[order.status] || { icon: null, color: '' };
                        const carrierLabel = carrierStatusLabel(order.carrier_status, locale);
                        return (
                          <Link
                            key={order.id}
                            href={`/orders/${order.id}`}
                            className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            <div className="flex items-center gap-3">
                              {order.card?.image_url && (
                                <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded">
                                  <Image src={order.card.image_url} alt="" fill sizes="40px" className="object-cover" />
                                </div>
                              )}
                              <div>
                                <p className="line-clamp-1 text-sm font-medium">{order.card?.name || copy.unknownCard}</p>
                                <p className={`flex items-center gap-1 text-xs ${statusInfo.color}`}>{statusInfo.icon} {orderStatusLabel(order.status, locale)}</p>
                                {carrierLabel && <p className={`mt-0.5 text-xs font-medium ${carrierStatusColorClass(order.carrier_status)}`}>{carrierLabel}</p>}
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold">{formatVND(order.amount - order.platform_fee)}</p>
                              <p className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleDateString(locale)}</p>
                            </div>
                          </Link>
                        );
                      })}
                    </div> : null}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
        <button
          type="button"
          onClick={goToNewListing}
          aria-label={listCardLabel}
          className="fixed bottom-5 right-4 z-50 flex h-12 items-center gap-2 rounded-full bg-primary px-5 pb-[env(safe-area-inset-bottom)] text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition hover:scale-105 active:scale-95 md:hidden"
        >
          <Plus className="h-5 w-5" />
          <span>{listCardLabel}</span>
        </button>

        {/* Desktop counterpart. Larger than the phone's, because a pointer has
            the whole screen to cross and the corner is a long way from the
            reading position. Kept out of the tab order and hidden from assistive
            tech while off-screen: it duplicates the header action rather than
            adding anything, so announcing it twice would only be noise. */}
        <button
          type="button"
          onClick={goToNewListing}
          aria-label={listCardLabel}
          aria-hidden={!showFloatingListing}
          tabIndex={showFloatingListing ? 0 : -1}
          className={`fixed bottom-8 right-8 z-50 hidden h-14 items-center gap-2.5 rounded-full bg-orange-500 px-7 text-base font-semibold text-white shadow-xl shadow-orange-500/30 transition-all duration-300 hover:scale-105 hover:bg-orange-600 active:scale-95 md:flex ${
            showFloatingListing ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
          }`}
        >
          <Plus className="h-6 w-6" />
          <span>{listCardLabel}</span>
        </button>
        <Drawer open={shippingConfigOpen} onOpenChange={setShippingConfigOpen}>
          <DrawerContent className="md:hidden">
            <DrawerHeader>
              <DrawerTitle>{tx('Vận chuyển của shop', 'Shop shipping', 'ショップ配送')}</DrawerTitle>
              <DrawerDescription>
                {shippingSummary}
              </DrawerDescription>
            </DrawerHeader>
            <div className="max-h-[80vh] overflow-y-auto px-4 pb-6">
              {shippingConfigOpen && <ShopShippingSetup summaryMode />}
            </div>
          </DrawerContent>
        </Drawer>
        <AlertDialog open={listingAction !== null} onOpenChange={(open) => { if (!open && !isManagingListing) setListingAction(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {listingAction?.action === 'hide'
                  ? tx('Ẩn bài đăng này?', 'Hide this listing?', 'この出品を非表示にしますか？')
                  : listingAction?.action === 'restore'
                    ? tx('Hiện lại bài đăng?', 'Restore this listing?', 'この出品を再公開しますか？')
                    : tx('Xóa bài đăng này?', 'Delete this listing?', 'この出品を削除しますか？')}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {listingAction?.action === 'hide'
                  ? tx(
                    `${pendingOfferCounts[listingAction.listing.id] || 0} offer đang chờ sẽ bị từ chối. Listing sẽ biến mất khỏi marketplace nhưng bạn vẫn có thể sửa hoặc hiện lại.`,
                    `${pendingOfferCounts[listingAction.listing.id] || 0} pending offer(s) will be rejected. The listing will leave the marketplace, but you can edit or restore it.`,
                    `保留中のオファー${pendingOfferCounts[listingAction.listing.id] || 0}件を拒否します。出品はマーケットから非表示になりますが、編集・再公開できます。`,
                  )
                  : listingAction?.action === 'restore'
                    ? tx('Listing sẽ xuất hiện lại trên marketplace và có thể nhận mua/offer mới.', 'The listing will return to the marketplace and accept new purchases and offers.', '出品がマーケットに戻り、新しい購入・オファーを受け付けます。')
                    : tx('Đây là xóa mềm không thể hoàn tác từ giao diện. Lịch sử offer, chat và đơn hàng vẫn được giữ an toàn.', 'This soft deletion cannot be undone from the UI. Offer, chat, and order history will be preserved.', 'このソフト削除は画面から元に戻せません。オファー、チャット、注文履歴は保持されます。')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isManagingListing}>{tx('Hủy', 'Cancel', 'キャンセル')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={manageListing}
                disabled={isManagingListing}
                className={listingAction?.action === 'delete' ? 'bg-red-600 text-white hover:bg-red-700' : ''}
              >
                {isManagingListing
                  ? tx('Đang xử lý…', 'Working…', '処理中…')
                  : listingAction?.action === 'hide'
                    ? tx('Ẩn bài đăng', 'Hide listing', '非表示にする')
                    : listingAction?.action === 'restore'
                      ? tx('Hiện lại', 'Restore', '再公開')
                      : tx('Xóa listing', 'Delete listing', '出品を削除')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ── KYC FORM — 3-STEP WIZARD ──
  const steps = [
    { number: 1, title: copy.step1, icon: <Sparkles className="h-4 w-4" /> },
    { number: 2, title: copy.step2, icon: <Phone className="h-4 w-4" /> },
    { number: 3, title: copy.step3, icon: <FileCheck className="h-4 w-4" /> },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold" style={{ fontFamily: "'Orbitron', sans-serif" }}>
              {t('sell_title')}
            </h1>
            <p className="text-muted-foreground mt-2">
              {copy.verifyDesc}
            </p>
          </div>

          {/* Step Indicator */}
          <div className="flex items-center justify-center gap-2 py-4">
            {steps.map((step, idx) => (
              <div key={step.number} className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (step.number < currentStep) setCurrentStep(step.number);
                  }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium transition-all ${
                    currentStep === step.number
                      ? 'bg-orange-500 text-white shadow-md scale-105'
                      : currentStep > step.number
                      ? 'bg-green-500/20 text-green-500 border border-green-500/30'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-muted-foreground'
                  }`}
                >
                  {currentStep > step.number ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    step.icon
                  )}
                  <span className="hidden sm:inline">{step.title}</span>
                  <span className="sm:hidden">B{step.number}</span>
                </button>
                {idx < steps.length - 1 && (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>

          {/* ═══ STEP 1: IDENTITY (external provider) + PAYOUT DETAILS ═══ */}
          {currentStep === 1 && (
            <Card className="border-orange-500/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-orange-500" />
                  {tx('Bước 1: Xác minh danh tính', 'Step 1: Identity verification', 'ステップ1: 本人確認')}
                </CardTitle>
                <CardDescription>
                  {tx(
                    'Bạn sẽ được chuyển sang trang xác minh của đối tác để chụp CCCD và quét khuôn mặt. Ảnh giấy tờ do đối tác lưu giữ, CardVerseHub không giữ bản sao.',
                    'You will be taken to our verification partner to capture your ID and a face scan. The partner stores the document images, and CardVerseHub keeps no copy.',
                    'パートナーの確認ページで身分証と顔スキャンを行います。画像はパートナーが保管し、CardVerseHubは保存しません。'
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">

                {kycError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-400 flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                    <div>{kycError}</div>
                  </div>
                )}

                {/* Identity status panel */}
                <div className={`border rounded-xl p-5 space-y-4 ${
                  isKycApproved
                    ? 'bg-green-500/5 border-green-500/30'
                    : isKycFailed
                    ? 'bg-red-500/5 border-red-500/30'
                    : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800'
                }`}>
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="font-semibold flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-orange-500" />
                      {tx('Trạng thái xác minh', 'Verification status', '確認ステータス')}
                    </h4>
                    {isRefreshingKyc && <Loader2 className="h-4 w-4 animate-spin text-orange-500" />}
                  </div>

                  {isKycApproved ? (
                    <div className="space-y-2 text-sm">
                      <p className="text-green-500 font-medium flex items-center gap-2">
                        <CheckCircle className="h-4 w-4" />
                        {tx('Danh tính đã được xác minh', 'Identity verified', '本人確認完了')}
                      </p>
                      <div>
                        <p className="text-muted-foreground text-xs">{tx('Tên trên giấy tờ', 'Name on document', '書類上の氏名')}</p>
                        <p className="font-medium">{verifiedName || noDataLabel(locale)}</p>
                      </div>
                    </div>
                  ) : isKycUnderReview ? (
                    <div className="space-y-3 text-sm">
                      <p className="text-orange-400 flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        {t('seller_kyc_in_review_status')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {kycPollingTimedOut
                          ? t('seller_kyc_in_review_timeout')
                          : t('seller_kyc_in_review_description')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => refreshKycSession({ poll: true })} disabled={isRefreshingKyc}>
                          {t('seller_kyc_check_again')}
                        </Button>
                        {kycPollingTimedOut && (
                          <Button type="button" variant="outline" size="sm" asChild>
                            <Link href="/contact">{t('seller_kyc_contact_support')}</Link>
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : isKycInFlight ? (
                    <div className="space-y-3 text-sm">
                      <p className="text-orange-400 flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {tx('Đang chờ kết quả từ đối tác xác minh...', 'Waiting for the verification partner...', 'パートナーの結果を待機中...')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {tx('Nếu bạn chưa hoàn tất, hãy mở lại phiên xác minh. Kết quả thường có trong vòng một phút.', 'If you have not finished, open the session again. Results usually arrive within a minute.', '完了していない場合は再度セッションを開いてください。結果は通常1分以内に届きます。')}
                      </p>
                      <Button type="button" variant="outline" size="sm" onClick={() => refreshKycSession({ poll: true })} disabled={isRefreshingKyc}>
                        {tx('Kiểm tra lại', 'Check again', '再確認')}
                      </Button>
                    </div>
                  ) : isKycFailed ? (
                    <p className="text-sm text-red-400 flex items-start gap-2">
                      <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      {tx('Phiên xác minh không thành công hoặc đã hết hạn. Vui lòng thử lại.', 'The verification session failed or expired. Please try again.', '確認セッションが失敗または期限切れです。もう一度お試しください。')}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {tx('Chưa xác minh. Nhấn nút bên dưới để bắt đầu.', 'Not verified yet. Use the button below to start.', '未確認です。下のボタンから開始してください。')}
                    </p>
                  )}
                </div>

                {!isKycApproved && !isKycUnderReview && (
                  <Button
                    type="button"
                    onClick={startKycVerification}
                    disabled={isStartingKyc}
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold"
                    size="lg"
                  >
                    {isStartingKyc ? (
                      <>
                        {tx('Đang mở phiên xác minh...', 'Opening verification...', '確認を開いています...')}
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-4 w-4 mr-2" />
                        {isKycInFlight || isKycFailed
                          ? tx('Mở lại phiên xác minh', 'Reopen verification', '確認を再度開く')
                          : tx('Bắt đầu xác minh danh tính', 'Start identity verification', '本人確認を開始')}
                      </>
                    )}
                  </Button>
                )}

                {/* Payout details — only meaningful once identity is settled */}
                <div className={isKycApproved ? 'space-y-6' : 'space-y-6 opacity-50 pointer-events-none'}>
                  <div>
                    <Label htmlFor="fullName">{tx('Họ và tên (đúng với giấy tờ) *', 'Full name (must match ID) *', '氏名（身分証と一致）*')}</Label>
                    <Input id="fullName" value={fullName} onChange={e => setFullName(e.target.value)} placeholder={tx('Nguyễn Văn A', 'John Doe', '山田 太郎')} required />
                    {!!verifiedName && !isSubmittedNameMatch && (
                      <p className="text-xs text-red-400 mt-1">
                        {tx('Phải trùng với tên trên giấy tờ', 'Must match the name on the document', '書類上の氏名と一致させてください')}: <strong>{verifiedName}</strong>
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>{tx('Ngân hàng *', 'Bank *', '銀行 *')}</Label>
                      <Select
                        value={bankBin}
                        onValueChange={value => {
                          setBankBin(value);
                          setBankName(banks.find(b => b.bin === value)?.shortName || '');
                          resetBankVerification();
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={banks.length === 0
                            ? tx('Đang tải danh sách...', 'Loading banks...', '銀行リストを読み込み中...')
                            : tx('Chọn ngân hàng...', 'Select bank...', '銀行を選択...')} />
                        </SelectTrigger>
                        <SelectContent>
                          {banks.map(b => (
                            <SelectItem key={b.bin} value={b.bin}>
                              {b.shortName}, {b.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="editableBankAccountNumber">{tx('Số tài khoản *', 'Account number *', '口座番号 *')}</Label>
                      <Input
                        id="editableBankAccountNumber"
                        value={editableBankAccountNumber}
                        onChange={e => {
                          setEditableBankAccountNumber(e.target.value.replace(/[^\d]/g, ''));
                          resetBankVerification();
                        }}
                        placeholder={tx('Số tài khoản nhận tiền', 'Payout account number', '入金口座番号')}
                      />
                    </div>
                  </div>

                  {/* Account holder comes from the banking network, not the user.
                      That is the whole point — a typed name proves nothing. */}
                  <div className="space-y-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={lookupBankAccount}
                      disabled={!bankBin || editableBankAccountNumber.length < 6 || isLookingUpBank || isBankVerified}
                      className="w-full border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                    >
                      {isLookingUpBank ? (
                        tx('Đang tra cứu tài khoản...', 'Looking up account...', '口座を照会中...')
                      ) : isBankVerified ? (
                        <>
                          <CheckCircle className="h-4 w-4 mr-2" />
                          {tx('Tài khoản đã xác minh', 'Account verified', '口座を確認済み')}
                        </>
                      ) : (
                        tx('Kiểm tra tài khoản', 'Check account', '口座を確認')
                      )}
                    </Button>

                    {bankLookupError && (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400 flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <div>{bankLookupError}</div>
                      </div>
                    )}

                    {editableBankAccountName && !isBankLookupUnavailable && (
                      <div className={`rounded-lg p-3 border ${isBankVerified ? 'bg-green-500/5 border-green-500/30' : 'bg-yellow-500/5 border-yellow-500/30'}`}>
                        <p className="text-xs text-muted-foreground">{tx('Tên chủ tài khoản (do ngân hàng trả về)', 'Account holder (returned by the bank)', '口座名義（銀行が返した情報）')}</p>
                        <p className="font-semibold">{editableBankAccountName}</p>
                      </div>
                    )}

                    {/* Lookup unavailable: accept a typed holder name and let an
                        admin confirm it, rather than blocking a valid seller. */}
                    {isBankLookupUnavailable && (
                      <div>
                        <Label htmlFor="manualBankAccountName">
                          {tx('Tên chủ tài khoản *', 'Account holder name *', '口座名義 *')}
                        </Label>
                        <Input
                          id="manualBankAccountName"
                          value={editableBankAccountName}
                          onChange={e => setEditableBankAccountName(e.target.value)}
                          placeholder={verifiedName || tx('Nhập đúng tên chủ tài khoản', 'Enter the account holder name', '口座名義を入力')}
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          {tx(
                            'Không tra cứu tự động được nên admin sẽ kiểm tra thủ công. Tên phải trùng với giấy tờ đã xác minh.',
                            'Automatic lookup is unavailable, so an admin will check manually. The name must match your verified document.',
                            '自動照会が利用できないため管理者が手動で確認します。氏名は確認済みの書類と一致する必要があります。'
                          )}
                        </p>
                      </div>
                    )}
                  </div>

                  <div>
                    <Label>{tx('Ảnh chụp màn hình tài khoản ngân hàng (tùy chọn)', 'Bank account screenshot (optional)', '銀行口座のスクリーンショット（任意）')}</Label>
                    <div className={`mt-1 border-2 rounded-lg p-4 text-center transition-colors ${processingType === 'bank' ? 'cursor-wait border-orange-500/50 bg-orange-500/5' : 'cursor-pointer border-dashed hover:border-orange-500/50'}`}
                      onClick={() => { if (processingType !== 'bank') document.getElementById('bank-screenshot')?.click(); }}>
                      {processingType === 'bank' ? (
                        <div className="flex items-center justify-center gap-2 py-1">
                          <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                          <p className="text-sm text-orange-400">{tx('Đang xử lý ảnh...', 'Processing image...', '画像を処理中...')}</p>
                        </div>
                      ) : bankScreenshotFile ? (
                        <p className="text-sm truncate text-green-400">{bankScreenshotFile.name}</p>
                      ) : (
                        <>
                          <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                          <p className="text-xs text-muted-foreground mt-1">{tx('Giúp admin đối chiếu nhanh hơn khi cần soát thủ công', 'Helps an admin cross-check faster if manual review is needed', '手動確認が必要な場合に管理者の照合を早めます')}</p>
                        </>
                      )}
                      <input type="file" id="bank-screenshot" className="hidden" accept="image/*"
                        onChange={e => handleFileChange('bank', e.target.files?.[0] || null)} />
                    </div>
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  disabled={
                    !isKycApproved || !fullName || !bankBin || !editableBankAccountNumber ||
                    !(isBankVerified || isBankLookupUnavailable) || !isSubmittedNameMatch
                  }
                  className="w-full"
                  size="lg"
                >
                  {tx('Tiếp tục', 'Continue', '続ける')} <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </CardContent>
            </Card>
          )}

          {/* ═══ STEP 2: PHONE + OTP ═══ */}
          {currentStep === 2 && (
            <Card className="border-orange-500/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="h-5 w-5 text-orange-500" />
                  {tx('Bước 2: Số điện thoại liên hệ', 'Step 2: Contact phone number', 'ステップ2: 連絡先電話番号')}
                </CardTitle>
                <CardDescription>
                  {tx('Nhập số điện thoại Việt Nam để bưu tá liên hệ lấy thẻ khi có đơn hàng.', 'Enter a Vietnamese phone number so carriers can contact you for pickup.', '注文時に集荷担当が連絡できるベトナムの電話番号を入力してください。')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <Label htmlFor="phone">{tx('Số điện thoại *', 'Phone number *', '電話番号 *')}</Label>
                  <div className="mt-1">
                    <Input
                      id="phone"
                      type="tel"
                      value={phoneNumber}
                      onChange={e => handlePhoneChange(e.target.value)}
                      placeholder={tx('0912 345 678', '0912 345 678', '0912 345 678')}
                      maxLength={10}
                      required
                    />
                  </div>
                  {phoneNumber && !isPhoneValid && (
                    <p className="text-xs text-red-400 mt-1">{tx('Số điện thoại phải bắt đầu bằng 03, 05, 07, 08, 09 và gồm 10 chữ số', 'Phone number must start with 03, 05, 07, 08, 09 and contain 10 digits', '電話番号は03・05・07・08・09で始まり、10桁である必要があります')}</p>
                  )}
                  {phoneNumber && isPhoneValid && (
                    <p className="text-xs text-green-400 mt-1 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> {tx('Số điện thoại hợp lệ để liên hệ', 'Valid phone number for contact', '連絡用の有効な電話番号です')}
                    </p>
                  )}
                </div>

                {/* Navigation */}
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setCurrentStep(1)} className="flex-1">
                    <ChevronLeft className="h-4 w-4 mr-2" /> {tx('Quay lại', 'Back', '戻る')}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setCurrentStep(3)}
                    disabled={!isPhoneValid}
                    className="flex-1"
                    size="lg"
                  >
                    {tx('Tiếp tục', 'Continue', '続ける')} <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ═══ STEP 3: REVIEW & SUBMIT ═══ */}
          {currentStep === 3 && (
            <Card className="border-orange-500/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileCheck className="h-5 w-5 text-orange-500" />
                  {tx('Bước 3: Xác nhận thông tin', 'Step 3: Confirm information', 'ステップ3: 情報確認')}
                </CardTitle>
                <CardDescription>
                  {tx('Kiểm tra lại toàn bộ thông tin trước khi gửi yêu cầu xác minh.', 'Review all information before submitting the verification request.', '確認申請を送信する前に全情報を見直してください。')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Summary */}
                <div className="space-y-4">
                  <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 space-y-3">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-orange-500" /> {tx('Thông tin danh tính', 'Identity information', '本人情報')}
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">{tx('Họ tên', 'Full name', '氏名')}</p>
                        <p className="font-medium">{fullName}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">{tx('Danh tính', 'Identity', '本人確認')}</p>
                        <p className={`font-semibold ${isKycApproved ? 'text-green-500' : 'text-yellow-500'}`}>
                          {isKycApproved
                            ? tx('✅ Đã xác minh', '✅ Verified', '✅ 確認済み')
                            : tx('⏳ Chưa xong', '⏳ Incomplete', '⏳ 未完了')}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">{tx('Ngân hàng', 'Bank', '銀行')}</p>
                        <p className="font-medium">{bankName}</p>
                      </div>
                      <div>
                      <p className="text-muted-foreground text-xs">{tx('Số tài khoản', 'Account number', '口座番号')}</p>
                      <p className="font-mono font-medium">{editableBankAccountNumber || noDataLabel(locale)}</p>
                    </div>
                      <div>
                        <p className="text-muted-foreground text-xs">{tx('Tên chủ tài khoản', 'Account holder name', '口座名義')}</p>
                        <p className="font-medium">{editableBankAccountName || noDataLabel(locale)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">{tx('Tài khoản ngân hàng', 'Bank account', '銀行口座')}</p>
                        <p className={`font-semibold ${isBankVerified ? 'text-green-500' : isBankLookupUnavailable ? 'text-yellow-500' : 'text-red-500'}`}>
                          {isBankVerified
                            ? tx('✅ Đã đối chiếu với ngân hàng', '✅ Verified with the bank', '✅ 銀行と照合済み')
                            : isBankLookupUnavailable
                              ? tx('⚠️ Tra cứu đang bận, sẽ đối chiếu lại khi gửi', '⚠️ Lookup busy, will be re-checked on submit', '⚠️ 照会が混雑中・送信時に再照合されます')
                              : tx('❌ Chưa đối chiếu', '❌ Not verified', '❌ 未照合')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 space-y-3">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      <Phone className="h-4 w-4 text-orange-500" /> {tx('Liên hệ', 'Contact', '連絡先')}
                    </h4>
                    <div className="text-sm">
                      <p className="text-muted-foreground text-xs">{tx('Số điện thoại', 'Phone number', '電話番号')}</p>
                      <p className="font-mono font-medium">{phoneNumber}</p>
                    </div>
                  </div>

                  <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 space-y-3">
                    <h4 className="font-semibold text-sm">{tx('Giấy tờ', 'Documents', '書類')}</h4>
                    <div className="flex flex-wrap gap-2 text-xs text-green-400">
                      <span className="flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" /> {tx('CCCD + khuôn mặt do đối tác xác minh', 'ID + face verified by our partner', '身分証・顔認証はパートナーが実施')}
                      </span>
                      {bankScreenshotFile && (
                        <span className="flex items-center gap-1"><CheckCircle className="h-3 w-3" /> {tx('Ảnh ngân hàng', 'Bank screenshot', '銀行スクリーンショット')}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-400">
                  ⚠️ {tx('Nếu danh tính đã xác minh và mọi thông tin khớp, hồ sơ được duyệt ngay. Trường hợp có dấu hiệu bất thường, admin sẽ soát lại trước khi duyệt.', 'If your identity is verified and everything matches, approval is immediate. Anything unusual is reviewed by an admin first.', '本人確認済みで情報が一致すれば即時承認されます。不審な点がある場合は管理者が先に確認します。')}
                </div>

                {retryFlags.length > 0 && (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 space-y-2">
                    <p className="flex items-center gap-2 text-sm font-semibold text-red-300">
                      <AlertTriangle className="h-4 w-4" /> {t('seller_kyc_retry_title')}
                    </p>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-red-200/90">
                      {retryFlags.map((flag, i) => <li key={i}>{flag}</li>)}
                    </ul>
                    <p className="text-xs text-red-200/70">{t('seller_kyc_retry_help')}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setCurrentStep(2)} className="flex-1">
                    <ChevronLeft className="h-4 w-4 mr-2" /> {tx('Quay lại', 'Back', '戻る')}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleKYCSubmit}
                    disabled={isSubmitting || !isSubmittedNameMatch || !isPhoneValid || !isKycApproved || !(isBankVerified || isBankLookupUnavailable)}
                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold"
                    size="lg"
                  >
                    {isSubmitting ? null : <ShieldCheck className="h-4 w-4 mr-2" />}
                    {isSubmitting ? tx('Đang gửi...', 'Submitting...', '送信中...') : tx('Gửi yêu cầu xác minh', 'Submit verification request', '確認申請を送信')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      {/* Terminal refusal: one account per person. No retry button — another
          submit returns the same 409 — so the only way out is support. */}
      <AlertDialog open={blockedAxis !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-400">
              <ShieldAlert className="h-5 w-5" /> {t('seller_kyc_blocked_title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 pt-2">
              <span className="block">
                {blockedAxis === 'bank'
                  ? t('seller_kyc_blocked_bank')
                  : blockedAxis === 'both'
                    ? t('seller_kyc_blocked_both')
                    : t('seller_kyc_blocked_document')}
              </span>
              <span className="block font-medium text-foreground">{t('seller_kyc_blocked_rule')}</span>
              <span className="block text-xs">{t('seller_kyc_blocked_help')}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setBlockedAxis(null)} asChild>
              <Link href="/contact">{t('seller_kyc_contact_support')}</Link>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
