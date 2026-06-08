
'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShieldCheck, ShieldAlert, Upload, Loader2, Package, Plus, Clock, CheckCircle, XCircle, Phone, FileCheck, ChevronRight, ChevronLeft, Sparkles, AlertTriangle } from 'lucide-react';
import { useAuth, useSupabase } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { useToast } from '@/hooks/use-toast';
import { useLocalization } from '@/context/localization-context';
import { Skeleton } from '@/components/ui/skeleton';
import { getCloudinarySignature, uploadImageDirectToCloudinary, type CloudinarySignaturePayload } from '@/lib/cloudinary-direct';
import { getCloudinaryKycBackScanUrl, getCloudinaryKycScanUrl, toDisplaySafeUrl, optimizeCloudinaryUrl } from '@/lib/cloudinary-url';
import { isHeicFile, convertHeicToJpeg } from '@/lib/heic';
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

type AIResult = {
  scan_id: string;
  cccd_name: string;
  cccd_id_number: string | null;
  cccd_dob: string | null;
  is_valid_cccd: boolean;
  is_valid_cccd_back: boolean;
  bank_account_name: string;
  bank_account_number: string;
  bank_name_detected: string | null;
  is_valid_bank: boolean;
  is_name_match: boolean;
  is_cccd_bank_match: boolean;
  is_cccd_user_match: boolean;
  confidence: number;
  issues: string[] | null;
  duplicate?: {
    cccdDuplicate: boolean;
    bankDuplicate: boolean;
    matchedCount: number;
    notes: string | null;
  } | null;
  failure_type?: 'unreadable' | 'wrong_side' | 'low_confidence' | 'network' | null;
  debug_front_image_url?: string | null;
  debug_back_image_url?: string | null;
  debug_bank_image_url?: string | null;
  debug_front_result?: unknown;
  debug_back_result?: unknown;
  debug_bank_result?: unknown;
};

type UploadedKycAssets = {
  frontOriginalUrl: string | null;
  frontJpgUrl: string | null;
  backOriginalUrl: string | null;
  backJpgUrl: string | null;
  bankOriginalUrl: string | null;
  bankJpgUrl: string | null;
};

const BANKS = [
  'Vietcombank', 'Techcombank', 'MB Bank', 'BIDV', 'Agribank',
  'VPBank', 'ACB', 'Sacombank', 'TPBank', 'VIB',
  'SHB', 'HDBank', 'OCB', 'MSB', 'SeABank', 'Khác',
];

