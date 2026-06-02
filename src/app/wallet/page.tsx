
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Wallet, ArrowUpCircle, ArrowDownCircle, Clock, CreditCard, Loader2, ExternalLink } from 'lucide-react';
import { useAuth } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { useToast } from '@/hooks/use-toast';
import { useLocalization } from '@/context/localization-context';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';

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

  useEffect(() => {
    if (user) fetchWallet();
    else setIsLoading(false);
  }, [user, fetchWallet]);

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

          {/* Deposit Section */}
          <Card>
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
      <Footer />
    </div>
  );
}
