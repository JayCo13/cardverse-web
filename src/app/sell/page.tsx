
'use client';

import { useState, useEffect, useRef } from 'react';
import { auth, RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from '@/lib/firebase';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShieldCheck, ShieldAlert, Upload, Loader2, Package, Plus, Clock, CheckCircle, XCircle, Phone, FileCheck, ChevronRight, ChevronLeft, Sparkles, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { useToast } from '@/hooks/use-toast';
import { useLocalization } from '@/context/localization-context';
import { Skeleton } from '@/components/ui/skeleton';
import { uploadImageToCloudinary } from '@/lib/cloudinary';
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

type AIResult = {
  cccd_name: string;
  cccd_id_number: string | null;
  cccd_dob: string | null;
  is_valid_cccd: boolean;
  bank_account_name: string;
  bank_account_number: string;
  bank_name_detected: string | null;
  is_valid_bank: boolean;
  is_name_match: boolean;
  confidence: number;
};

const BANKS = [
  'Vietcombank', 'Techcombank', 'MB Bank', 'BIDV', 'Agribank',
  'VPBank', 'ACB', 'Sacombank', 'TPBank', 'VIB',
  'SHB', 'HDBank', 'OCB', 'MSB', 'SeABank', 'Khác',
];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export default function SellPage() {
  const { t } = useLocalization();
  const { user, isLoading: authLoading } = useAuth();
  const { setOpen } = useAuthModal();
  const { toast } = useToast();

  const [verification, setVerification] = useState<Verification | null>(null);
  const [isLoadingVerification, setIsLoadingVerification] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sellerOrders, setSellerOrders] = useState<SellerOrder[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);

  // Wizard step
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1: AI Verification
  const [fullName, setFullName] = useState('');
  const [bankName, setBankName] = useState('');
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [idBackFile, setIdBackFile] = useState<File | null>(null);

  const [bankScreenshotFile, setBankScreenshotFile] = useState<File | null>(null);
  const [isAIChecking, setIsAIChecking] = useState(false);
  const [aiResult, setAIResult] = useState<AIResult | null>(null);
  const [aiError, setAIError] = useState<string | null>(null);

  // Step 2: Phone + OTP
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const confirmationResultRef = useRef<ConfirmationResult | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    if (!authLoading && !user) setOpen(true);
  }, [authLoading, user, setOpen]);

  useEffect(() => {
    if (user) {
      fetchVerification();
    }
  }, [user]);

  const fetchVerification = async () => {
    try {
      const res = await fetch('/api/seller/verify');
      const data = await res.json();
      setVerification(data.verification);

      if (data.verification?.status === 'approved') {
        fetchSellerOrders();
      }
    } catch (err) {
      console.error('Failed to fetch verification:', err);
    } finally {
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

  // Convert file to compressed base64 (resize + JPEG quality reduction)
  const fileToBase64 = (file: File, maxWidth = 800, quality = 0.7): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl.split(',')[1]);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  // Step 1: Run AI verification
  const handleAICheck = async (cccdFile: File, bankFile: File) => {
    setIsAIChecking(true);
    setAIError(null);
    setAIResult(null);

    try {
      const [cccdBase64, bankBase64] = await Promise.all([
        fileToBase64(cccdFile),
        fileToBase64(bankFile),
      ]);

      const response = await fetch('/api/seller/ai-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cccd_image: cccdBase64,
          bank_image: bankBase64,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setAIError(data.error || 'AI kiểm tra thất bại. Vui lòng thử lại.');
        return;
      }

      setAIResult(data as AIResult);

      if (data.is_name_match && data.confidence >= 0.7) {
        toast({ title: '✅ AI xác minh thành công!', description: 'Tên trên CCCD và Ngân hàng trùng khớp.' });
      } else {
        toast({ variant: 'destructive', title: '⚠️ Cần kiểm tra lại', description: 'Tên trên CCCD và Ngân hàng không khớp hoặc ảnh không rõ.' });
      }
    } catch (err: any) {
      setAIError(err.message || 'Lỗi kết nối AI');
    } finally {
      setIsAIChecking(false);
    }
  };

  // Auto-trigger AI check when both CCCD front and Bank screenshot are uploaded
  useEffect(() => {
    if (idFrontFile && bankScreenshotFile && !aiResult && !isAIChecking) {
      handleAICheck(idFrontFile, bankScreenshotFile);
    }
  }, [idFrontFile, bankScreenshotFile]);

  // Cooldown timer for OTP resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Send OTP via Firebase Phone Auth
  const handleSendOTP = async () => {
    if (!isPhoneValid) return;
    setOtpLoading(true);
    setOtpError(null);
    try {
      // Clear previous reCAPTCHA before creating new one
      if (recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current.clear();
        recaptchaVerifierRef.current = null;
      }
      // Reset the container
      const container = document.getElementById('recaptcha-container');
      if (container) container.innerHTML = '';

      // Initialize fresh reCAPTCHA verifier (invisible)
      recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
      });

      // Format: 0912345678 → +84912345678
      const internationalPhone = '+84' + phoneNumber.substring(1);
      const result = await signInWithPhoneNumber(auth, internationalPhone, recaptchaVerifierRef.current);
      confirmationResultRef.current = result;
      setOtpSent(true);
      setCooldown(60);
      toast({ title: '📱 Đã gửi mã OTP', description: `Mã xác minh đã gửi tới ${phoneNumber}` });
    } catch (err: any) {
      console.error('Firebase OTP error:', err);
      // Reset reCAPTCHA on error
      if (recaptchaVerifierRef.current) {
        try { recaptchaVerifierRef.current.clear(); } catch {}
      }
      recaptchaVerifierRef.current = null;
      const container = document.getElementById('recaptcha-container');
      if (container) container.innerHTML = '';
      if (err.code === 'auth/too-many-requests') {
        setOtpError('Quá nhiều yêu cầu. Vui lòng đợi vài phút rồi thử lại.');
      } else if (err.code === 'auth/invalid-phone-number') {
        setOtpError('Số điện thoại không hợp lệ.');
      } else {
        setOtpError(err.message || 'Không thể gửi OTP. Vui lòng thử lại.');
      }
    } finally {
      setOtpLoading(false);
    }
  };

  // Verify OTP via Firebase
  const handleVerifyOTP = async () => {
    if (otpCode.length !== 6 || !confirmationResultRef.current) return;
    setOtpLoading(true);
    setOtpError(null);
    try {
      await confirmationResultRef.current.confirm(otpCode);
      setOtpVerified(true);
      toast({ title: '✅ Xác minh thành công', description: 'Số điện thoại đã được xác minh!' });
    } catch (err: any) {
      if (err.code === 'auth/invalid-verification-code') {
        setOtpError('Mã OTP không đúng. Vui lòng kiểm tra lại.');
      } else if (err.code === 'auth/code-expired') {
        setOtpError('Mã OTP đã hết hạn. Vui lòng gửi lại.');
      } else {
        setOtpError(err.message || 'Xác minh thất bại.');
      }
    } finally {
      setOtpLoading(false);
    }
  };

  // Reset OTP state when phone number changes
  const handlePhoneChange = (value: string) => {
    const cleaned = value.replace(/[^0-9]/g, '');
    setPhoneNumber(cleaned);
    if (otpSent || otpVerified) {
      setOtpSent(false);
      setOtpVerified(false);
      setOtpCode('');
      setOtpError(null);
      confirmationResultRef.current = null;
    }
  };

  // Final submit
  const handleKYCSubmit = async () => {
    if (!fullName || !bankName || !idFrontFile || !idBackFile || !bankScreenshotFile || !phoneNumber) {
      toast({ variant: 'destructive', title: 'Vui lòng điền đầy đủ thông tin ở tất cả các bước' });
      return;
    }

    if (!aiResult) {
      toast({ variant: 'destructive', title: 'Vui lòng chạy kiểm tra AI ở Bước 1 trước' });
      return;
    }

    setIsSubmitting(true);
    try {
      // Upload all images in parallel
      const uploads = await Promise.all([
        uploadImageToCloudinary((() => { const fd = new FormData(); fd.append('file', idFrontFile!); return fd; })()),
        uploadImageToCloudinary((() => { const fd = new FormData(); fd.append('file', idBackFile!); return fd; })()),
        uploadImageToCloudinary((() => { const fd = new FormData(); fd.append('file', bankScreenshotFile!); return fd; })()),
      ]);

      if (uploads.some(u => !u.success)) {
        throw new Error('Upload ảnh thất bại. Vui lòng thử lại.');
      }

      const res = await fetch('/api/seller/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName,
          id_card_front_url: uploads[0].url,
          id_card_back_url: uploads[1].url,
          bank_screenshot_url: uploads[2].url,
          bank_name: bankName,
          bank_account_number: aiResult.bank_account_number,
          bank_account_name: aiResult.bank_account_name,
          phone_number: phoneNumber,
          ai_cccd_name: aiResult.cccd_name,
          ai_bank_name: aiResult.bank_account_name,
          ai_bank_number: aiResult.bank_account_number,
          ai_confidence: aiResult.confidence,
          ai_name_match: aiResult.is_name_match,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast({ title: '✅ Đã gửi yêu cầu xác minh!', description: 'AI đã tiền duyệt hồ sơ. Admin sẽ xác nhận lần cuối trong vài giờ.' });
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
                Hồ sơ của bạn đã được AI tiền duyệt thành công.
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
    { number: 1, title: 'Xác minh danh tính (AI)', icon: <Sparkles className="h-4 w-4" /> },
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
                  Bước 1: Xác minh danh tính bằng AI
                </CardTitle>
                <CardDescription>
                  Tải lên ảnh CCCD và ảnh App Ngân hàng. AI sẽ tự động so sánh tên và trích xuất số tài khoản.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Full Name */}
                <div>
                  <Label htmlFor="fullName">Họ và tên (đúng với CCCD) *</Label>
                  <Input id="fullName" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Nguyễn Văn A" required />
                </div>

                {/* CCCD Front + Bank Screenshot (side by side - AI reads these two) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Ảnh CCCD mặt trước *</Label>
                    <div className="mt-1 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-orange-500/50 transition-colors"
                      onClick={() => document.getElementById('id-front')?.click()}>
                      {idFrontFile ? (
                        <p className="text-sm text-green-400 truncate">{idFrontFile.name}</p>
                      ) : (
                        <>
                          <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                          <p className="text-xs text-muted-foreground mt-1">Nhấn để tải ảnh</p>
                        </>
                      )}
                      <input type="file" id="id-front" className="hidden" accept="image/*"
                        onChange={e => { setIdFrontFile(e.target.files?.[0] || null); setAIResult(null); }} />
                    </div>
                  </div>
                  <div>
                    <Label>Ảnh CCCD mặt sau *</Label>
                    <div className="mt-1 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-orange-500/50 transition-colors"
                      onClick={() => document.getElementById('id-back')?.click()}>
                      {idBackFile ? (
                        <p className="text-sm text-green-400 truncate">{idBackFile.name}</p>
                      ) : (
                        <>
                          <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                          <p className="text-xs text-muted-foreground mt-1">Nhấn để tải ảnh</p>
                        </>
                      )}
                      <input type="file" id="id-back" className="hidden" accept="image/*"
                        onChange={e => setIdBackFile(e.target.files?.[0] || null)} />
                    </div>
                  </div>
                </div>

                {/* AI Loading State */}
                {isAIChecking && (
                  <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4 flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
                    <div>
                      <p className="text-sm font-medium text-purple-400">AI đang phân tích ảnh...</p>
                      <p className="text-xs text-muted-foreground">Đang đọc CCCD và đối chiếu với ngân hàng</p>
                    </div>
                  </div>
                )}

                {/* AI Error */}
                {aiError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-400 flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                    <div>{aiError}</div>
                  </div>
                )}

                {/* AI Results */}
                {aiResult && (
                  <div className={`border rounded-xl p-5 space-y-4 ${
                    aiResult.is_name_match && aiResult.confidence >= 0.7
                      ? 'bg-green-500/5 border-green-500/30'
                      : 'bg-yellow-500/5 border-yellow-500/30'
                  }`}>
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-orange-500" />
                        Kết quả AI
                      </h4>
                      <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                        aiResult.confidence >= 0.7
                          ? 'bg-green-500/20 text-green-500'
                          : aiResult.confidence >= 0.5
                          ? 'bg-yellow-500/20 text-yellow-500'
                          : 'bg-red-500/20 text-red-500'
                      }`}>
                        Confidence: {Math.round(aiResult.confidence * 100)}%
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs mb-1">Tên trên CCCD</p>
                        <p className="font-medium">{aiResult.cccd_name || '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs mb-1">Tên trên Ngân hàng</p>
                        <p className="font-medium">{aiResult.bank_account_name || '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs mb-1">Số tài khoản (AI đọc)</p>
                        <p className="font-mono font-medium">{aiResult.bank_account_number || '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs mb-1">Trùng khớp tên</p>
                        <p className={`font-semibold ${aiResult.is_name_match ? 'text-green-500' : 'text-red-500'}`}>
                          {aiResult.is_name_match ? '✅ Khớp' : '❌ Không khớp'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Bank Screenshot */}
                <div>
                  <Label>Ảnh chụp màn hình App Ngân hàng *</Label>
                  <div className="mt-1 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-orange-500/50 transition-colors"
                    onClick={() => document.getElementById('bank-screenshot')?.click()}>
                    {bankScreenshotFile ? (
                      <p className="text-sm text-green-400 truncate">{bankScreenshotFile.name}</p>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                        <p className="text-xs text-muted-foreground mt-1">Screenshot phần Tên & Số TK</p>
                      </>
                    )}
                    <input type="file" id="bank-screenshot" className="hidden" accept="image/*"
                      onChange={e => { setBankScreenshotFile(e.target.files?.[0] || null); setAIResult(null); }} />
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

                {/* Next */}
                <Button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  disabled={!aiResult || !fullName || !idFrontFile || !idBackFile || !bankScreenshotFile || !bankName}
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
                  Bước 2: Xác minh số điện thoại
                </CardTitle>
                <CardDescription>
                  Số điện thoại để bưu tá liên hệ lấy thẻ khi có đơn hàng. Bạn sẽ nhận mã OTP qua SMS.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Phone Input + Send OTP */}
                <div>
                  <Label htmlFor="phone">Số điện thoại *</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      id="phone"
                      type="tel"
                      value={phoneNumber}
                      onChange={e => handlePhoneChange(e.target.value)}
                      placeholder="0912 345 678"
                      maxLength={10}
                      disabled={otpVerified}
                      className={otpVerified ? 'border-green-500/50 bg-green-500/5' : ''}
                      required
                    />
                    {!otpVerified && (
                      <Button
                        type="button"
                        onClick={handleSendOTP}
                        disabled={!isPhoneValid || otpLoading || cooldown > 0}
                        variant="outline"
                        className="shrink-0 min-w-[120px]"
                      >
                        {otpLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : cooldown > 0 ? (
                          `${cooldown}s`
                        ) : otpSent ? (
                          'Gửi lại'
                        ) : (
                          'Gửi mã OTP'
                        )}
                      </Button>
                    )}
                  </div>
                  {phoneNumber && !isPhoneValid && (
                    <p className="text-xs text-red-400 mt-1">Số điện thoại phải bắt đầu bằng 03, 05, 07, 08, 09 và gồm 10 chữ số</p>
                  )}
                  {otpVerified && (
                    <p className="text-xs text-green-400 mt-1 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> Số điện thoại đã xác minh
                    </p>
                  )}
                </div>

                {/* OTP Input */}
                {otpSent && !otpVerified && (
                  <div className="space-y-3">
                    <Label htmlFor="otp">Nhập mã OTP (6 chữ số)</Label>
                    <div className="flex gap-2">
                      <Input
                        id="otp"
                        type="text"
                        inputMode="numeric"
                        value={otpCode}
                        onChange={e => setOtpCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                        placeholder="000000"
                        maxLength={6}
                        className="text-center text-2xl font-mono tracking-[0.5em] max-w-[200px]"
                      />
                      <Button
                        type="button"
                        onClick={handleVerifyOTP}
                        disabled={otpCode.length !== 6 || otpLoading}
                        className="bg-gradient-to-r from-green-500 to-emerald-600 text-white"
                      >
                        {otpLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          'Xác minh'
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Mã OTP đã gửi tới <span className="font-mono font-medium">{phoneNumber}</span>. Có hiệu lực trong 5 phút.
                    </p>
                  </div>
                )}

                {/* OTP Error */}
                {otpError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>{otpError}</div>
                  </div>
                )}

                {/* Firebase reCAPTCHA (invisible) */}
                <div id="recaptcha-container"></div>

                {/* Navigation */}
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setCurrentStep(1)} className="flex-1">
                    <ChevronLeft className="h-4 w-4 mr-2" /> Quay lại
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setCurrentStep(3)}
                    disabled={!otpVerified}
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
                        <p className="text-muted-foreground text-xs">AI Confidence</p>
                        <p className={`font-semibold ${(aiResult?.confidence || 0) >= 0.7 ? 'text-green-500' : 'text-yellow-500'}`}>
                          {Math.round((aiResult?.confidence || 0) * 100)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Ngân hàng</p>
                        <p className="font-medium">{bankName}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Số tài khoản (AI đọc)</p>
                        <p className="font-mono font-medium">{aiResult?.bank_account_number || '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Tên chủ TK (AI đọc)</p>
                        <p className="font-medium">{aiResult?.bank_account_name || '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Tên trùng khớp</p>
                        <p className={`font-semibold ${aiResult?.is_name_match ? 'text-green-500' : 'text-red-500'}`}>
                          {aiResult?.is_name_match ? '✅ Khớp' : '❌ Không khớp'}
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
                  ⚠️ Sau khi gửi, AI sẽ tiền duyệt hồ sơ ngay lập tức. Admin sẽ xác nhận lần cuối trong thời gian sớm nhất để bạn bắt đầu bán hàng.
                </div>

                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setCurrentStep(2)} className="flex-1">
                    <ChevronLeft className="h-4 w-4 mr-2" /> Quay lại
                  </Button>
                  <Button
                    type="button"
                    onClick={handleKYCSubmit}
                    disabled={isSubmitting}
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
