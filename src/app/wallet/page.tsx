
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

export default function WalletPage() {
  const { t, locale } = useLocalization();
  const { user, isLoading: authLoading } = useAuth();
  const { setOpen } = useAuthModal();
  const { toast } = useToast();
  const copy = locale === 'vi-VN'
    ? {
      txLabels: {
        deposit: 'Nạp tiền',
        marketplace_buy: 'Mua thẻ',
        marketplace_sale: 'Bán thẻ',
        escrow_hold: 'Tạm giữ',
        escrow_release: 'Hoàn trả',
        scan_purchase: 'Scan',
        vip_subscription: 'VIP',
        withdrawal: 'Rút tiền',
        platform_fee: 'Phí sàn',
        refund: 'Hoàn tiền',
      },
      minAmount: 'Số tiền tối thiểu là 10,000đ',
      failedDeposit: 'Không thể tạo lệnh nạp tiền',
      error: 'Lỗi',
      loginTitle: 'Đăng nhập để sử dụng Ví',
      loginButton: 'Đăng nhập',
      depositTitle: 'Nạp tiền vào ví',
      depositDesc: 'Chọn số tiền hoặc nhập số tiền tùy chỉnh',
      customAmount: 'Nhập số tiền khác (VND)...',
      deposit: 'Nạp tiền',
      withdrawTitle: 'Rút tiền về ngân hàng',
      withdrawDesc: 'Dành cho người bán đã được duyệt KYC',
      feeWarning: 'Mỗi lần rút bị trừ 5% phí nền tảng (trừ thẳng vào số tiền rút). Số tối thiểu mỗi lần rút là {amount}.',
      bankAccount: 'Tài khoản nhận (theo KYC — không thể thay đổi)',
      bankAccountHint: 'Tiền chỉ được rút về đúng tài khoản ngân hàng bạn đã đăng ký KYC.',
      withdrawableBalance: 'Số dư có thể rút',
      withdrawPlaceholder: 'Nhập số tiền muốn rút (VND)...',
      withdraw: 'Rút tiền',
      withdrawAmount: 'Số tiền rút',
      fee5: 'Phí 5%',
      netAmount: 'Thực nhận',
      exceededBalance: 'Vượt quá số dư khả dụng.',
      minWithdraw: 'Tối thiểu {amount}.',
      walletTitle: 'Ví CardVerse',
      availableBalance: 'Số dư khả dụng',
      heldBalance: 'Đang tạm giữ',
      totalDeposited: 'Tổng đã nạp',
      buyerTab: '👤 Người mua',
      sellerTab: '🏪 Người bán',
      historyTitle: 'Lịch sử giao dịch',
      noTransactions: 'Chưa có giao dịch nào',
      submitWithdrawFailed: 'Không thể tạo yêu cầu rút tiền',
      withdrawRequested: '✅ Đã gửi yêu cầu rút tiền',
      withdrawRequestedDesc: 'Bạn sẽ nhận {net} (sau phí {fee}). Admin sẽ chuyển khoản và xác nhận.',
      noDescription: '—',
      confirmWithdrawTitle: 'Xác nhận yêu cầu rút tiền',
      confirmWithdrawDesc: 'Sau khi gửi, ví của bạn sẽ bị trừ ngay số tiền rút. Admin sẽ chuyển khoản và xác nhận.',
      transferTo: 'Về',
      cancel: 'Hủy',
      confirmWithdraw: 'Xác nhận rút',
    }
    : locale === 'ja-JP'
      ? {
        txLabels: {
          deposit: '入金',
          marketplace_buy: 'カード購入',
          marketplace_sale: 'カード販売',
          escrow_hold: '保留',
          escrow_release: '返金',
          scan_purchase: 'スキャン',
          vip_subscription: 'VIP',
          withdrawal: '出金',
          platform_fee: '手数料',
          refund: '返金',
        },
        minAmount: '最低金額は10,000đです',
        failedDeposit: '入金リンクを作成できません',
        error: 'エラー',
        loginTitle: 'ウォレットを使うにはログインしてください',
        loginButton: 'ログイン',
        depositTitle: 'ウォレットへ入金',
        depositDesc: '金額を選択するか、任意の金額を入力してください',
        customAmount: '別の金額を入力 (VND)...',
        deposit: '入金する',
        withdrawTitle: '銀行口座へ出金',
        withdrawDesc: 'KYC承認済みの販売者向け',
        feeWarning: '出金ごとに5%のプラットフォーム手数料が差し引かれます。最低出金額は{amount}です。',
        bankAccount: '受取口座（KYC登録口座・変更不可）',
        bankAccountHint: '出金先はKYCで登録した銀行口座に限定されます。',
        withdrawableBalance: '出金可能残高',
        withdrawPlaceholder: '出金金額を入力 (VND)...',
        withdraw: '出金する',
        withdrawAmount: '出金額',
        fee5: '5%手数料',
        netAmount: '受取額',
        exceededBalance: '利用可能残高を超えています。',
        minWithdraw: '最低 {amount}。',
        walletTitle: 'CardVerseウォレット',
        availableBalance: '利用可能残高',
        heldBalance: '保留中',
        totalDeposited: '累計入金額',
        buyerTab: '👤 購入者',
        sellerTab: '🏪 販売者',
        historyTitle: '取引履歴',
        noTransactions: '取引はまだありません',
        submitWithdrawFailed: '出金申請を作成できません',
        withdrawRequested: '✅ 出金申請を送信しました',
        withdrawRequestedDesc: '{fee}の手数料控除後、{net}を受け取ります。管理者が振込を確認します。',
        noDescription: '—',
        confirmWithdrawTitle: '出金申請を確認',
        confirmWithdrawDesc: '送信後、出金額はすぐにウォレットから差し引かれます。管理者が振込して確認します。',
        transferTo: '送金先',
        cancel: 'キャンセル',
        confirmWithdraw: '出金を確定',
      }
      : {
        txLabels: {
          deposit: 'Deposit',
          marketplace_buy: 'Card purchase',
          marketplace_sale: 'Card sale',
          escrow_hold: 'Held',
          escrow_release: 'Released',
          scan_purchase: 'Scan',
          vip_subscription: 'VIP',
          withdrawal: 'Withdrawal',
          platform_fee: 'Platform fee',
          refund: 'Refund',
        },
        minAmount: 'Minimum amount is 10,000đ',
        failedDeposit: 'Failed to create deposit order',
        error: 'Error',
        loginTitle: 'Log in to use Wallet',
        loginButton: 'Log in',
        depositTitle: 'Add money to wallet',
        depositDesc: 'Choose an amount or enter a custom amount',
        customAmount: 'Enter another amount (VND)...',
        deposit: 'Deposit',
        withdrawTitle: 'Withdraw to bank account',
        withdrawDesc: 'For KYC-approved sellers',
        feeWarning: 'Each withdrawal is charged a 5% platform fee. The minimum withdrawal per request is {amount}.',
        bankAccount: 'Receiving account (from KYC — cannot be changed)',
        bankAccountHint: 'Funds can only be withdrawn to the bank account you registered during KYC.',
        withdrawableBalance: 'Withdrawable balance',
        withdrawPlaceholder: 'Enter withdrawal amount (VND)...',
        withdraw: 'Withdraw',
        withdrawAmount: 'Withdrawal amount',
        fee5: '5% fee',
        netAmount: 'Net received',
        exceededBalance: 'Exceeds available balance.',
        minWithdraw: 'Minimum {amount}.',
        walletTitle: 'CardVerse Wallet',
        availableBalance: 'Available balance',
        heldBalance: 'Held balance',
        totalDeposited: 'Total deposited',
        buyerTab: '👤 Buyer',
        sellerTab: '🏪 Seller',
        historyTitle: 'Transaction history',
        noTransactions: 'No transactions yet',
        submitWithdrawFailed: 'Unable to create withdrawal request',
        withdrawRequested: '✅ Withdrawal request submitted',
        withdrawRequestedDesc: 'You will receive {net} after a {fee} fee. An admin will transfer and confirm it.',
        noDescription: '—',
        confirmWithdrawTitle: 'Confirm withdrawal request',
        confirmWithdrawDesc: 'After submitting, the withdrawal amount will be deducted from your wallet immediately. An admin will transfer and confirm it.',
        transferTo: 'To',
        cancel: 'Cancel',
        confirmWithdraw: 'Confirm withdrawal',
      };
  const txTypeLabels: Record<string, { label: string; color: string }> = {
    deposit: { label: copy.txLabels.deposit, color: 'text-green-400' },
    marketplace_buy: { label: copy.txLabels.marketplace_buy, color: 'text-red-400' },
    marketplace_sale: { label: copy.txLabels.marketplace_sale, color: 'text-green-400' },
    escrow_hold: { label: copy.txLabels.escrow_hold, color: 'text-yellow-400' },
    escrow_release: { label: copy.txLabels.escrow_release, color: 'text-green-400' },
    scan_purchase: { label: copy.txLabels.scan_purchase, color: 'text-blue-400' },
    vip_subscription: { label: copy.txLabels.vip_subscription, color: 'text-purple-400' },
    withdrawal: { label: copy.txLabels.withdrawal, color: 'text-red-400' },
    platform_fee: { label: copy.txLabels.platform_fee, color: 'text-orange-400' },
    refund: { label: copy.txLabels.refund, color: 'text-green-400' },
  };
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
      toast({ variant: 'destructive', title: copy.minAmount });
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
        throw new Error(data.error || copy.failedDeposit);
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: copy.error, description: err.message });
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
      if (!res.ok) throw new Error(data.error || copy.submitWithdrawFailed);
      toast({
        title: copy.withdrawRequested,
        description: copy.withdrawRequestedDesc
          .replace('{net}', formatVND(data.amount_net))
          .replace('{fee}', formatVND(data.fee)),
      });
      setWithdrawAmount('');
      fetchWallet();
    } catch (err: any) {
      toast({ variant: 'destructive', title: copy.error, description: err.message });
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
          <h2 className="text-2xl font-semibold mb-2">{copy.loginTitle}</h2>
          <Button onClick={() => setOpen(true)}>{copy.loginButton}</Button>
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
          {copy.depositTitle}
        </CardTitle>
        <CardDescription>{copy.depositDesc}</CardDescription>
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
            placeholder={copy.customAmount}
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
                {copy.deposit}
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
          {copy.withdrawTitle}
        </CardTitle>
        <CardDescription>{copy.withdrawDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Fee warning */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-amber-200">
              {copy.feeWarning.replace('{amount}', formatVND(MIN_WITHDRAW))}
            </p>
          </div>
        </div>

        {/* Destination bank (locked to KYC account) */}
        {sellerBank && (
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <ShieldCheck className="h-4 w-4 text-green-500" />
              {copy.bankAccount}
            </div>
            <p className="font-medium">{sellerBank.bank_name}</p>
            <p className="text-sm">{maskAccount(sellerBank.bank_account_number)} · {sellerBank.bank_account_name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {copy.bankAccountHint}
            </p>
          </div>
        )}

        {/* Amount input + live fee breakdown */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{copy.withdrawableBalance}</span>
            <span className="font-semibold text-orange-500">{formatVND(available)}</span>
          </div>
          <div className="flex gap-2">
            <Input
              type="text"
              inputMode="numeric"
              placeholder={copy.withdrawPlaceholder}
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
                  {copy.withdraw}
                </>
              )}
            </Button>
          </div>
          {withdrawNum > 0 && (
            <div className="rounded-lg border bg-accent/30 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">{copy.withdrawAmount}</span><span>{formatVND(withdrawNum)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{copy.fee5}</span><span className="text-red-400">- {formatVND(withdrawFee)}</span></div>
              <div className="flex justify-between border-t border-border/50 pt-1 font-semibold"><span>{copy.netAmount}</span><span className="text-green-400">{formatVND(withdrawNet)}</span></div>
              {withdrawNum > available && (
                <p className="text-xs text-red-400 pt-1">{copy.exceededBalance}</p>
              )}
              {withdrawNum > 0 && withdrawNum < MIN_WITHDRAW && (
                <p className="text-xs text-red-400 pt-1">{copy.minWithdraw.replace('{amount}', formatVND(MIN_WITHDRAW))}</p>
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
                {copy.walletTitle}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <p className="text-sm text-muted-foreground">{copy.availableBalance}</p>
                  <p className="text-3xl font-bold text-orange-500">
                    {formatVND(wallet?.available_balance || 0)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{copy.heldBalance}</p>
                  <p className="text-xl font-semibold text-yellow-500">
                    {formatVND(wallet?.held_balance || 0)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{copy.totalDeposited}</p>
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
                <TabsTrigger value="buyer">{copy.buyerTab}</TabsTrigger>
                <TabsTrigger value="seller">{copy.sellerTab}</TabsTrigger>
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
                {copy.historyTitle}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {transactions.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">{copy.noTransactions}</p>
              ) : (
                <div className="space-y-3">
                  {transactions.map((tx) => {
                    const typeInfo = txTypeLabels[tx.type] || { label: tx.type, color: 'text-muted-foreground' };
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
                              {tx.description || copy.noDescription}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold text-sm ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                            {isPositive ? '+' : ''}{formatVND(tx.amount)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(tx.created_at).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
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
            <AlertDialogTitle>{copy.confirmWithdrawTitle}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>{copy.confirmWithdrawDesc}</p>
                <div className="rounded-lg border bg-accent/40 p-3 text-foreground text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">{copy.withdrawAmount}</span><span>{formatVND(withdrawNum)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{copy.fee5}</span><span className="text-red-400">- {formatVND(withdrawFee)}</span></div>
                  <div className="flex justify-between border-t border-border/50 pt-1 font-semibold"><span>{copy.netAmount}</span><span className="text-green-400">{formatVND(withdrawNet)}</span></div>
                  {sellerBank && (
                    <p className="pt-2 text-xs text-muted-foreground">
                      {copy.transferTo}: {sellerBank.bank_name} · {maskAccount(sellerBank.bank_account_number)} · {sellerBank.bank_account_name}
                    </p>
                  )}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWithdrawing}>{copy.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={submitWithdraw} disabled={isWithdrawing || !withdrawValid}>
              {copy.confirmWithdraw}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Footer />
    </div>
  );
}
