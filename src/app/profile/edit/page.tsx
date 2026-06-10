"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSupabase, useUser, useAuth } from "@/lib/supabase";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, Camera, Save, ArrowLeft, Lock, Crown, MapPin, Activity, Zap, Truck, Phone, CheckCircle, Loader2, Package } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useAuthModal } from "@/components/auth-modal";
import { AddressBook } from "@/components/address-book";
import { useLocalization } from "@/context/localization-context";
import { useToast } from "@/hooks/use-toast";

export default function EditProfilePage() {
    const router = useRouter();
    const supabase = useSupabase();
    const { user, profile, isLoading: isUserLoading } = useUser();
    const { refreshProfile } = useAuth();
    const { setOpen } = useAuthModal();
    const { toast } = useToast();
    const { locale } = useLocalization();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const copy = locale === "vi-VN"
        ? {
            imageTooLarge: "Ảnh phải nhỏ hơn 5MB",
            invalidImage: "Vui lòng chọn file hình ảnh",
            uploadFailed: "Không thể tải ảnh lên",
            unexpectedError: "Đã xảy ra lỗi không mong muốn",
            loginTitle: "Đăng nhập để xem cài đặt",
            loginDescription: "Bạn cần đăng nhập để quản lý hồ sơ, thẻ thành viên, và thông tin địa chỉ.",
            loginButton: "Đăng nhập",
            pageTitle: "Cài đặt tài khoản",
            pageDescription: "Quản lý hồ sơ, địa chỉ giao hàng, bảo mật và gói VIP.",
            tabGeneral: "Hồ sơ cá nhân",
            tabGeneralMobile: "Hồ sơ",
            tabVip: "Gói VIP & Dịch vụ",
            tabVipMobile: "VIP",
            tabAddresses: "Sổ địa chỉ",
            tabAddressesMobile: "Địa chỉ",
            tabSecurity: "Bảo mật",
            generalTitle: "Hồ sơ cá nhân",
            generalDescription: "Cập nhật ảnh đại diện và thông tin liên hệ chính.",
            avatarHint: "Tối đa 5MB. JPG, PNG.",
            displayName: "Tên hiển thị",
            displayNamePlaceholder: "Nhập tên của bạn",
            phoneNumber: "Số điện thoại liên lạc",
            phoneNumberPlaceholder: "0912 345 678",
            loginEmail: "Email đăng nhập",
            loginEmailHint: "Email dùng để đăng nhập và không thể thay đổi.",
            profileUpdated: "Hồ sơ cá nhân đã được cập nhật thành công!",
            saving: "Đang lưu...",
            saveChanges: "Lưu thay đổi",
            currentMembership: "Gói thành viên hiện tại",
            membershipDescription: "Trạng thái gói nâng cấp và quyền lợi quét thẻ của bạn.",
            status: "Trạng thái",
            active: "Đang kích hoạt",
            expiresOn: "Hết hạn vào",
            basicPlan: "Gói Cơ Bản (Free)",
            activeBasic: "Hoạt động",
            changePlan: "Đổi gói / Nâng cấp",
            upgradeNow: "Nâng cấp VIP ngay",
            aiScans: "Lượt quét AI",
            scansUnit: "lượt",
            scansResetNote: "Lượt quét sẽ được đặt lại theo ngày.",
            unlockBenefits: "Mở khóa quyền lợi",
            benefitAi: "Nhận dạng thẻ Pokémon AI",
            benefitAdvancedLimit: "Giới hạn lượt quét nâng cao",
            benefitPsa: "Báo cáo định giá thị trường PSA",
            addressBookTitle: "Sổ địa chỉ",
            addressBookDescription: "Quản lý các địa chỉ nhận hàng. Địa chỉ mặc định sẽ được chọn sẵn khi thanh toán.",
            securityTitle: "Bảo mật tài khoản",
            securityDescription: "Quản lý mật khẩu và bảo vệ tài khoản CardVerse của bạn.",
            password: "Mật khẩu",
            passwordHint: "Nên đổi mật khẩu định kỳ 6 tháng một lần.",
            changePassword: "Đổi mật khẩu",
            twoFactor: "Xác thực 2 lớp (2FA)",
            twoFactorHint: "Tính năng này sắp được ra mắt.",
            comingSoon: "Sắp ra mắt",
        }
        : locale === "ja-JP"
            ? {
                imageTooLarge: "画像は5MB未満にしてください",
                invalidImage: "画像ファイルを選択してください",
                uploadFailed: "画像をアップロードできませんでした",
                unexpectedError: "予期しないエラーが発生しました",
                loginTitle: "設定を表示するにはログインしてください",
                loginDescription: "プロフィール、会員プラン、住所情報を管理するにはログインが必要です。",
                loginButton: "ログイン",
                pageTitle: "アカウント設定",
                pageDescription: "プロフィール、配送先住所、セキュリティ、VIPプランを管理します。",
                tabGeneral: "プロフィール",
                tabGeneralMobile: "プロフィール",
                tabVip: "VIPプランとサービス",
                tabVipMobile: "VIP",
                tabAddresses: "住所録",
                tabAddressesMobile: "住所",
                tabSecurity: "セキュリティ",
                generalTitle: "プロフィール",
                generalDescription: "プロフィール画像と主な連絡先情報を更新します。",
                avatarHint: "最大5MB。JPG、PNG。",
                displayName: "表示名",
                displayNamePlaceholder: "名前を入力",
                phoneNumber: "連絡先電話番号",
                phoneNumberPlaceholder: "0912 345 678",
                loginEmail: "ログイン用メール",
                loginEmailHint: "このメールはログイン用で、変更できません。",
                profileUpdated: "プロフィールが更新されました。",
                saving: "保存中...",
                saveChanges: "変更を保存",
                currentMembership: "現在の会員プラン",
                membershipDescription: "アップグレード状況とカードスキャン特典を確認します。",
                status: "ステータス",
                active: "有効",
                expiresOn: "有効期限",
                basicPlan: "基本プラン（無料）",
                activeBasic: "有効",
                changePlan: "プラン変更 / アップグレード",
                upgradeNow: "今すぐVIPにアップグレード",
                aiScans: "AIスキャン回数",
                scansUnit: "回",
                scansResetNote: "スキャン回数は毎日リセットされます。",
                unlockBenefits: "特典を解除",
                benefitAi: "ポケモンカードAI認識",
                benefitAdvancedLimit: "上位スキャン上限",
                benefitPsa: "PSA市場価格レポート",
                addressBookTitle: "住所録",
                addressBookDescription: "配送先住所を管理します。デフォルト住所は決済時に自動選択されます。",
                securityTitle: "アカウントのセキュリティ",
                securityDescription: "パスワードとCardVerseアカウントの保護を管理します。",
                password: "パスワード",
                passwordHint: "6か月ごとにパスワードを変更することをおすすめします。",
                changePassword: "パスワード変更",
                twoFactor: "2段階認証 (2FA)",
                twoFactorHint: "この機能は近日公開です。",
                comingSoon: "近日公開",
            }
            : {
                imageTooLarge: "Image must be smaller than 5MB",
                invalidImage: "Please select an image file",
                uploadFailed: "Unable to upload image",
                unexpectedError: "An unexpected error occurred",
                loginTitle: "Log in to view settings",
                loginDescription: "You need to log in to manage your profile, membership plan, and address information.",
                loginButton: "Log in",
                pageTitle: "Account settings",
                pageDescription: "Manage your profile, shipping addresses, security, and VIP plan.",
                tabGeneral: "Profile",
                tabGeneralMobile: "Profile",
                tabVip: "VIP Plan & Services",
                tabVipMobile: "VIP",
                tabAddresses: "Address Book",
                tabAddressesMobile: "Addresses",
                tabSecurity: "Security",
                generalTitle: "Profile",
                generalDescription: "Update your avatar and primary contact details.",
                avatarHint: "Up to 5MB. JPG, PNG.",
                displayName: "Display name",
                displayNamePlaceholder: "Enter your name",
                phoneNumber: "Contact phone number",
                phoneNumberPlaceholder: "0912 345 678",
                loginEmail: "Login email",
                loginEmailHint: "This email is used for login and cannot be changed.",
                profileUpdated: "Your profile has been updated successfully.",
                saving: "Saving...",
                saveChanges: "Save changes",
                currentMembership: "Current membership plan",
                membershipDescription: "Your upgrade status and card-scan benefits.",
                status: "Status",
                active: "Active",
                expiresOn: "Expires on",
                basicPlan: "Basic Plan (Free)",
                activeBasic: "Active",
                changePlan: "Change plan / Upgrade",
                upgradeNow: "Upgrade to VIP",
                aiScans: "AI scans",
                scansUnit: "scans",
                scansResetNote: "Scan usage resets daily.",
                unlockBenefits: "Unlock benefits",
                benefitAi: "Pokemon card AI recognition",
                benefitAdvancedLimit: "Higher scan limits",
                benefitPsa: "PSA market valuation reports",
                addressBookTitle: "Address Book",
                addressBookDescription: "Manage delivery addresses. Your default address will be preselected at checkout.",
                securityTitle: "Account security",
                securityDescription: "Manage your password and protect your CardVerse account.",
                password: "Password",
                passwordHint: "You should change your password every 6 months.",
                changePassword: "Change password",
                twoFactor: "Two-factor authentication (2FA)",
                twoFactorHint: "This feature is coming soon.",
                comingSoon: "Coming soon",
            };

    // General
    const [displayName, setDisplayName] = useState("");
    const [phoneNumber, setPhoneNumber] = useState("");
    const [profileImageUrl, setProfileImageUrl] = useState("");
    
    // Address (legacy simple fields — kept for backward compat)
    const [address, setAddress] = useState("");
    const [city, setCity] = useState("");
    


    // VIP
    const [scanUsage, setScanUsage] = useState<any>(null);
    const [subscription, setSubscription] = useState<any>(null);

    // States
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    
    // Image Upload
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [imageFile, setImageFile] = useState<File | null>(null);

    // Load profile data
    useEffect(() => {
        if (profile && user) {
            setDisplayName(profile.display_name || "");
            setPhoneNumber(profile.phone_number || "");
            setAddress(profile.address || "");
            setCity(profile.city || "");
            setProfileImageUrl(profile.profile_image_url || "");


            
            const fetchAdditionalData = async () => {
                // Fetch VIP data
                const [scanRes, subRes] = await Promise.all([
                    supabase.from('user_scan_usage').select('*').eq('user_id', user.id).single(),
                    supabase.from('user_subscriptions')
                        .select('*')
                        .eq('user_id', user.id)
                        .eq('status', 'active')
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .single()
                ]) as [{ data: any | null }, { data: any | null }];
                
                if (scanRes.data) setScanUsage(scanRes.data);
                if (subRes.data) setSubscription(subRes.data);

                // Fetch KYC verified phone if profile phone is empty
                let verifiedPhone = profile.phone_number || '';
                if (!verifiedPhone) {
                    const { data: kycData } = await supabase
                        .from('seller_verifications')
                        .select('phone_number')
                        .eq('user_id', user.id)
                        .eq('status', 'approved')
                        .single() as { data: { phone_number: string } | null };
                    
                    if (kycData?.phone_number) {
                        verifiedPhone = kycData.phone_number;
                        setPhoneNumber(verifiedPhone);
                    }
                }



                setIsLoading(false);
            };
            fetchAdditionalData();
        } else if (!isUserLoading && !user) {
            setIsLoading(false);
        }
    }, [profile, user, isUserLoading, supabase]);

    // Handle image selection
    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            setError(copy.imageTooLarge);
            return;
        }

        if (!file.type.startsWith("image/")) {
            setError(copy.invalidImage);
            return;
        }

        setImageFile(file);
        const reader = new FileReader();
        reader.onloadend = () => {
            setImagePreview(reader.result as string);
        };
        reader.readAsDataURL(file);
    };

    // Upload image to Supabase storage
    const uploadImage = async (file: File): Promise<string | null> => {
        if (!user) return null;

        const fileExt = file.name.split(".").pop();
        const fileName = `${user.id}-${Date.now()}.${fileExt}`;
        const filePath = `avatars/${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from("profiles")
            .upload(filePath, file, { upsert: true });

        if (uploadError) {
            console.error("Upload error:", uploadError);
            return null;
        }

        const { data: { publicUrl } } = supabase.storage
            .from("profiles")
            .getPublicUrl(filePath);

        return publicUrl;
    };

    // Save general profile info
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        setError(null);
        setSuccess(false);
        setIsSaving(true);

        try {
            let newImageUrl = profileImageUrl;

            if (imageFile) {
                const uploadedUrl = await uploadImage(imageFile);
                if (uploadedUrl) {
                    newImageUrl = uploadedUrl;
                } else {
                    setError(copy.uploadFailed);
                    setIsSaving(false);
                    return;
                }
            }

            const { error: updateError } = await supabase
                .from("profiles")
                .update({
                    display_name: displayName,
                    phone_number: phoneNumber,
                    address: address,
                    city: city,
                    profile_image_url: newImageUrl,
                    updated_at: new Date().toISOString(),
                } as never)
                .eq("id", user.id);

            if (updateError) {
                setError(updateError.message);
            } else {
                setSuccess(true);
                setProfileImageUrl(newImageUrl);
                setImageFile(null);
                setImagePreview(null);
                await refreshProfile();
                
                setTimeout(() => {
                    setSuccess(false);
                }, 3000);
            }
        } catch (err) {
            setError(copy.unexpectedError);
        } finally {
            setIsSaving(false);
        }
    };



    // Show login prompt if not logged in
    if (!isUserLoading && !user) {
        return (
            <>
                <Header />
                <div className="container mx-auto px-4 py-16 text-center min-h-[60vh] flex flex-col items-center justify-center">
                    <User className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                    <h1 className="text-2xl font-bold mb-2">{copy.loginTitle}</h1>
                    <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                        {copy.loginDescription}
                    </p>
                    <Button onClick={() => setOpen(true)} className="min-w-[120px]">{copy.loginButton}</Button>
                </div>
                <Footer />
            </>
        );
    }

    if (isUserLoading || isLoading) {
        return (
            <>
                <Header />
                <div className="container mx-auto px-4 py-8 max-w-4xl min-h-[60vh]">
                    <Skeleton className="h-[400px] w-full rounded-2xl mb-6" />
                </div>
                <Footer />
            </>
        );
    }



    return (
        <>
            <Header />
            <main className="container mx-auto px-4 py-8 max-w-4xl min-h-[70vh]">
                <div className="flex items-center gap-4 mb-8">
                    <Link href="/profile">
                        <Button variant="outline" size="icon" className="h-10 w-10 shrink-0">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">{copy.pageTitle}</h1>
                        <p className="text-muted-foreground mt-1">
                            {copy.pageDescription}
                        </p>
                    </div>
                </div>

                <Tabs defaultValue="general" className="flex flex-col md:flex-row gap-6">
                    {/* Sidebar Tabs */}
                    <TabsList className="flex flex-row md:flex-col h-auto w-full md:w-64 bg-transparent space-x-2 md:space-x-0 space-y-0 md:space-y-1.5 justify-start overflow-x-auto shrink-0 md:items-stretch py-1 md:py-0 px-0">
                        <TabsTrigger value="general" className="flex justify-start gap-3 w-full data-[state=active]:bg-primary/5 data-[state=active]:text-primary border border-transparent data-[state=active]:border-primary/20 py-2.5 px-4 rounded-lg transition-all">
                            <User className="h-4 w-4" />
                            <span className="hidden sm:inline">{copy.tabGeneral}</span>
                            <span className="sm:hidden">{copy.tabGeneralMobile}</span>
                        </TabsTrigger>
                        <TabsTrigger value="vip" className="flex justify-start gap-3 w-full data-[state=active]:bg-primary/5 data-[state=active]:text-primary border border-transparent data-[state=active]:border-primary/20 py-2.5 px-4 rounded-lg transition-all">
                            <Crown className="h-4 w-4" />
                            <span className="hidden sm:inline">{copy.tabVip}</span>
                            <span className="sm:hidden">{copy.tabVipMobile}</span>
                        </TabsTrigger>
                        <TabsTrigger value="addresses" className="flex justify-start gap-3 w-full data-[state=active]:bg-primary/5 data-[state=active]:text-primary border border-transparent data-[state=active]:border-primary/20 py-2.5 px-4 rounded-lg transition-all">
                            <MapPin className="h-4 w-4" />
                            <span className="hidden sm:inline">{copy.tabAddresses}</span>
                            <span className="sm:hidden">{copy.tabAddressesMobile}</span>
                        </TabsTrigger>
                        <TabsTrigger value="security" className="flex justify-start gap-3 w-full data-[state=active]:bg-primary/5 data-[state=active]:text-primary border border-transparent data-[state=active]:border-primary/20 py-2.5 px-4 rounded-lg transition-all">
                            <Lock className="h-4 w-4" />
                            <span className="hidden sm:inline">{copy.tabSecurity}</span>
                        </TabsTrigger>
                    </TabsList>

                    {/* Tab Contents */}
                    <div className="flex-1 w-full min-w-0">
                        {/* ─── 1. GENERAL TAB ─── */}
                        <TabsContent value="general" className="mt-0 outline-none">
                            <Card className="border-border">
                                <CardHeader>
                                    <CardTitle>{copy.generalTitle}</CardTitle>
                                    <CardDescription>{copy.generalDescription}</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <form onSubmit={handleSubmit} className="space-y-6">
                                        <div className="flex flex-col md:flex-row gap-8 items-start">
                                            {/* Avatar Area */}
                                            <div className="flex flex-col items-center gap-3 shrink-0">
                                                <div className="relative group">
                                                    <div className="w-32 h-32 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden border-2 border-border group-hover:border-primary/50 transition-colors">
                                                        {imagePreview || profileImageUrl ? (
                                                            <Image
                                                                src={imagePreview || profileImageUrl}
                                                                alt="Profile"
                                                                fill
                                                                className="object-cover"
                                                                unoptimized
                                                            />
                                                        ) : (
                                                            <User className="h-12 w-12 text-muted-foreground" />
                                                        )}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => fileInputRef.current?.click()}
                                                        className="absolute bottom-0 right-0 p-2.5 rounded-full bg-primary text-primary-foreground shadow-md hover:scale-105 active:scale-95 transition-all"
                                                    >
                                                        <Camera className="h-4 w-4" />
                                                    </button>
                                                    <input
                                                        ref={fileInputRef}
                                                        type="file"
                                                        accept="image/*"
                                                        onChange={handleImageSelect}
                                                        className="hidden"
                                                    />
                                                </div>
                                                <p className="text-xs text-muted-foreground text-center max-w-[120px]">
                                                    {copy.avatarHint}
                                                </p>
                                            </div>

                                            {/* Info Area */}
                                            <div className="flex-1 w-full space-y-4">
                                                <div className="space-y-2">
                                                    <Label htmlFor="displayName">{copy.displayName} <span className="text-red-500">*</span></Label>
                                                    <Input
                                                        id="displayName"
                                                        value={displayName}
                                                        onChange={(e) => setDisplayName(e.target.value)}
                                                        placeholder={copy.displayNamePlaceholder}
                                                        required
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="phoneNumber">{copy.phoneNumber}</Label>
                                                    <Input
                                                        id="phoneNumber"
                                                        value={phoneNumber}
                                                        onChange={(e) => setPhoneNumber(e.target.value)}
                                                        placeholder={copy.phoneNumberPlaceholder}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>{copy.loginEmail}</Label>
                                                    <Input
                                                        value={user?.email || ""}
                                                        disabled
                                                        className="bg-muted text-muted-foreground"
                                                    />
                                                    <p className="text-[11px] text-muted-foreground mt-1">
                                                        {copy.loginEmailHint}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {error && <p className="text-sm text-red-500">{error}</p>}
                                        {success && (
                                            <div className="flex items-center gap-2 text-sm text-green-500 font-medium bg-green-500/5 border border-green-500/20 rounded-lg px-4 py-2.5">
                                                <CheckCircle className="h-4 w-4" />
                                                {copy.profileUpdated}
                                            </div>
                                        )}
                                        
                                        <div className="flex justify-end pt-4 border-t border-border">
                                            <Button type="submit" disabled={isSaving} className="min-w-[140px]">
                                                {isSaving ? (
                                                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {copy.saving}</>
                                                ) : (
                                                    <><Save className="w-4 h-4 mr-2" /> {copy.saveChanges}</>
                                                )}
                                            </Button>
                                        </div>
                                    </form>
                                </CardContent>
                            </Card>
                        </TabsContent>


                        {/* ─── 3. VIP TAB ─── */}
                        <TabsContent value="vip" className="mt-0 outline-none">
                            <div className="space-y-6">
                                <Card className="border-primary/20 bg-primary/5 shadow-sm overflow-hidden relative">
                                    <div className="absolute top-0 right-0 p-4 opacity-10">
                                        <Crown className="w-32 h-32" />
                                    </div>
                                    <CardHeader className="relative z-10 pb-4">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Crown className="w-5 h-5 text-primary" />
                                            <CardTitle className="text-xl">{copy.currentMembership}</CardTitle>
                                        </div>
                                        <CardDescription>{copy.membershipDescription}</CardDescription>
                                    </CardHeader>
                                    <CardContent className="relative z-10">
                                        <div className="flex flex-col md:flex-row gap-6 md:items-end justify-between">
                                            <div>
                                                {subscription ? (
                                                    <div className="space-y-1">
                                                        <h3 className="text-2xl font-bold text-primary">{(subscription.plan_id || 'VIP').toUpperCase()}</h3>
                                                        <p className="text-sm text-muted-foreground font-medium">{copy.status}: <span className="text-green-600">{copy.active}</span></p>
                                                        <p className="text-xs text-muted-foreground mt-2">{copy.expiresOn}: {new Date(subscription.current_period_end).toLocaleDateString(locale)}</p>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-1">
                                                        <h3 className="text-2xl font-bold text-zinc-700 dark:text-zinc-300">{copy.basicPlan}</h3>
                                                        <p className="text-sm text-muted-foreground font-medium">{copy.status}: {copy.activeBasic}</p>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex shrink-0 gap-3">
                                                <Link href="/pricing">
                                                    <Button variant={subscription ? "outline" : "default"} className="border-primary text-primary hover:bg-primary/10">
                                                        {subscription ? copy.changePlan : copy.upgradeNow}
                                                        <Zap className="w-4 h-4 ml-2" />
                                                    </Button>
                                                </Link>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <Card className="border-border">
                                        <CardHeader className="pb-3">
                                            <CardTitle className="text-base flex items-center gap-2">
                                                <Activity className="w-4 h-4 text-orange-500" /> {copy.aiScans}
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-3xl font-bold">
                                                {scanUsage?.scan_count || 0}
                                                <span className="text-sm font-normal text-muted-foreground ml-2">/ {scanUsage?.scan_limit || 5} {copy.scansUnit}</span>
                                            </div>
                                            <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-2 rounded-full mt-4 overflow-hidden">
                                                <div 
                                                    className="bg-orange-500 h-full rounded-full transition-all duration-500" 
                                                    style={{ width: `${Math.min(100, ((scanUsage?.scan_count || 0) / (scanUsage?.scan_limit || 5)) * 100)}%` }}
                                                />
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-3">{copy.scansResetNote}</p>
                                        </CardContent>
                                    </Card>

                                    <Card className="border-border">
                                        <CardHeader className="pb-3">
                                            <CardTitle className="text-base">{copy.unlockBenefits}</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <ul className="space-y-2 text-sm text-muted-foreground">
                                                <li className="flex items-start gap-2">
                                                    <span className="text-green-500 mt-0.5">✓</span>
                                                    {copy.benefitAi}
                                                </li>
                                                <li className="flex items-start gap-2">
                                                    <span className={subscription ? "text-green-500 mt-0.5" : "text-zinc-300 mt-0.5"}>✓</span>
                                                    {copy.benefitAdvancedLimit}
                                                </li>
                                                <li className="flex items-start gap-2">
                                                    <span className={subscription ? "text-green-500 mt-0.5" : "text-zinc-300 mt-0.5"}>✓</span>
                                                    {copy.benefitPsa}
                                                </li>
                                            </ul>
                                        </CardContent>
                                    </Card>
                                </div>
                            </div>
                        </TabsContent>

                        {/* ─── ADDRESS BOOK TAB ─── */}
                        <TabsContent value="addresses" className="mt-0 outline-none">
                            <Card className="border-border">
                                <CardHeader>
                                    <div className="flex items-center gap-2">
                                        <MapPin className="h-5 w-5 text-orange-500" />
                                        <CardTitle>{copy.addressBookTitle}</CardTitle>
                                    </div>
                                    <CardDescription>{copy.addressBookDescription}</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <AddressBook />
                                </CardContent>
                            </Card>
                        </TabsContent>

                        {/* ─── 4. SECURITY TAB ─── */}
                        <TabsContent value="security" className="mt-0 outline-none">
                            <Card className="border-border border-red-500/10">
                                <CardHeader>
                                    <div className="flex items-center gap-2">
                                        <Lock className="h-5 w-5 text-zinc-500" />
                                        <CardTitle>{copy.securityTitle}</CardTitle>
                                    </div>
                                    <CardDescription>{copy.securityDescription}</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
                                            <div>
                                                <h4 className="font-medium text-sm">{copy.password}</h4>
                                                <p className="text-xs text-muted-foreground mt-1">{copy.passwordHint}</p>
                                            </div>
                                            <Link href="/reset-password">
                                                <Button variant="outline" size="sm">{copy.changePassword}</Button>
                                            </Link>
                                        </div>
                                        
                                        <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
                                            <div>
                                                <h4 className="font-medium text-sm">{copy.twoFactor}</h4>
                                                <p className="text-xs text-muted-foreground mt-1">{copy.twoFactorHint}</p>
                                            </div>
                                            <Button variant="secondary" size="sm" disabled>{copy.comingSoon}</Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </div>
                </Tabs>
            </main>
            <Footer />
        </>
    );
}
