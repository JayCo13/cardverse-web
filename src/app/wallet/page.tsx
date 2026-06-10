
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Wallet, ArrowUpCircle, ArrowDownCircle, Clock, CreditCard, Loader2, ExternalLink, Banknote, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { useToast } from '@/hooks/use-toast';
import { useLocalization } from '@/context/localization-context';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type WalletData = {
  id: string;
  available_balance: number;
  held_balance: number;
  total_deposited: number;
  total_withdrawn: number;
};

type WalletTransaction = {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  description: string | null;
  created_at: string;
};

const PRESET_AMOUNTS = [50000, 100000, 200000, 500000, 1000000, 2000000];
const WITHDRAW_FEE_RATE = 0.05;
const MIN_WITHDRAW = 50000;

type SellerBank = {
  bank_name: string;
  bank_account_number: string;
  bank_account_name: string;
};

const TX_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  deposit: { label: 'Nạp tiền', color: 'text-green-400' },
  marketplace_buy: { label: 'Mua thẻ', color: 'text-red-400' },
  marketplace_sale: { label: 'Bán thẻ', color: 'text-green-400' },
  escrow_hold: { label: 'Tạm giữ', color: 'text-yellow-400' },
  escrow_release: { label: 'Hoàn trả', color: 'text-green-400' },
  scan_purchase: { label: 'Scan', color: 'text-blue-400' },
  vip_subscription: { label: 'VIP', color: 'text-purple-400' },
  withdrawal: { label: 'Rút tiền', color: 'text-red-400' },
  platform_fee: { label: 'Phí sàn', color: 'text-orange-400' },
  refund: { label: 'Hoàn tiền', color: 'text-green-400' },
};