export default function SellPage() {
  const { t } = useLocalization();
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

  // Wizard step
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1: AI Verification
  const [fullName, setFullName] = useState('');
  const [bankName, setBankName] = useState('');
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [idBackFile, setIdBackFile] = useState<File | null>(null);

  const [bankScreenshotFile, setBankScreenshotFile] = useState<File | null>(null);
  const [processingType, setProcessingType] = useState<'front' | 'back' | 'bank' | null>(null);
  const [isAIChecking, setIsAIChecking] = useState(false);
  const [aiResult, setAIResult] = useState<AIResult | null>(null);
  const [aiError, setAIError] = useState<string | null>(null);
  const [aiScanCooldown, setAiScanCooldown] = useState(0);
  const [aiScanAttempts, setAiScanAttempts] = useState(0);
  const [pendingReplacements, setPendingReplacements] = useState({ front: false, back: false, bank: false });
  const [editableBankAccountName, setEditableBankAccountName] = useState('');
  const [editableBankAccountNumber, setEditableBankAccountNumber] = useState('');
  const [aiCheckStage, setAiCheckStage] = useState<string | null>(null);
  const [slowStageHint, setSlowStageHint] = useState<string | null>(null);
  const [uploadedKycAssets, setUploadedKycAssets] = useState<UploadedKycAssets>({
    frontOriginalUrl: null,
    frontJpgUrl: null,
    backOriginalUrl: null,
    backJpgUrl: null,
    bankOriginalUrl: null,
    bankJpgUrl: null,
  });
  const [kycUploadSignature, setKycUploadSignature] = useState<CloudinarySignaturePayload | null>(null);
  const AI_MAX_ATTEMPTS = 5;

  const handleFileChange = async (type: 'front' | 'back' | 'bank', file: File | null) => {
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
          title: 'Không đọc được ảnh',
          description: 'Vui lòng thử lại hoặc chọn ảnh định dạng JPG/PNG.',
        });
        setProcessingType(null);
        return;
      } finally {
        setProcessingType(null);
      }
    }

    if (type === 'front') setIdFrontFile(processed);
    if (type === 'back') setIdBackFile(processed);
    if (type === 'bank') setBankScreenshotFile(processed);

    setUploadedKycAssets(prev => ({
      ...prev,
      ...(type === 'front' ? { frontOriginalUrl: null, frontJpgUrl: null } : {}),
      ...(type === 'back' ? { backOriginalUrl: null, backJpgUrl: null } : {}),
      ...(type === 'bank' ? { bankOriginalUrl: null, bankJpgUrl: null } : {}),
    }));

    setPendingReplacements(prev => {
      const next = { ...prev, [type]: false };
      // Clear AI result to trigger rescan ONLY if all invalid files have been replaced
      if (!next.front && !next.back && !next.bank) {
        setAIResult(null);
      }
      return next;
    });
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

  const buildKycFriendlyError = (data: Partial<AIResult> & { error?: string; failure_type?: string; step?: string }) => {
    if (data.failure_type === 'wrong_side') {
      return data.error || 'Hệ thống nhận diện sai mặt giấy tờ. Vui lòng thử lại với ảnh rõ hơn hoặc đổi góc chụp.';
    }
    if (data.failure_type === 'low_confidence') {
      return data.error || 'Hệ thống đọc được ảnh nhưng độ chắc chắn còn thấp. Vui lòng thử lại với ảnh rõ hơn.';
    }
    if (data.failure_type === 'network') {
      return data.error || 'Kết nối đến dịch vụ kiểm tra đang chậm. Vui lòng thử lại sau.';
    }
    if (data.failure_type === 'unreadable') {
      return data.error || 'Không thể đọc được ảnh. Vui lòng chụp lại rõ hơn.';
    }
    return data.error || 'Hệ thống kiểm tra thất bại. Vui lòng thử lại.';
  };

  // Step 2: Phone + OTP
  const [phoneNumber, setPhoneNumber] = useState('');

  const normalizeVietnameseName = (value: string) => value
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const isSubmittedNameMatch = !!aiResult?.cccd_name
    && normalizeVietnameseName(fullName) === normalizeVietnameseName(aiResult.cccd_name)
    && normalizeVietnameseName(editableBankAccountName) === normalizeVietnameseName(aiResult.cccd_name);
  const canStartSystemScan = !!fullName.trim() && !!idFrontFile && !!idBackFile && !!bankScreenshotFile && !!bankName && !isAIChecking && aiScanCooldown <= 0 && aiScanAttempts < AI_MAX_ATTEMPTS;

  useEffect(() => {
    if (!authLoading && !user) setOpen(true);
  }, [authLoading, user, setOpen]);

  useEffect(() => {
    if (authLoading) return;
    if (user) {
      fetchVerification();
    } else {
      setIsLoadingVerification(false);
    }
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

  const uploadKycFiles = async (frontFile: File, backFile: File, bankFile: File) => {
    if (
      uploadedKycAssets.frontOriginalUrl &&
      uploadedKycAssets.frontJpgUrl &&
      uploadedKycAssets.backOriginalUrl &&
      uploadedKycAssets.backJpgUrl &&
      uploadedKycAssets.bankOriginalUrl &&
      uploadedKycAssets.bankJpgUrl
    ) {
      return uploadedKycAssets;
    }

    const uploadStart = performance.now();
    setAiCheckStage('Đang tải ảnh lên Cloudinary...');
    console.log('[KYC Flow] Starting Cloudinary upload batch');

    const signature = await getOrCreateKycSignature();
    const nextAssets: UploadedKycAssets = { ...uploadedKycAssets };

    const uploadTasks: Promise<void>[] = [];

    if (!nextAssets.frontOriginalUrl || !nextAssets.frontJpgUrl) {
      uploadTasks.push(
        uploadImageDirectToCloudinary(frontFile, signature).then(upload => {
          nextAssets.frontOriginalUrl = toDisplaySafeUrl(frontFile.name, upload.secureUrl);
          nextAssets.frontJpgUrl = getCloudinaryKycScanUrl(upload.secureUrl);
        })
      );
    }

    if (!nextAssets.backOriginalUrl || !nextAssets.backJpgUrl) {
      uploadTasks.push(
        uploadImageDirectToCloudinary(backFile, signature).then(upload => {
          nextAssets.backOriginalUrl = toDisplaySafeUrl(backFile.name, upload.secureUrl);
          nextAssets.backJpgUrl = getCloudinaryKycBackScanUrl(upload.secureUrl);
        })
      );
    }

    if (!nextAssets.bankOriginalUrl || !nextAssets.bankJpgUrl) {
      uploadTasks.push(
        uploadImageDirectToCloudinary(bankFile, signature).then(upload => {
          nextAssets.bankOriginalUrl = toDisplaySafeUrl(bankFile.name, upload.secureUrl);
          nextAssets.bankJpgUrl = getCloudinaryKycScanUrl(upload.secureUrl);
        })
      );
    }

    await Promise.all(uploadTasks);

    console.log(
      `[KYC Flow] Cloudinary upload batch completed in ${(performance.now() - uploadStart).toFixed(0)}ms`
    );

    setUploadedKycAssets(nextAssets);
    return nextAssets;
  };

  // Step 1: Run system verification (all 3 images + user name)
  const handleAICheck = async (frontFile: File, backFile: File, bankFile: File, userName: string) => {
    if (aiScanAttempts >= AI_MAX_ATTEMPTS) {
      setAIError('Bạn đã sử dụng hết số lần kiểm tra. Vui lòng tải lại trang và thử lại sau.');
      return;
    }
    setIsAIChecking(true);
    setAIError(null);
    setAIResult(null);
    setAiCheckStage('Đang chuẩn bị quét...');
    setSlowStageHint(null);
    setAiScanAttempts(prev => prev + 1);
    const requestId = `kyc-${Date.now()}`;
    const scanStart = performance.now();
    console.log(`[KYC Flow][${requestId}] Scan started`);

    try {
      const uploadedAssets = await uploadKycFiles(frontFile, backFile, bankFile);
      setAiCheckStage('Đang đối chiếu CCCD và tài khoản...');
      console.log(
        `[KYC Flow][${requestId}] Upload phase done in ${(performance.now() - scanStart).toFixed(0)}ms`
      );

      const aiRequestStart = performance.now();
      const response = await fetch('/api/seller/ai-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: requestId,
          cccd_front_image_url: uploadedAssets.frontJpgUrl,
          cccd_back_image_url: uploadedAssets.backJpgUrl,
          bank_image_url: uploadedAssets.bankJpgUrl,
          user_full_name: userName,
        }),
      });
      console.log(
        `[KYC Flow][${requestId}] /api/seller/ai-check responded in ${(performance.now() - aiRequestStart).toFixed(0)}ms`
      );

      const data = await response.json();

      if (!response.ok) {
        if (data.debug_front_image_url || data.debug_back_image_url || data.debug_bank_image_url) {
          console.log(`[KYC Flow][${requestId}] Debug image URLs`, {
            front: data.debug_front_image_url,
            back: data.debug_back_image_url,
            bank: data.debug_bank_image_url,
          });
        }
        setAIError(buildKycFriendlyError(data));
        return;
      }

      const result = data as AIResult;
      if (result.debug_front_image_url || result.debug_back_image_url || result.debug_bank_image_url) {
        console.log(`[KYC Flow][${requestId}] Debug image URLs`, {
          front: result.debug_front_image_url,
          back: result.debug_back_image_url,
          bank: result.debug_bank_image_url,
        });
      }
      setAIResult(result);
      setEditableBankAccountName(result.bank_account_name || '');
      setEditableBankAccountNumber(result.bank_account_number || '');

      // Require user to replace ALL invalid images if there are multiple errors
      const errorCount = (!result.is_valid_cccd ? 1 : 0) + (!result.is_valid_cccd_back ? 1 : 0) + (!result.is_valid_bank ? 1 : 0);
      if (errorCount > 1) {
        setPendingReplacements({
          front: !result.is_valid_cccd,
          back: !result.is_valid_cccd_back,
          bank: !result.is_valid_bank,
        });
      } else {
        setPendingReplacements({ front: false, back: false, bank: false });
      }

      // Auto-fill bank name from AI detection
      if (result.bank_name_detected) {
        const detected = result.bank_name_detected;
        const matchedBank = BANKS.find(b => b.toLowerCase() === detected.toLowerCase());
        if (matchedBank) {
          setBankName(matchedBank);
        }
      }

      if (result.issues && result.issues.length > 0) {
        toast({ variant: 'destructive', title: '⚠️ Phát hiện vấn đề', description: result.issues[0] });
      } else if (result.is_name_match && result.confidence >= 0.7) {
        toast({ title: '✅ Xác minh thành công!', description: 'Tất cả thông tin trùng khớp.' });
      } else {
        toast({ variant: 'destructive', title: '⚠️ Cần kiểm tra lại', description: 'Ảnh hợp lệ nhưng bạn nên kiểm tra và chỉnh sửa lại thông tin ngân hàng nếu hệ thống đọc sai.' });
      }

      // Cross-account duplicate warning (CCCD / bank already used elsewhere).
      if (result.duplicate && (result.duplicate.cccdDuplicate || result.duplicate.bankDuplicate)) {
        toast({
          variant: 'destructive',
          title: '⚠️ Thông tin đã được sử dụng',
          description: result.duplicate.notes || 'CCCD hoặc số tài khoản này đã đăng ký ở tài khoản khác.',
        });
      }
      console.log(
        `[KYC Flow][${requestId}] Total scan completed in ${(performance.now() - scanStart).toFixed(0)}ms`
      );
    } catch (err: any) {
      console.error(`[KYC Flow][${requestId}] Failed after ${(performance.now() - scanStart).toFixed(0)}ms`, err);
      setAIError(err.message || 'Lỗi kết nối hệ thống');
    } finally {
      setIsAIChecking(false);
      setAiCheckStage(null);
      setAiScanCooldown(15); // 15s cooldown
    }
  };

  // AI scan cooldown timer
  useEffect(() => {
    if (aiScanCooldown <= 0) return;
    const timer = setInterval(() => setAiScanCooldown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [aiScanCooldown]);

  useEffect(() => {
    if (!isAIChecking || !aiCheckStage) {
      setSlowStageHint(null);
      return;
    }

    if (aiCheckStage.includes('Cloudinary')) {
      const timer = setTimeout(() => {
        setSlowStageHint('Ảnh đang được tải lên. Với HEIC lớn, bước này có thể mất thêm vài giây.');
      }, 8000);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setSlowStageHint('Hệ thống đang đọc chi tiết CCCD. Vui lòng đợi thêm một chút.');
    }, 20000);
    return () => clearTimeout(timer);
  }, [isAIChecking, aiCheckStage]);

  const handlePhoneChange = (value: string) => {
    const cleaned = value.replace(/[^0-9]/g, '');
    setPhoneNumber(cleaned);
  };

  // Final submit
  const handleKYCSubmit = async () => {
    if (!fullName || !bankName || !idFrontFile || !idBackFile || !bankScreenshotFile || !phoneNumber) {
      toast({ variant: 'destructive', title: 'Vui lòng điền đầy đủ thông tin ở tất cả các bước' });
      return;
    }

    if (!aiResult) {
      toast({ variant: 'destructive', title: 'Vui lòng chạy kiểm tra ở Bước 1 trước' });
      return;
    }

    if (!aiResult.scan_id || aiResult.confidence < 0.7 || !aiResult.is_valid_cccd || !aiResult.is_valid_cccd_back || !aiResult.is_valid_bank) {
      toast({ variant: 'destructive', title: 'Kết quả xác minh chưa đạt', description: 'Vui lòng quay lại Bước 1 và kiểm tra lại ảnh tải lên.' });
      return;
    }

    if (!editableBankAccountName || !editableBankAccountNumber || !isSubmittedNameMatch) {
      toast({ variant: 'destructive', title: 'Thông tin ngân hàng chưa khớp', description: 'Tên chủ tài khoản phải trùng với CCCD và họ tên đăng ký.' });
      return;
    }

    if (!isPhoneValid) {
      toast({ variant: 'destructive', title: 'Số điện thoại không hợp lệ', description: 'Vui lòng nhập số điện thoại Việt Nam hợp lệ.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const uploadedAssets = await uploadKycFiles(idFrontFile!, idBackFile!, bankScreenshotFile!);

      const res = await fetch('/api/seller/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName,
          id_card_front_url: uploadedAssets.frontOriginalUrl,
          id_card_back_url: uploadedAssets.backOriginalUrl,
          bank_screenshot_url: uploadedAssets.bankOriginalUrl,
          bank_name: bankName,
          bank_account_number: editableBankAccountNumber,
          bank_account_name: editableBankAccountName,
          phone_number: phoneNumber,
          scan_id: aiResult.scan_id,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast({ title: '✅ Đã gửi yêu cầu xác minh!', description: 'Hệ thống đã tiền duyệt hồ sơ. Admin sẽ xác nhận lần cuối trong vài giờ.' });
      fetchVerification();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Lỗi', description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatVND = (amount: number) => new Intl.NumberFormat('vi-VN').format(amount) + 'đ';

  const STATUS_MAP: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    paid: { label: 'Chờ giao hàng', icon: <Package className="h-4 w-4" />, color: 'text-blue-400' },
    shipping: { label: 'Đang giao', icon: <Package className="h-4 w-4" />, color: 'text-yellow-400' },
    completed: { label: 'Hoàn tất', icon: <CheckCircle className="h-4 w-4" />, color: 'text-green-400' },
    disputed: { label: 'Khiếu nại', icon: <XCircle className="h-4 w-4" />, color: 'text-red-400' },
    cancelled: { label: 'Đã hủy', icon: <XCircle className="h-4 w-4" />, color: 'text-muted-foreground' },
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
          <h2 className="text-2xl font-semibold mb-2">Đăng nhập để bán thẻ</h2>
          <Button onClick={() => setOpen(true)}>Đăng nhập</Button>
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
              <h2 className="text-2xl font-bold text-yellow-400">Đang chờ Admin duyệt lần cuối</h2>
              <p className="text-muted-foreground">
                Hồ sơ của bạn đã được hệ thống tiền duyệt thành công.
                Admin sẽ xác nhận lần cuối trong thời gian sớm nhất.
              </p>
              <p className="text-xs text-muted-foreground">
                Gửi lúc: {new Date(verification.created_at).toLocaleString('vi-VN')}
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
              <h2 className="text-2xl font-bold text-red-400">Yêu cầu bị từ chối</h2>
              <p className="text-muted-foreground">
                Lý do: {verification.rejection_reason || 'Không rõ. Vui lòng liên hệ hỗ trợ.'}
              </p>
              <Button onClick={() => setVerification(null)} variant="outline">
                Gửi lại yêu cầu xác minh
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
                  Seller Dashboard
                </h1>
                <p className="text-muted-foreground mt-1">Quản lý bài đăng và đơn hàng</p>
              </div>
              <Button asChild className="bg-orange-500 hover:bg-orange-600">
                <Link href="/sell/create">
                  <Plus className="h-4 w-4 mr-2" />
                  Đăng bán thẻ
                </Link>
              </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="bg-blue-500/5 border-blue-500/20">
                <CardContent className="pt-6 text-center">
                  <p className="text-2xl font-bold text-blue-400">{pendingOrders.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">Chờ giao hàng</p>
                </CardContent>
              </Card>
              <Card className="bg-yellow-500/5 border-yellow-500/20">
                <CardContent className="pt-6 text-center">
                  <p className="text-2xl font-bold text-yellow-400">{shippingOrders.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">Đang giao</p>
                </CardContent>
              </Card>
              <Card className="bg-green-500/5 border-green-500/20">
                <CardContent className="pt-6 text-center">
                  <p className="text-2xl font-bold text-green-400">{completedOrders.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">Hoàn tất</p>
                </CardContent>
              </Card>
              <Card className="bg-orange-500/5 border-orange-500/20">
                <CardContent className="pt-6 text-center">
                  <p className="text-2xl font-bold text-orange-400">{formatVND(totalEarnings)}</p>
                  <p className="text-xs text-muted-foreground mt-1">Tổng thu nhập</p>
                </CardContent>
              </Card>
            </div>

            {/* My Listings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Package className="h-5 w-5 text-orange-400" />
                    Bài đăng của tôi
                    {!isLoadingListings && myListings.length > 0 && (
                      <span className="text-sm font-normal text-muted-foreground">
                        ({myListings.filter(l => l.status === 'active').length} đang bán)
                      </span>
                    )}
                  </span>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/buy">Xem trên chợ</Link>
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
                    <p className="text-muted-foreground mb-4">Bạn chưa đăng bán thẻ nào.</p>
                    <Button asChild className="bg-orange-500 hover:bg-orange-600">
                      <Link href="/sell/create">
                        <Plus className="h-4 w-4 mr-2" />
                        Đăng bán thẻ đầu tiên
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
                              {isSold ? 'Đã bán' : 'Đang bán'}
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
                  <span>Đơn hàng gần đây</span>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/orders">Xem tất cả</Link>
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoadingOrders ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
                  </div>
                ) : sellerOrders.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">Chưa có đơn hàng nào</p>
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
                              <p className="font-medium text-sm line-clamp-1">{order.card?.name || 'Thẻ không xác định'}</p>
                              <p className={`text-xs flex items-center gap-1 ${statusInfo.color}`}>
                                {statusInfo.icon} {statusInfo.label}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-sm">{formatVND(order.amount - order.platform_fee)}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(order.created_at).toLocaleDateString('vi-VN')}
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
    { number: 1, title: 'Xác minh danh tính', icon: <Sparkles className="h-4 w-4" /> },
    { number: 2, title: 'Xác minh số điện thoại', icon: <Phone className="h-4 w-4" /> },
    { number: 3, title: 'Xác nhận & Gửi', icon: <FileCheck className="h-4 w-4" /> },
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
              Hoàn thành 3 bước xác minh để bắt đầu đăng bán thẻ trên CardVerse.
            </p>
          </div>

          {/* Full-screen AI Verification Overlay */}
          {isAIChecking && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-zinc-950 border border-orange-500/30 rounded-2xl p-8 flex flex-col items-center max-w-sm w-[90%] text-center shadow-2xl shadow-orange-500/10 animate-in zoom-in-95 duration-200">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-orange-500 blur-xl opacity-20 rounded-full animate-pulse"></div>
                  <Sparkles className="h-12 w-12 text-orange-500 relative z-10 animate-pulse" />
                </div>
                <h3 className="text-xl font-bold bg-gradient-to-r from-orange-400 to-rose-400 bg-clip-text text-transparent mb-2" style={{ fontFamily: "'Orbitron', sans-serif" }}>
                  {t('kyc_verifying_title')}
                </h3>
                <div className="flex items-start justify-center gap-2 mt-4 text-sm text-muted-foreground max-w-[280px]">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-orange-500 mt-0.5" />
                  <span className="text-left leading-snug">{t('kyc_verifying_subtitle')}</span>
                </div>
                {aiCheckStage && (
                  <p className="mt-3 text-xs text-orange-300/90">
                    {aiCheckStage}
                  </p>
                )}
                {slowStageHint && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {slowStageHint}
                  </p>
                )}
              </div>
            </div>
          )}

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

          {/* ═══ STEP 1: AI IDENTITY CHECK ═══ */}
          {currentStep === 1 && (
            <Card className="border-orange-500/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-orange-500" />
                  Bước 1: Xác minh danh tính tự động
                </CardTitle>
                <CardDescription>
                  Tải lên ảnh CCCD và ảnh App Ngân hàng. Hệ thống sẽ tự động so sánh tên và trích xuất số tài khoản.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                
                {/* AI Error */}
                {aiError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-400 flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                    <div>{aiError}</div>
                  </div>
                )}

                {/* Scan status */}
                {aiScanAttempts > 0 && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Số lần quét: {aiScanAttempts}/{AI_MAX_ATTEMPTS}</span>
                    {aiScanCooldown > 0 && (
                      <span className="text-orange-400 flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Quét lại sau {aiScanCooldown}s
                      </span>
                    )}
                  </div>
                )}

                {/* AI Results */}
                {aiResult && (
                  <div className={`border rounded-xl p-5 space-y-4 ${
                    aiResult.is_valid_cccd && aiResult.is_valid_cccd_back && aiResult.is_valid_bank && aiResult.confidence >= 0.7
                      ? 'bg-green-500/5 border-green-500/30'
                      : aiResult.issues && aiResult.issues.length > 0
                      ? 'bg-red-500/5 border-red-500/30'
                      : 'bg-yellow-500/5 border-yellow-500/30'
                  }`}>
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-orange-500" />
                        Kết quả xác minh
                      </h4>
                      <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                        aiResult.confidence >= 0.7
                          ? 'bg-green-500/20 text-green-500'
                          : aiResult.confidence >= 0.5
                          ? 'bg-yellow-500/20 text-yellow-500'
                          : 'bg-red-500/20 text-red-500'
                      }`}>
                        Độ tin cậy: {Math.round(aiResult.confidence * 100)}%
                      </span>
                    </div>

                    {/* Cross-account duplicate warning */}
                    {aiResult.duplicate && (aiResult.duplicate.cccdDuplicate || aiResult.duplicate.bankDuplicate) && (
                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400 flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <div>
                          <strong>Cảnh báo trùng thông tin.</strong> {aiResult.duplicate.notes || 'CCCD hoặc số tài khoản này đã được đăng ký ở một tài khoản khác.'}
                          <div className="text-xs text-red-400/80 mt-1">Bạn vẫn có thể gửi hồ sơ, nhưng quản trị viên sẽ xem xét kỹ và có thể từ chối nếu phát hiện dùng chung giấy tờ.</div>
                        </div>
                      </div>
                    )}

                    {/* Pending Replacements Notice */}
                    {Object.values(pendingReplacements).some(Boolean) && (
                      <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 text-sm text-orange-400 flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <div>Vui lòng tải lên lại <strong>tất cả</strong> các ảnh không hợp lệ để hệ thống tự động quét lại.</div>
                      </div>
                    )}

                    {/* Issues */}
                    {aiResult.issues && aiResult.issues.length > 0 && (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 space-y-1">
                        {aiResult.issues.map((issue, i) => (
                          <p key={i} className="text-sm text-red-400 flex items-start gap-2">
                            <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                            {issue}
                          </p>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs mb-1">CCCD mặt trước</p>
                        <p className={`font-medium ${aiResult.is_valid_cccd ? 'text-green-500' : 'text-red-500'}`}>
                          {aiResult.is_valid_cccd ? '✅ Hợp lệ' : '❌ Cần tải lại'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs mb-1">CCCD mặt sau</p>
                        <p className={`font-medium ${aiResult.is_valid_cccd_back ? 'text-green-500' : 'text-red-500'}`}>
                          {aiResult.is_valid_cccd_back ? '✅ Hợp lệ' : '❌ Cần tải lại'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs mb-1">Tên trên CCCD</p>
                        <p className="font-medium">{aiResult.cccd_name || '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs mb-1">Tên ngân hàng</p>
                        <p className="font-medium">{aiResult.bank_account_name || '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs mb-1">Số TK</p>
                        <p className="font-mono font-medium">{aiResult.bank_account_number || '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs mb-1">Khớp tên đăng ký</p>
                        <p className={`font-semibold ${isSubmittedNameMatch ? 'text-green-500' : 'text-red-500'}`}>
                          {isSubmittedNameMatch ? '✅ Khớp sau chỉnh sửa' : '❌ Chưa khớp'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Full Name */}
                <div>
                  <Label htmlFor="fullName">Họ và tên (đúng với CCCD) *</Label>
                  <Input id="fullName" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Nguyễn Văn A" required />
                </div>

                {/* CCCD Front + Bank Screenshot (side by side - AI reads these two) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Ảnh CCCD mặt trước *</Label>
                    <div className={`mt-1 border-2 rounded-lg p-4 text-center transition-colors ${processingType === 'front' ? 'cursor-wait border-orange-500/50 bg-orange-500/5' : 'cursor-pointer'} ${aiResult ? (aiResult.is_valid_cccd ? 'border-green-500/50' : 'border-red-500/50 bg-red-500/5') : 'border-dashed hover:border-orange-500/50'}`}
                      onClick={() => { if (processingType !== 'front') document.getElementById('id-front')?.click(); }}>
                      {processingType === 'front' ? (
                        <div className="flex items-center justify-center gap-2 py-1">
                          <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                          <p className="text-sm text-orange-400">Đang xử lý ảnh...</p>
                        </div>
                      ) : idFrontFile ? (
                        <p className={`text-sm truncate ${aiResult && !aiResult.is_valid_cccd ? 'text-red-500' : 'text-green-400'}`}>{idFrontFile.name}</p>
                      ) : (
                        <>
                          <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                          <p className="text-xs text-muted-foreground mt-1">Nhấn để tải ảnh</p>
                        </>
                      )}
                      <input type="file" id="id-front" className="hidden" accept="image/*"
                        onChange={e => handleFileChange('front', e.target.files?.[0] || null)} />
                    </div>
                  </div>
                  <div>
                    <Label>Ảnh CCCD mặt sau *</Label>
                    <div className={`mt-1 border-2 rounded-lg p-4 text-center transition-colors ${processingType === 'back' ? 'cursor-wait border-orange-500/50 bg-orange-500/5' : 'cursor-pointer'} ${aiResult ? (aiResult.is_valid_cccd_back ? 'border-green-500/50' : 'border-red-500/50 bg-red-500/5') : 'border-dashed hover:border-orange-500/50'}`}
                      onClick={() => { if (processingType !== 'back') document.getElementById('id-back')?.click(); }}>
                      {processingType === 'back' ? (
                        <div className="flex items-center justify-center gap-2 py-1">
                          <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                          <p className="text-sm text-orange-400">Đang xử lý ảnh...</p>
                        </div>
                      ) : idBackFile ? (
                        <p className={`text-sm truncate ${aiResult && !aiResult.is_valid_cccd_back ? 'text-red-500' : 'text-green-400'}`}>{idBackFile.name}</p>
                      ) : (
                        <>
                          <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                          <p className="text-xs text-muted-foreground mt-1">Nhấn để tải ảnh</p>
                        </>
                      )}
                      <input type="file" id="id-back" className="hidden" accept="image/*"
                        onChange={e => handleFileChange('back', e.target.files?.[0] || null)} />
                    </div>
                  </div>
                </div>

                {/* Bank Screenshot */}
                <div>
                  <Label>Ảnh chụp mục "QR của tôi" trên App Ngân hàng *</Label>
                  <div className={`mt-1 border-2 rounded-lg p-4 text-center transition-colors ${processingType === 'bank' ? 'cursor-wait border-orange-500/50 bg-orange-500/5' : 'cursor-pointer'} ${aiResult ? (aiResult.is_valid_bank ? 'border-green-500/50' : 'border-red-500/50 bg-red-500/5') : 'border-dashed hover:border-orange-500/50'}`}
                    onClick={() => { if (processingType !== 'bank') document.getElementById('bank-screenshot')?.click(); }}>
                    {processingType === 'bank' ? (
                      <div className="flex items-center justify-center gap-2 py-1">
                        <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                        <p className="text-sm text-orange-400">Đang xử lý ảnh...</p>
                      </div>
                    ) : bankScreenshotFile ? (
                      <p className={`text-sm truncate ${aiResult && !aiResult.is_valid_bank ? 'text-red-500' : 'text-green-400'}`}>{bankScreenshotFile.name}</p>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                        <p className="text-xs text-muted-foreground mt-1">Screenshot phần Tên & Số TK</p>
                      </>
                    )}
                    <input type="file" id="bank-screenshot" className="hidden" accept="image/*"
                      onChange={e => handleFileChange('bank', e.target.files?.[0] || null)} />
                  </div>
                </div>

                {/* Bank Name */}
                <div>
                  <Label>Ngân hàng *</Label>
                  <Select value={bankName} onValueChange={setBankName}>
                    <SelectTrigger><SelectValue placeholder="Chọn ngân hàng..." /></SelectTrigger>
                    <SelectContent>
                      {BANKS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  type="button"
                  onClick={() => {
                    if (idFrontFile && idBackFile && bankScreenshotFile) {
                      handleAICheck(idFrontFile, idBackFile, bankScreenshotFile, fullName.trim());
                    }
                  }}
                  disabled={!canStartSystemScan}
                  variant="outline"
                  className="w-full border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                >
                  {isAIChecking ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Hệ thống đang quét
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Bắt đầu quét bằng hệ thống
                    </>
                  )}
                </Button>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="editableBankAccountName">Tên chủ tài khoản *</Label>
                    <Input
                      id="editableBankAccountName"
                      value={editableBankAccountName}
                      onChange={e => setEditableBankAccountName(e.target.value)}
                      placeholder="Tên chủ tài khoản sau khi kiểm tra"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Hệ thống của chúng tôi  gợi ý: {aiResult?.bank_account_name || 'Chưa có'}
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="editableBankAccountNumber">Số tài khoản *</Label>
                    <Input
                      id="editableBankAccountNumber"
                      value={editableBankAccountNumber}
                      onChange={e => setEditableBankAccountNumber(e.target.value.replace(/[^\d]/g, ''))}
                      placeholder="Số tài khoản sau khi kiểm tra"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                   Hệ thống gợi ý: {aiResult?.bank_account_number || 'Chưa có'}
                    </p>
                  </div>
                </div>

                {/* Next */}
                <Button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  disabled={
                    !aiResult || !fullName || !idFrontFile || !idBackFile || !bankScreenshotFile || !bankName ||
                    !editableBankAccountName || !editableBankAccountNumber ||
                    !aiResult.is_valid_cccd || !aiResult.is_valid_cccd_back || !aiResult.is_valid_bank ||
                    !isSubmittedNameMatch || aiResult.confidence < 0.7
                  }
                  className="w-full"
                  size="lg"
                >
                  Tiếp tục <ChevronRight className="h-4 w-4 ml-2" />
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
                  Bước 2: Số điện thoại liên hệ
                </CardTitle>
                <CardDescription>
                  Nhập số điện thoại Việt Nam để bưu tá liên hệ lấy thẻ khi có đơn hàng. Admin sẽ kiểm tra lại khi duyệt seller.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <Label htmlFor="phone">Số điện thoại *</Label>
                  <div className="mt-1">
                    <Input
                      id="phone"
                      type="tel"
                      value={phoneNumber}
                      onChange={e => handlePhoneChange(e.target.value)}
                      placeholder="0912 345 678"
                      maxLength={10}
                      required
                    />
                  </div>
                  {phoneNumber && !isPhoneValid && (
                    <p className="text-xs text-red-400 mt-1">Số điện thoại phải bắt đầu bằng 03, 05, 07, 08, 09 và gồm 10 chữ số</p>
                  )}
                  {phoneNumber && isPhoneValid && (
                    <p className="text-xs text-green-400 mt-1 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> Số điện thoại hợp lệ để liên hệ
                    </p>
                  )}
                </div>

                {/* Navigation */}
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setCurrentStep(1)} className="flex-1">
                    <ChevronLeft className="h-4 w-4 mr-2" /> Quay lại
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setCurrentStep(3)}
                    disabled={!isPhoneValid}
                    className="flex-1"
                    size="lg"
                  >
                    Tiếp tục <ChevronRight className="h-4 w-4 ml-2" />
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
                  Bước 3: Xác nhận thông tin
                </CardTitle>
                <CardDescription>
                  Kiểm tra lại toàn bộ thông tin trước khi gửi yêu cầu xác minh.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Summary */}
                <div className="space-y-4">
                  <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 space-y-3">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-orange-500" /> Thông tin danh tính
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">Họ tên</p>
                        <p className="font-medium">{fullName}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Độ tin cậy</p>
                        <p className={`font-semibold ${(aiResult?.confidence || 0) >= 0.7 ? 'text-green-500' : 'text-yellow-500'}`}>
                          {Math.round((aiResult?.confidence || 0) * 100)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Ngân hàng</p>
                        <p className="font-medium">{bankName}</p>
                      </div>
                      <div>
                      <p className="text-muted-foreground text-xs">Số tài khoản</p>
                      <p className="font-mono font-medium">{editableBankAccountNumber || '—'}</p>
                    </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Tên chủ tài khoản</p>
                        <p className="font-medium">{editableBankAccountName || '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Tên trùng khớp</p>
                        <p className={`font-semibold ${isSubmittedNameMatch ? 'text-green-500' : 'text-red-500'}`}>
                          {isSubmittedNameMatch ? '✅ Khớp' : '❌ Không khớp'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 space-y-3">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      <Phone className="h-4 w-4 text-orange-500" /> Liên hệ
                    </h4>
                    <div className="text-sm">
                      <p className="text-muted-foreground text-xs">Số điện thoại</p>
                      <p className="font-mono font-medium">{phoneNumber}</p>
                    </div>
                  </div>

                  <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4 space-y-3">
                    <h4 className="font-semibold text-sm">Ảnh đã tải lên</h4>
                    <div className="flex flex-wrap gap-2 text-xs text-green-400">
                      <span className="flex items-center gap-1"><CheckCircle className="h-3 w-3" /> CCCD trước</span>
                      <span className="flex items-center gap-1"><CheckCircle className="h-3 w-3" /> CCCD sau</span>
                      <span className="flex items-center gap-1"><CheckCircle className="h-3 w-3" /> App Ngân hàng</span>
                    </div>
                  </div>
                </div>

                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-400">
                  ⚠️ Sau khi gửi, hệ thống sẽ tiền duyệt hồ sơ ngay lập tức. Admin sẽ xác nhận lần cuối trong thời gian sớm nhất để bạn bắt đầu bán hàng.
                </div>

                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setCurrentStep(2)} className="flex-1">
                    <ChevronLeft className="h-4 w-4 mr-2" /> Quay lại
                  </Button>
                  <Button
                    type="button"
                    onClick={handleKYCSubmit}
                    disabled={isSubmitting || !isSubmittedNameMatch || !isPhoneValid || (aiResult?.confidence || 0) < 0.7}
                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold"
                    size="lg"
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                    {isSubmitting ? 'Đang gửi...' : 'Gửi yêu cầu xác minh'}
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
