
'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShieldCheck, ShieldAlert, Upload, Loader2, Package, Plus, Clock, CheckCircle, XCircle/*, Wallet*/ } from 'lucide-react';
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

  const [verification, setVerification] = useState<Verification | null>(null);
  const [isLoadingVerification, setIsLoadingVerification] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sellerOrders, setSellerOrders] = useState<SellerOrder[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);

  // KYC form state
  const [fullName, setFullName] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [idBackFile, setIdBackFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);

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

  const handleKYCSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fullName || !bankName || !bankAccountNumber || !bankAccountName || !idFrontFile || !idBackFile || !selfieFile) {
      toast({ variant: 'destructive', title: 'Vui lòng điền đầy đủ thông tin' });
      return;
    }

    setIsSubmitting(true);
    try {
      // Upload images
      const uploads = await Promise.all([
        uploadImageToCloudinary((() => { const fd = new FormData(); fd.append('file', idFrontFile!); return fd; })()),
        uploadImageToCloudinary((() => { const fd = new FormData(); fd.append('file', idBackFile!); return fd; })()),
        uploadImageToCloudinary((() => { const fd = new FormData(); fd.append('file', selfieFile!); return fd; })()),
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
          selfie_url: uploads[2].url,
          bank_name: bankName,
          bank_account_number: bankAccountNumber,
          bank_account_name: bankAccountName,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast({ title: '✅ Đã gửi yêu cầu xác minh!', description: 'Admin sẽ duyệt trong 24h.' });
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
              <h2 className="text-2xl font-bold text-yellow-400">Đang chờ duyệt</h2>
              <p className="text-muted-foreground">
                Yêu cầu xác minh của bạn đã được gửi và đang chờ Admin xem xét.
                Thường sẽ được duyệt trong vòng 24 giờ.
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

  // ── KYC FORM (Not yet submitted) ──
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
              Để bắt đầu bán thẻ, bạn cần xác minh danh tính và tài khoản ngân hàng.
            </p>
          </div>

          <Card className="border-orange-500/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-orange-500" />
                Xác minh người bán (KYC)
              </CardTitle>
              <CardDescription>
                Thông tin của bạn được bảo mật và chỉ dùng để xác thực danh tính.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleKYCSubmit} className="space-y-6">
                {/* Personal Info */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-lg border-b pb-2">Thông tin cá nhân</h3>
                  <div>
                    <Label htmlFor="fullName">Họ và tên (đúng với CCCD) *</Label>
                    <Input id="fullName" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Nguyễn Văn A" required />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>Ảnh CCCD mặt trước *</Label>
                      <div className="mt-1 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-orange-500/50 transition-colors"
                        onClick={() => document.getElementById('id-front')?.click()}>
                        {idFrontFile ? (
                          <p className="text-sm text-green-400">{idFrontFile.name}</p>
                        ) : (
                          <>
                            <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                            <p className="text-xs text-muted-foreground mt-1">Nhấn để tải ảnh</p>
                          </>
                        )}
                        <input type="file" id="id-front" className="hidden" accept="image/*"
                          onChange={e => setIdFrontFile(e.target.files?.[0] || null)} />
                      </div>
                    </div>
                    <div>
                      <Label>Ảnh CCCD mặt sau *</Label>
                      <div className="mt-1 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-orange-500/50 transition-colors"
                        onClick={() => document.getElementById('id-back')?.click()}>
                        {idBackFile ? (
                          <p className="text-sm text-green-400">{idBackFile.name}</p>
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

                  <div>
                    <Label>Ảnh selfie cầm CCCD *</Label>
                    <div className="mt-1 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-orange-500/50 transition-colors"
                      onClick={() => document.getElementById('selfie')?.click()}>
                      {selfieFile ? (
                        <p className="text-sm text-green-400">{selfieFile.name}</p>
                      ) : (
                        <>
                          <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                          <p className="text-xs text-muted-foreground mt-1">Chụp ảnh bạn cầm CCCD bên cạnh khuôn mặt</p>
                        </>
                      )}
                      <input type="file" id="selfie" className="hidden" accept="image/*"
                        onChange={e => setSelfieFile(e.target.files?.[0] || null)} />
                    </div>
                  </div>
                </div>

                {/* Bank Info */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-lg border-b pb-2">Thông tin ngân hàng</h3>
                  <div>
                    <Label>Ngân hàng *</Label>
                    <Select value={bankName} onValueChange={setBankName}>
                      <SelectTrigger><SelectValue placeholder="Chọn ngân hàng..." /></SelectTrigger>
                      <SelectContent>
                        {BANKS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="bankAccount">Số tài khoản *</Label>
                    <Input id="bankAccount" value={bankAccountNumber} onChange={e => setBankAccountNumber(e.target.value)} placeholder="0123456789" required />
                  </div>
                  <div>
                    <Label htmlFor="bankAccountName">Tên chủ tài khoản (phải khớp với CCCD) *</Label>
                    <Input id="bankAccountName" value={bankAccountName} onChange={e => setBankAccountName(e.target.value)} placeholder="NGUYEN VAN A" required />
                  </div>
                </div>

                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-400">
                  ⚠️ Tên chủ tài khoản ngân hàng <strong>bắt buộc phải trùng khớp</strong> với tên trên CCCD.
                  Nếu không khớp, yêu cầu sẽ bị từ chối.
                </div>

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold"
                  size="lg"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                  {isSubmitting ? 'Đang gửi...' : 'Gửi yêu cầu xác minh'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