export default function WalletPage() {
  const { t } = useLocalization();
  const { user, isLoading: authLoading } = useAuth();
  const { setOpen } = useAuthModal();
  const { toast } = useToast();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [depositAmount, setDepositAmount] = useState<number>(100000);
  const [customAmount, setCustomAmount] = useState('');
  const [isDepositing, setIsDepositing] = useState(false);

  // Seller / withdraw state — only approved sellers can withdraw.
  const [isApprovedSeller, setIsApprovedSeller] = useState(false);
  const [sellerBank, setSellerBank] = useState<SellerBank | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);

  const fetchWallet = useCallback(async () => {
    try {
      const res = await fetch('/api/wallet');
      const data = await res.json();
      if (data.wallet) {
        setWallet(data.wallet);
        setTransactions(data.transactions || []);
      }
    } catch (err) {
      console.error('Failed to fetch wallet:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchSellerStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/seller/verify');
      const data = await res.json();
      const v = data.verification;
      if (v?.status === 'approved') {
        setIsApprovedSeller(true);
        setSellerBank({
          bank_name: v.bank_name,
          bank_account_number: v.bank_account_number,
          bank_account_name: v.bank_account_name,
        });
      } else {
        setIsApprovedSeller(false);
        setSellerBank(null);
      }
    } catch (err) {
      console.error('Failed to fetch seller status:', err);
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchWallet();
      fetchSellerStatus();
    } else {
      setIsLoading(false);
    }
  }, [user, fetchWallet, fetchSellerStatus]);

  useEffect(() => {
    if (!authLoading && !user) {
      setOpen(true);
    }
  }, [authLoading, user, setOpen]);

  const handleDeposit = async () => {
    const amount = customAmount ? parseInt(customAmount) : depositAmount;
    if (!amount || amount < 10000) {
      toast({ variant: 'destructive', title: 'Số tiền tối thiểu là 10,000đ' });
      return;
    }
    setIsDepositing(true);
    try {
      const res = await fetch('/api/wallet/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (data.checkoutUrl) {
        window.open(data.checkoutUrl, '_blank');
      } else {
        throw new Error(data.error || 'Failed to create deposit');
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Lỗi', description: err.message });
    } finally {
      setIsDepositing(false);
    }
  };

  const formatVND = (amount: number) => {
    return new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
  };

  const available = wallet?.available_balance || 0;
  const withdrawNum = parseInt(withdrawAmount.replace(/[^\d]/g, ''), 10) || 0;
  const withdrawFee = Math.round(withdrawNum * WITHDRAW_FEE_RATE);
  const withdrawNet = withdrawNum - withdrawFee;
  const withdrawValid = withdrawNum >= MIN_WITHDRAW && withdrawNum <= available;

  const submitWithdraw = async () => {
    setShowWithdrawConfirm(false);
    setIsWithdrawing(true);
    try {
      const res = await fetch('/api/wallet/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: withdrawNum }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thể tạo yêu cầu rút tiền');
      toast({
        title: '✅ Đã gửi yêu cầu rút tiền',
        description: `Bạn sẽ nhận ${formatVND(data.amount_net)} (sau phí ${formatVND(data.fee)}). Admin sẽ chuyển khoản và xác nhận.`,
      });
      setWithdrawAmount('');
      fetchWallet();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Lỗi', description: err.message });
    } finally {
      setIsWithdrawing(false);
    }
  };

  const maskAccount = (acc: string) => (acc.length > 4 ? `****${acc.slice(-4)}` : acc);

  if (authLoading || isLoading) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header />
        <main className="flex-1 container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto space-y-6">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header />
        <main className="flex-1 container mx-auto px-4 py-8 flex flex-col items-center justify-center">
          <Wallet className="h-16 w-16 text-muted-foreground mb-4" />
          <h2 className="text-2xl font-semibold mb-2">Đăng nhập để sử dụng Ví</h2>
          <Button onClick={() => setOpen(true)}>Đăng nhập</Button>
        </main>
        <Footer />
      </div>
    );
  }

  // Buyer side — anyone can deposit.
  const depositCard = (
    <Card className="border-green-500/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-green-500" />
          Nạp tiền vào ví
        </CardTitle>
        <CardDescription>Chọn số tiền hoặc nhập số tiền tùy chỉnh</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {PRESET_AMOUNTS.map((amount) => (
            <Button
              key={amount}
              variant={depositAmount === amount && !customAmount ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setDepositAmount(amount);
                setCustomAmount('');
              }}
              className="text-xs"
            >
              {formatVND(amount)}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            type="number"
            placeholder="Nhập số tiền khác (VND)..."
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            min={10000}
            max={50000000}
          />
          <Button
            onClick={handleDeposit}
            disabled={isDepositing}
            className="bg-green-600 hover:bg-green-700 text-white whitespace-nowrap px-6"
          >
            {isDepositing ? <Loader2 className="h-4 w-4 animate-spin" /> : (
              <>
                <ArrowUpCircle className="h-4 w-4 mr-2" />
                Nạp tiền
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  // Seller side — only approved sellers can withdraw.
  const withdrawCard = (
    <Card className="border-orange-500/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Banknote className="h-5 w-5 text-orange-500" />
          Rút tiền về ngân hàng
        </CardTitle>
        <CardDescription>Dành cho người bán đã được duyệt KYC</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Fee warning */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-amber-200">
              Mỗi lần rút bị trừ <span className="font-semibold">5% phí nền tảng</span> (trừ thẳng vào số tiền rút).
              Số tối thiểu mỗi lần rút là {formatVND(MIN_WITHDRAW)}.
            </p>
          </div>
        </div>

        {/* Destination bank (locked to KYC account) */}
        {sellerBank && (
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <ShieldCheck className="h-4 w-4 text-green-500" />
              Tài khoản nhận (theo KYC — không thể thay đổi)
            </div>
            <p className="font-medium">{sellerBank.bank_name}</p>
            <p className="text-sm">{maskAccount(sellerBank.bank_account_number)} · {sellerBank.bank_account_name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Tiền chỉ được rút về đúng tài khoản ngân hàng bạn đã đăng ký KYC.
            </p>
          </div>
        )}

        {/* Amount input + live fee breakdown */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Số dư có thể rút</span>
            <span className="font-semibold text-orange-500">{formatVND(available)}</span>
          </div>
          <div className="flex gap-2">
            <Input
              type="text"
              inputMode="numeric"
              placeholder="Nhập số tiền muốn rút (VND)..."
              value={withdrawAmount ? new Intl.NumberFormat('vi-VN').format(withdrawNum) : ''}
              onChange={(e) => setWithdrawAmount(e.target.value)}
            />
            <Button
              onClick={() => setShowWithdrawConfirm(true)}
              disabled={!withdrawValid || isWithdrawing}
              className="bg-orange-500 hover:bg-orange-600 text-white whitespace-nowrap px-6"
            >
              {isWithdrawing ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <>
                  <ArrowDownCircle className="h-4 w-4 mr-2" />
                  Rút tiền
                </>
              )}
            </Button>
          </div>
          {withdrawNum > 0 && (
            <div className="rounded-lg border bg-accent/30 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Số tiền rút</span><span>{formatVND(withdrawNum)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Phí 5%</span><span className="text-red-400">- {formatVND(withdrawFee)}</span></div>
              <div className="flex justify-between border-t border-border/50 pt-1 font-semibold"><span>Thực nhận</span><span className="text-green-400">{formatVND(withdrawNet)}</span></div>
              {withdrawNum > available && (
                <p className="text-xs text-red-400 pt-1">Vượt quá số dư khả dụng.</p>
              )}
              {withdrawNum > 0 && withdrawNum < MIN_WITHDRAW && (
                <p className="text-xs text-red-400 pt-1">Tối thiểu {formatVND(MIN_WITHDRAW)}.</p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Wallet Balance Card */}
          <Card className="bg-gradient-to-br from-orange-500/10 via-background to-purple-500/10 border-orange-500/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Wallet className="h-6 w-6 text-orange-500" />
                Ví Cardverse
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <p className="text-sm text-muted-foreground">Số dư khả dụng</p>
                  <p className="text-3xl font-bold text-orange-500">
                    {formatVND(wallet?.available_balance || 0)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Đang tạm giữ</p>
                  <p className="text-xl font-semibold text-yellow-500">
                    {formatVND(wallet?.held_balance || 0)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tổng đã nạp</p>
                  <p className="text-xl font-semibold text-green-500">
                    {formatVND(wallet?.total_deposited || 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Buyer / Seller money actions. Approved sellers get tabs (Người mua /
              Người bán); a buyer who isn't a seller only sees deposit. */}
          {isApprovedSeller ? (
            <Tabs defaultValue="buyer" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="buyer">👤 Người mua</TabsTrigger>
                <TabsTrigger value="seller">🏪 Người bán</TabsTrigger>
              </TabsList>
              <TabsContent value="buyer" className="mt-4">{depositCard}</TabsContent>
              <TabsContent value="seller" className="mt-4">{withdrawCard}</TabsContent>
            </Tabs>
          ) : (
            depositCard
          )}

          {/* Transactions History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-blue-500" />
                Lịch sử giao dịch
              </CardTitle>
            </CardHeader>
            <CardContent>
              {transactions.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Chưa có giao dịch nào</p>
              ) : (
                <div className="space-y-3">
                  {transactions.map((tx) => {
                    const typeInfo = TX_TYPE_LABELS[tx.type] || { label: tx.type, color: 'text-muted-foreground' };
                    const isPositive = tx.amount > 0;
                    return (
                      <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                        <div className="flex items-center gap-3">
                          {isPositive ? (
                            <ArrowUpCircle className="h-5 w-5 text-green-500" />
                          ) : (
                            <ArrowDownCircle className="h-5 w-5 text-red-500" />
                          )}
                          <div>
                            <p className={`font-medium text-sm ${typeInfo.color}`}>{typeInfo.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {tx.description || '—'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold text-sm ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                            {isPositive ? '+' : ''}{formatVND(tx.amount)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(tx.created_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
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

      {/* Withdraw confirmation */}
      <AlertDialog open={showWithdrawConfirm} onOpenChange={setShowWithdrawConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận yêu cầu rút tiền</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>Sau khi gửi, ví của bạn sẽ bị trừ ngay số tiền rút. Admin sẽ chuyển khoản và xác nhận.</p>
                <div className="rounded-lg border bg-accent/40 p-3 text-foreground text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Số tiền rút</span><span>{formatVND(withdrawNum)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Phí 5%</span><span className="text-red-400">- {formatVND(withdrawFee)}</span></div>
                  <div className="flex justify-between border-t border-border/50 pt-1 font-semibold"><span>Thực nhận</span><span className="text-green-400">{formatVND(withdrawNet)}</span></div>
                  {sellerBank && (
                    <p className="pt-2 text-xs text-muted-foreground">
                      Về: {sellerBank.bank_name} · {maskAccount(sellerBank.bank_account_number)} · {sellerBank.bank_account_name}
                    </p>
                  )}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWithdrawing}>Hủy</AlertDialogCancel>
            <AlertDialogAction onClick={submitWithdraw} disabled={isWithdrawing || !withdrawValid}>
              Xác nhận rút
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Footer />
    </div>
  );
}
