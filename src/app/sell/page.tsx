
'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShieldCheck, ShieldAlert, Upload, Loader2, Package, Plus, Clock, CheckCircle, XCircle, Phone, FileCheck, ChevronRight, ChevronLeft, Sparkles, AlertTriangle, MapPin, Truck } from 'lucide-react';
import { SHIPPING_CARRIERS } from '@/lib/shipping-carriers';
import { useAuth, useSupabase } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { useToast } from '@/hooks/use-toast';
import { useLocalization } from '@/context/localization-context';
import { Skeleton } from '@/components/ui/skeleton';
import { getCloudinarySignature, uploadImageDirectToCloudinary, type CloudinarySignaturePayload } from '@/lib/cloudinary-direct';
import { getCloudinaryKycScanUrl, toDisplaySafeUrl, optimizeCloudinaryUrl } from '@/lib/cloudinary-url';
import { isHeicFile, convertHeicToJpeg } from '@/lib/heic';
import { SellerAddressForm } from '@/components/seller-address-form';
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
  listing_type: string;
  category: string | null;
  condition: string | null;
  created_at: string;
};

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
        const isHtml = text.trimStart().startsWith('<');
        throw new Error(
            isHtml
                ? `Máy chủ trả về trang lỗi (HTTP ${res.status}) thay vì dữ liệu. Endpoint có thể chưa được deploy.`
                : `Phản hồi không hợp lệ từ máy chủ (HTTP ${res.status}).`
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
  const { t, locale } = useLocalization();
  const { user, isLoading: authLoading } = useAuth();
  const { setOpen } = useAuthModal();
  const { toast } = useToast();
  const supabase = useSupabase();

  const [verification, setVerification] = useState<Verification | null>(null);
  const [isLoadingVerification, setIsLoadingVerification] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sellerOrders, setSellerOrders] = useState<SellerOrder[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [myListings, setMyListings] = useState<MyListing[]>([]);
  const [isLoadingListings, setIsLoadingListings] = useState(false);
  const [pickupAddress, setPickupAddress] = useState<{ line: string } | null>(null);
  const [isLoadingAddress, setIsLoadingAddress] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  // Shop-level shipping options: selected carriers + per-carrier tiered fees
  // (formatted strings like "15.000") keyed by carrier code.
  const [shipCarriers, setShipCarriers] = useState<string[]>([]);
  const [shipFees, setShipFees] = useState<Record<string, { intra: string; inter: string; region: string }>>({});
  const [savingShipping, setSavingShipping] = useState(false);

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
        addPickupAddress: '集荷先住所を追加',
        listCard: 'カードを出品',
        waitingShip: '発送待ち',
        shipping: '配送中',
        completed: '完了',
        totalEarnings: '総収益',
        pickupAddress: '集荷先住所',
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
          addPickupAddress: 'Thêm địa chỉ để bán',
          listCard: 'Đăng bán thẻ',
          waitingShip: 'Chờ giao hàng',
          shipping: 'Đang giao',
          completed: 'Hoàn tất',
          totalEarnings: 'Tổng thu nhập',
          pickupAddress: 'Địa chỉ lấy hàng',
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
          addPickupAddress: 'Add pickup address',
          listCard: 'List a card',
          waitingShip: 'Waiting to ship',
          shipping: 'Shipping',
          completed: 'Completed',
          totalEarnings: 'Total earnings',
          pickupAddress: 'Pickup address',
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

  const normalizeVietnameseName = (value: string) => value
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

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
  // Word order is not stable across a CCCD, a bank record and an MRZ, so
  // compare the words as a set. Mirrors namesMatch() on the server, which is
  // what actually decides.
  const nameKey = (value: string) => {
    const words = normalizeVietnameseName(value).split(' ').filter(Boolean);
    return words.length ? words.sort().join(' ') : '';
  };
  const verifiedName = kycSession?.verified_full_name || '';
  const isSubmittedNameMatch = !!nameKey(verifiedName)
    && nameKey(fullName) === nameKey(verifiedName)
    && nameKey(editableBankAccountName) === nameKey(verifiedName);

  useEffect(() => {
    if (!authLoading && !user) setOpen(true);
  }, [authLoading, user, setOpen]);

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
          setTimeout(() => fetchVerification(attempt + 1), 600);
          return;
        }
        setIsLoadingVerification(false);
        return;
      }
      const data = await res.json();
      setVerification(data.verification ?? null);

      if (data.verification?.status === 'approved') {
        fetchSellerOrders();
        fetchMyListings();
        fetchPickupAddress();
      }
      setIsLoadingVerification(false);
    } catch (err) {
      console.error('Failed to fetch verification:', err);
      if (attempt < 4) {
        setTimeout(() => fetchVerification(attempt + 1), 600);
        return;
      }
      setIsLoadingVerification(false);
    }
  };

  const fetchSellerOrders = async () => {
    setIsLoadingOrders(true);
    try {
      const res = await fetch('/api/marketplace/orders?role=seller');
      const data = await res.json();
      setSellerOrders(data.orders || []);
    } catch (err) {
      console.error('Failed to fetch seller orders:', err);
    } finally {
      setIsLoadingOrders(false);
    }
  };

  const fetchMyListings = async () => {
    if (!user) return;
    setIsLoadingListings(true);
    try {
      const { data, error } = await supabase
        .from('cards')
        .select('id, name, image_url, price, status, listing_type, category, condition, created_at')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false });
      if (!error && data) {
        setMyListings(data as MyListing[]);
      }
    } catch (err) {
      console.error('Failed to fetch seller listings:', err);
    } finally {
      setIsLoadingListings(false);
    }
  };

  const fetchPickupAddress = async () => {
    if (!user) return;
    setIsLoadingAddress(true);
    try {
      const { data } = await supabase
        .from('profiles')
        .select(
          'address_province_name, address_district_name, address_ward_name, address_detail, address_district_id, address_ward_code, shipping_carriers, shipping_fees'
        )
        .eq('id', user.id)
        .single();
      const p = data as Record<string, any> | null;
      setShipCarriers(p?.shipping_carriers || []);
      const savedFees = (p?.shipping_fees || {}) as Record<string, any>;
      const formatted: Record<string, { intra: string; inter: string; region: string }> = {};
      for (const [code, f] of Object.entries(savedFees)) {
        const fmt = (n: any) => (n ? Number(n).toLocaleString('vi-VN') : '');
        formatted[code] = { intra: fmt(f?.intra), inter: fmt(f?.inter), region: fmt(f?.region) };
      }
      setShipFees(formatted);
      if (p?.address_district_id && p?.address_ward_code) {
        setPickupAddress({
          line: [p.address_detail, p.address_ward_name, p.address_district_name, p.address_province_name]
            .filter(Boolean)
            .join(', '),
        });
      } else {
        setPickupAddress(null);
      }
    } catch (err) {
      console.error('Failed to fetch pickup address:', err);
    } finally {
      setIsLoadingAddress(false);
    }
  };

  // Format a raw money string with thousand separators, e.g. "15000" → "15.000".
  const formatVndInput = (v: string) => {
    const d = (v || '').replace(/[^\d]/g, '');
    return d ? Number(d).toLocaleString('vi-VN') : '';
  };

  const toggleShipCarrier = (code: string) => {
    setShipCarriers(prev => (prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]));
    // Seed an empty fee form when a fee-bearing carrier is first selected.
    if (code !== 'self') {
      setShipFees(prev => (prev[code] ? prev : { ...prev, [code]: { intra: '', inter: '', region: '' } }));
    }
  };

  const setShipFee = (code: string, tier: 'intra' | 'inter' | 'region', raw: string) => {
    setShipFees(prev => {
      const cur = prev[code] || { intra: '', inter: '', region: '' };
      return { ...prev, [code]: { ...cur, [tier]: formatVndInput(raw) } };
    });
  };

  const saveShippingOptions = async () => {
    if (!user) return;
    if (shipCarriers.length === 0) {
      toast({ variant: 'destructive', title: tx('Thiếu đơn vị vận chuyển', 'Missing carrier', '配送業者が未選択'), description: tx('Chọn ít nhất 1 đơn vị vận chuyển.', 'Pick at least one carrier.', '配送業者を1つ以上選んでください。') });
      return;
    }
    // Every non-self carrier must have all three tier fees filled.
    const feesObj: Record<string, { intra: number; inter: number; region: number }> = {};
    for (const code of shipCarriers) {
      if (code === 'self') continue;
      const f = shipFees[code] || { intra: '', inter: '', region: '' };
      const intra = parseInt(f.intra.replace(/[^\d]/g, '')) || 0;
      const inter = parseInt(f.inter.replace(/[^\d]/g, '')) || 0;
      const region = parseInt(f.region.replace(/[^\d]/g, '')) || 0;
      if (!intra || !inter || !region) {
        const name = SHIPPING_CARRIERS.find(c => c.code === code)?.name || code;
        toast({ variant: 'destructive', title: tx('Thiếu phí ship', 'Missing shipping fee', '送料が未入力'), description: tx(`Điền đủ 3 mức phí cho ${name}.`, `Fill all three fees for ${name}.`, `${name} の3つの料金をすべて入力してください。`) });
        return;
      }
      feesObj[code] = { intra, inter, region };
    }
    setSavingShipping(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ shipping_carriers: shipCarriers, shipping_fees: feesObj } as never)
        .eq('id', user.id);
      if (error) throw error;
      toast({ title: tx('Đã lưu vận chuyển', 'Shipping saved', '配送を保存しました') });
    } catch (err: any) {
      toast({ variant: 'destructive', title: tx('Lỗi', 'Error', 'エラー'), description: err.message || 'Failed' });
    } finally {
      setSavingShipping(false);
    }
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

  const refreshKycSession = async (options?: { silent?: boolean }) => {
    if (!options?.silent) setIsRefreshingKyc(true);
    try {
      const res = await fetch('/api/seller/kyc/session');
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
      window.location.href = data.url as string;
    } catch (err: any) {
      setKycError(err?.message || tx('Lỗi kết nối. Vui lòng thử lại.', 'Connection error. Please try again.', '接続エラーです。もう一度お試しください。'));
    } finally {
      setIsStartingKyc(false);
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
      refreshKycSession({ silent: true });
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
      fetchVerification();
    } catch (err: any) {
      toast({ variant: 'destructive', title: tx('Lỗi', 'Error', 'エラー'), description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatVND = (amount: number) => new Intl.NumberFormat('vi-VN').format(amount) + 'đ';

  const STATUS_MAP: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    paid: { label: copy.waitingShip, icon: <Package className="h-4 w-4" />, color: 'text-blue-400' },
    shipping: { label: copy.shipping, icon: <Package className="h-4 w-4" />, color: 'text-yellow-400' },
    completed: { label: copy.completed, icon: <CheckCircle className="h-4 w-4" />, color: 'text-green-400' },
    disputed: { label: tx('Khiếu nại', 'Disputed', '紛争中'), icon: <XCircle className="h-4 w-4" />, color: 'text-red-400' },
    cancelled: { label: tx('Đã hủy', 'Cancelled', 'キャンセル済み'), icon: <XCircle className="h-4 w-4" />, color: 'text-muted-foreground' },
  };

  const isPhoneValid = /^0[3-9]\d{8}$/.test(phoneNumber);

  // ── LOADING STATE ──
  if (authLoading || isLoadingVerification) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header />
        <main className="flex-1 container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto space-y-6">
            <Skeleton className="h-10 w-64 mx-auto" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ── NOT LOGGED IN ──
  if (!user) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header />
        <main className="flex-1 container mx-auto px-4 py-8 flex flex-col items-center justify-center">
          <ShieldAlert className="h-16 w-16 text-muted-foreground mb-4" />
          <h2 className="text-2xl font-semibold mb-2">{copy.signInToSell}</h2>
          <Button onClick={() => setOpen(true)}>{copy.signIn}</Button>
        </main>
        <Footer />
      </div>
    );
  }

  // ── KYC PENDING ──
  if (verification?.status === 'pending') {
    return (
      <div className="flex flex-col min-h-screen">
        <Header />
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
        <Footer />
      </div>
    );
  }

  // ── KYC REJECTED ──
  if (verification?.status === 'rejected') {
    return (
      <div className="flex flex-col min-h-screen">
        <Header />
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
        <Footer />
      </div>
    );
  }

  // ── KYC APPROVED — SELLER DASHBOARD ──
  if (verification?.status === 'approved') {
    const pendingOrders = sellerOrders.filter(o => o.status === 'paid');
    const shippingOrders = sellerOrders.filter(o => o.status === 'shipping');
    const completedOrders = sellerOrders.filter(o => o.status === 'completed');
    const totalEarnings = completedOrders.reduce((sum, o) => sum + (o.amount - o.platform_fee), 0);

    return (
      <div className="flex flex-col min-h-screen">
        <Header />
        <main className="flex-1 container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold flex items-center gap-2" style={{ fontFamily: "'Orbitron', sans-serif" }}>
                  <ShieldCheck className="h-8 w-8 text-green-500" />
                  {copy.dashboardTitle}
                </h1>
                <p className="text-muted-foreground mt-1">{copy.dashboardDesc}</p>
              </div>
              {!pickupAddress && !isLoadingAddress ? (
                <Button
                  className="bg-orange-500 hover:bg-orange-600"
                  onClick={() => {
                    document.getElementById('pickup-address')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setEditingAddress(true);
                  }}
                >
                  <MapPin className="h-4 w-4 mr-2" />
                  {copy.addPickupAddress}
                </Button>
              ) : (
                <Button asChild className="bg-orange-500 hover:bg-orange-600">
                  <Link href="/sell/create">
                    <Plus className="h-4 w-4 mr-2" />
                    {copy.listCard}
                  </Link>
                </Button>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="bg-blue-500/5 border-blue-500/20">
                <CardContent className="pt-6 text-center">
                  <p className="text-2xl font-bold text-blue-400">{pendingOrders.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">{copy.waitingShip}</p>
                </CardContent>
              </Card>
              <Card className="bg-yellow-500/5 border-yellow-500/20">
                <CardContent className="pt-6 text-center">
                  <p className="text-2xl font-bold text-yellow-400">{shippingOrders.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">{copy.shipping}</p>
                </CardContent>
              </Card>
              <Card className="bg-green-500/5 border-green-500/20">
                <CardContent className="pt-6 text-center">
                  <p className="text-2xl font-bold text-green-400">{completedOrders.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">{copy.completed}</p>
                </CardContent>
              </Card>
              <Card className="bg-orange-500/5 border-orange-500/20">
                <CardContent className="pt-6 text-center">
                  <p className="text-2xl font-bold text-orange-400">{formatVND(totalEarnings)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{copy.totalEarnings}</p>
                </CardContent>
              </Card>
            </div>

            {/* Pickup Address — required so shipping fees can be calculated */}
            <Card id="pickup-address" className={!pickupAddress && !isLoadingAddress ? 'border-orange-500/40 bg-orange-500/5' : ''}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-orange-400" />
                    {copy.pickupAddress}
                  </span>
                  {pickupAddress && !editingAddress && (
                    <Button variant="outline" size="sm" onClick={() => setEditingAddress(true)}>
                      {copy.update}
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoadingAddress ? (
                  <Skeleton className="h-9 w-full rounded-lg" />
                ) : (
                  <>
                    {!pickupAddress && (
                      <div className="mb-4 flex items-start gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 text-sm text-orange-300">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>
                          {copy.pickupNotice}
                        </span>
                      </div>
                    )}
                    {pickupAddress && !editingAddress ? (
                      <div className="flex items-start gap-2 text-sm">
                        <MapPin className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                        <span>{pickupAddress.line}</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <SellerAddressForm
                          submitLabel={copy.savePickup}
                          onSaved={() => {
                            setEditingAddress(false);
                            fetchPickupAddress();
                          }}
                        />
                        {pickupAddress && editingAddress && (
                          <Button variant="ghost" size="sm" onClick={() => setEditingAddress(false)}>
                            {copy.cancel}
                          </Button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Shop shipping options */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5 text-orange-400" />
                  {tx('Vận chuyển của shop', 'Shop shipping', 'ショップ配送')}
                </CardTitle>
                <CardDescription>
                  {tx('Chọn đơn vị vận chuyển và khoảng phí ship. Thông tin này hiển thị trên mọi bài đăng; người mua trả mức phí tối đa khi thanh toán.', 'Pick your carriers and a fee range. It shows on all your listings; buyers are charged the maximum at checkout.', '配送業者と料金範囲を選択します。全出品に表示され、購入者は上限額を支払います。')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{tx('Đơn vị vận chuyển', 'Carriers', '配送業者')}</Label>
                  <div className="flex flex-wrap gap-2">
                    {SHIPPING_CARRIERS.map(c => (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => toggleShipCarrier(c.code)}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${shipCarriers.includes(c.code) ? 'border-orange-500 bg-orange-500/15 text-orange-300' : 'border-border/60 text-muted-foreground hover:border-orange-500/40'}`}
                      >
                        {c.logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.logo} alt="" className="h-5 w-5 rounded" />
                        ) : (
                          <Truck className="h-4 w-4" />
                        )}
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
                {shipCarriers.some(c => c !== 'self') && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      {tx('Nội tỉnh = cùng tỉnh · Ngoại tỉnh = khác tỉnh, cùng miền · Liên miền = khác miền (Bắc/Trung/Nam). Điền phí riêng cho từng đơn vị (bắt buộc).',
                          'Same province · same region (different province) · cross-region (North/Central/South). Fill fees per carrier (required).',
                          '同一省内 · 同一地域（別の省）· 地域間（北/中/南）。配送業者ごとに料金を入力（必須）。')}
                    </p>
                    {shipCarriers.filter(c => c !== 'self').map(code => {
                      const carrier = SHIPPING_CARRIERS.find(c => c.code === code);
                      const f = shipFees[code] || { intra: '', inter: '', region: '' };
                      return (
                        <div key={code} className="space-y-3 rounded-lg border border-border/60 bg-background/40 p-3">
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            {carrier?.logo && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={carrier.logo} alt="" className="h-5 w-5 rounded" />
                            )}
                            {carrier?.name}
                          </div>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div className="space-y-1.5">
                              <Label>{tx('Nội tỉnh (đ)', 'Same province (đ)', '同一省内 (đ)')}</Label>
                              <Input inputMode="numeric" value={f.intra} onChange={e => setShipFee(code, 'intra', e.target.value)} placeholder="15.000" />
                            </div>
                            <div className="space-y-1.5">
                              <Label>{tx('Ngoại tỉnh (đ)', 'Same region (đ)', '同一地域 (đ)')}</Label>
                              <Input inputMode="numeric" value={f.inter} onChange={e => setShipFee(code, 'inter', e.target.value)} placeholder="25.000" />
                            </div>
                            <div className="space-y-1.5">
                              <Label>{tx('Liên miền (đ)', 'Cross-region (đ)', '地域間 (đ)')}</Label>
                              <Input inputMode="numeric" value={f.region} onChange={e => setShipFee(code, 'region', e.target.value)} placeholder="40.000" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <Button onClick={() => void saveShippingOptions()} disabled={savingShipping} className="bg-orange-500 hover:bg-orange-600">
                  {savingShipping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
                  {tx('Lưu vận chuyển', 'Save shipping', '配送を保存')}
                </Button>
              </CardContent>
            </Card>

            {/* My Listings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Package className="h-5 w-5 text-orange-400" />
                    {copy.myListings}
                    {!isLoadingListings && myListings.length > 0 && (
                      <span className="text-sm font-normal text-muted-foreground">
                        ({copy.activeListings.replace('{count}', String(myListings.filter(l => l.status === 'active').length))})
                      </span>
                    )}
                  </span>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/buy">{copy.viewMarketplace}</Link>
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoadingListings ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {[1, 2, 3, 4].map(i => <Skeleton key={i} className="aspect-[3/4] w-full rounded-lg" />)}
                  </div>
                ) : myListings.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground mb-4">{copy.noListings}</p>
                    <Button asChild className="bg-orange-500 hover:bg-orange-600">
                      <Link href="/sell/create">
                        <Plus className="h-4 w-4 mr-2" />
                        {copy.firstListing}
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {myListings.map((listing) => {
                      const isSold = listing.status === 'sold';
                      return (
                        <Link
                          key={listing.id}
                          href={`/cards/${listing.id}`}
                          className="group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-all hover:border-orange-500/40 hover:shadow-md"
                        >
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
                            <span
                              className={`absolute left-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${isSold
                                ? 'bg-muted text-muted-foreground'
                                : 'bg-green-500/90 text-white'
                                }`}
                            >
                              {isSold ? copy.sold : copy.active}
                            </span>
                          </div>
                          <div className="flex flex-1 flex-col p-2.5">
                            <p className="line-clamp-1 text-sm font-medium">{listing.name}</p>
                            <p className="mt-1 text-sm font-bold text-orange-400">
                              {listing.price ? formatVND(listing.price) : '—'}
                            </p>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Orders */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{copy.recentOrders}</span>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/orders">{copy.viewAll}</Link>
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoadingOrders ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
                  </div>
                ) : sellerOrders.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">{copy.noOrders}</p>
                ) : (
                  <div className="space-y-3">
                    {sellerOrders.slice(0, 5).map((order) => {
                      const statusInfo = STATUS_MAP[order.status] || { label: order.status, icon: null, color: '' };
                      return (
                        <div key={order.id} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                          <div className="flex items-center gap-3">
                            {order.card?.image_url && (
                              <div className="relative w-10 h-14 rounded overflow-hidden flex-shrink-0">
                                <Image src={order.card.image_url} alt="" fill className="object-cover" />
                              </div>
                            )}
                            <div>
                              <p className="font-medium text-sm line-clamp-1">{order.card?.name || copy.unknownCard}</p>
                              <p className={`text-xs flex items-center gap-1 ${statusInfo.color}`}>
                                {statusInfo.icon} {statusInfo.label}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-sm">{formatVND(order.amount - order.platform_fee)}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(order.created_at).toLocaleDateString(locale)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
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
    <div className="flex flex-col min-h-screen">
      <Header />
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
                    'You will be taken to our verification partner to capture your ID and a face scan. The partner stores the document images — CardVerseHub keeps no copy.',
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
                        <p className="font-medium">{verifiedName || '—'}</p>
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
                        <Button type="button" variant="outline" size="sm" onClick={() => refreshKycSession()} disabled={isRefreshingKyc}>
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
                      <Button type="button" variant="outline" size="sm" onClick={() => refreshKycSession()} disabled={isRefreshingKyc}>
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
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
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
                              {b.shortName} — {b.name}
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
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          {tx('Đang tra cứu tài khoản...', 'Looking up account...', '口座を照会中...')}
                        </>
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
                  {tx('Nhập số điện thoại Việt Nam để bưu tá liên hệ lấy thẻ khi có đơn hàng. Admin sẽ kiểm tra lại khi duyệt seller.', 'Enter a Vietnamese phone number so carriers can contact you for pickup. Admin will verify it during seller approval.', '注文時に集荷担当が連絡できるベトナムの電話番号を入力してください。販売者承認時に管理者が確認します。')}
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
                      <p className="font-mono font-medium">{editableBankAccountNumber || '—'}</p>
                    </div>
                      <div>
                        <p className="text-muted-foreground text-xs">{tx('Tên chủ tài khoản', 'Account holder name', '口座名義')}</p>
                        <p className="font-medium">{editableBankAccountName || '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">{tx('Tài khoản ngân hàng', 'Bank account', '銀行口座')}</p>
                        <p className={`font-semibold ${isBankVerified ? 'text-green-500' : isBankLookupUnavailable ? 'text-yellow-500' : 'text-red-500'}`}>
                          {isBankVerified
                            ? tx('✅ Đã đối chiếu với ngân hàng', '✅ Verified with the bank', '✅ 銀行と照合済み')
                            : isBankLookupUnavailable
                              ? tx('⚠️ Admin sẽ kiểm tra thủ công', '⚠️ Admin will check manually', '⚠️ 管理者が手動で確認')
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
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                    {isSubmitting ? tx('Đang gửi...', 'Submitting...', '送信中...') : tx('Gửi yêu cầu xác minh', 'Submit verification request', '確認申請を送信')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
