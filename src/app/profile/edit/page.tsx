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

import { useToast } from "@/hooks/use-toast";

export default function EditProfilePage() {
    const router = useRouter();
    const supabase = useSupabase();
    const { user, profile, isLoading: isUserLoading } = useUser();
    const { refreshProfile } = useAuth();
    const { setOpen } = useAuthModal();
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);

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
                ]);
                
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
            setError("Ảnh phải nhỏ hơn 5MB");
            return;
        }

        if (!file.type.startsWith("image/")) {
            setError("Vui lòng chọn file hình ảnh");
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
                    setError("Không thể tải ảnh lên");
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
                } as Record<string, unknown>)
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
            setError("Đã xảy ra lỗi không mong muốn");
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
                    <h1 className="text-2xl font-bold mb-2">Đăng nhập để xem cài đặt</h1>
                    <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                        Bạn cần đăng nhập để quản lý hồ sơ, thẻ thành viên, và thông tin địa chỉ.
                    </p>
                    <Button onClick={() => setOpen(true)} className="min-w-[120px]">Đăng nhập</Button>
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
                        <h1 className="text-3xl font-bold tracking-tight">Cài đặt tài khoản</h1>
                        <p className="text-muted-foreground mt-1">
                            Quản lý hồ sơ, địa chỉ giao hàng, bảo mật và gói VIP.
                        </p>
                    </div>
                </div>

                <Tabs defaultValue="general" className="flex flex-col md:flex-row gap-6">
                    {/* Sidebar Tabs */}
                    <TabsList className="flex flex-row md:flex-col h-auto w-full md:w-64 bg-transparent space-x-2 md:space-x-0 space-y-0 md:space-y-1.5 justify-start overflow-x-auto shrink-0 md:items-stretch py-1 md:py-0 px-0">
                        <TabsTrigger value="general" className="flex justify-start gap-3 w-full data-[state=active]:bg-primary/5 data-[state=active]:text-primary border border-transparent data-[state=active]:border-primary/20 py-2.5 px-4 rounded-lg transition-all">
                            <User className="h-4 w-4" />
                            <span className="hidden sm:inline">Hồ sơ cá nhân</span>
                            <span className="sm:hidden">Hồ sơ</span>
                        </TabsTrigger>
                        <TabsTrigger value="vip" className="flex justify-start gap-3 w-full data-[state=active]:bg-primary/5 data-[state=active]:text-primary border border-transparent data-[state=active]:border-primary/20 py-2.5 px-4 rounded-lg transition-all">
                            <Crown className="h-4 w-4" />
                            <span className="hidden sm:inline">Gói VIP & Dịch vụ</span>
                            <span className="sm:hidden">VIP</span>
                        </TabsTrigger>
                        <TabsTrigger value="security" className="flex justify-start gap-3 w-full data-[state=active]:bg-primary/5 data-[state=active]:text-primary border border-transparent data-[state=active]:border-primary/20 py-2.5 px-4 rounded-lg transition-all">
                            <Lock className="h-4 w-4" />
                            <span className="hidden sm:inline">Bảo mật</span>
                        </TabsTrigger>
                    </TabsList>

                    {/* Tab Contents */}
                    <div className="flex-1 w-full min-w-0">
                        {/* ─── 1. GENERAL TAB ─── */}
                        <TabsContent value="general" className="mt-0 outline-none">
                            <Card className="border-border">
                                <CardHeader>
                                    <CardTitle>Hồ sơ cá nhân</CardTitle>
                                    <CardDescription>Cập nhật ảnh đại diện và thông tin liên hệ chính.</CardDescription>
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
                                                    Tối đa 5MB. JPG, PNG.
                                                </p>
                                            </div>

                                            {/* Info Area */}
                                            <div className="flex-1 w-full space-y-4">
                                                <div className="space-y-2">
                                                    <Label htmlFor="displayName">Tên hiển thị <span className="text-red-500">*</span></Label>
                                                    <Input
                                                        id="displayName"
                                                        value={displayName}
                                                        onChange={(e) => setDisplayName(e.target.value)}
                                                        placeholder="Nhập tên của bạn"
                                                        required
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="phoneNumber">Số điện thoại liên lạc</Label>
                                                    <Input
                                                        id="phoneNumber"
                                                        value={phoneNumber}
                                                        onChange={(e) => setPhoneNumber(e.target.value)}
                                                        placeholder="0912 345 678"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Email đăng nhập</Label>
                                                    <Input
                                                        value={user?.email || ""}
                                                        disabled
                                                        className="bg-muted text-muted-foreground"
                                                    />
                                                    <p className="text-[11px] text-muted-foreground mt-1">
                                                        Email dùng để đăng nhập và không thể thay đổi.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {error && <p className="text-sm text-red-500">{error}</p>}
                                        {success && (
                                            <div className="flex items-center gap-2 text-sm text-green-500 font-medium bg-green-500/5 border border-green-500/20 rounded-lg px-4 py-2.5">
                                                <CheckCircle className="h-4 w-4" />
                                                Hồ sơ cá nhân đã được cập nhật thành công!
                                            </div>
                                        )}
                                        
                                        <div className="flex justify-end pt-4 border-t border-border">
                                            <Button type="submit" disabled={isSaving} className="min-w-[140px]">
                                                {isSaving ? (
                                                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Đang lưu...</>
                                                ) : (
                                                    <><Save className="w-4 h-4 mr-2" /> Lưu thay đổi</>
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
                                            <CardTitle className="text-xl">Gói thành viên hiện tại</CardTitle>
                                        </div>
                                        <CardDescription>Trạng thái gói nâng cấp và quyền lợi quét thẻ của bạn.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="relative z-10">
                                        <div className="flex flex-col md:flex-row gap-6 md:items-end justify-between">
                                            <div>
                                                {subscription ? (
                                                    <div className="space-y-1">
                                                        <h3 className="text-2xl font-bold text-primary">{(subscription.plan_id || 'VIP').toUpperCase()}</h3>
                                                        <p className="text-sm text-muted-foreground font-medium">Trạng thái: <span className="text-green-600">Đang kích hoạt</span></p>
                                                        <p className="text-xs text-muted-foreground mt-2">Hết hạn vào: {new Date(subscription.current_period_end).toLocaleDateString('vi-VN')}</p>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-1">
                                                        <h3 className="text-2xl font-bold text-zinc-700 dark:text-zinc-300">Gói Cơ Bản (Free)</h3>
                                                        <p className="text-sm text-muted-foreground font-medium">Trạng thái: Hoạt động</p>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex shrink-0 gap-3">
                                                <Link href="/pricing">
                                                    <Button variant={subscription ? "outline" : "default"} className="border-primary text-primary hover:bg-primary/10">
                                                        {subscription ? "Đổi gói / Nâng cấp" : "Nâng cấp VIP ngay"}
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
                                                <Activity className="w-4 h-4 text-orange-500" /> Lượt quét AI
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-3xl font-bold">
                                                {scanUsage?.scan_count || 0}
                                                <span className="text-sm font-normal text-muted-foreground ml-2">/ {scanUsage?.scan_limit || 5} lượt</span>
                                            </div>
                                            <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-2 rounded-full mt-4 overflow-hidden">
                                                <div 
                                                    className="bg-orange-500 h-full rounded-full transition-all duration-500" 
                                                    style={{ width: `${Math.min(100, ((scanUsage?.scan_count || 0) / (scanUsage?.scan_limit || 5)) * 100)}%` }}
                                                />
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-3">Lượt quét sẽ được đặt lại theo ngày.</p>
                                        </CardContent>
                                    </Card>

                                    <Card className="border-border">
                                        <CardHeader className="pb-3">
                                            <CardTitle className="text-base">Mở khóa quyền lợi</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <ul className="space-y-2 text-sm text-muted-foreground">
                                                <li className="flex items-start gap-2">
                                                    <span className="text-green-500 mt-0.5">✓</span>
                                                    Nhận dạng thẻ Pokémon AI
                                                </li>
                                                <li className="flex items-start gap-2">
                                                    <span className={subscription ? "text-green-500 mt-0.5" : "text-zinc-300 mt-0.5"}>✓</span>
                                                    Giới hạn lượt quét nâng cao
                                                </li>
                                                <li className="flex items-start gap-2">
                                                    <span className={subscription ? "text-green-500 mt-0.5" : "text-zinc-300 mt-0.5"}>✓</span>
                                                    Báo cáo định giá thị trường PSA
                                                </li>
                                            </ul>
                                        </CardContent>
                                    </Card>
                                </div>
                            </div>
                        </TabsContent>

                        {/* ─── 4. SECURITY TAB ─── */}
                        <TabsContent value="security" className="mt-0 outline-none">
                            <Card className="border-border border-red-500/10">
                                <CardHeader>
                                    <div className="flex items-center gap-2">
                                        <Lock className="h-5 w-5 text-zinc-500" />
                                        <CardTitle>Bảo mật tài khoản</CardTitle>
                                    </div>
                                    <CardDescription>Quản lý mật khẩu và bảo vệ tài khoản CardVerse của bạn.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors">
                                            <div>
                                                <h4 className="font-medium text-sm">Mật khẩu</h4>
                                                <p className="text-xs text-muted-foreground mt-1">Nên đổi mật khẩu định kỳ 6 tháng một lần.</p>
                                            </div>
                                            <Link href="/reset-password">
                                                <Button variant="outline" size="sm">Đổi mật khẩu</Button>
                                            </Link>
                                        </div>
                                        
                                        <div className="flex items-center justify-between p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
                                            <div>
                                                <h4 className="font-medium text-sm">Xác thực 2 lớp (2FA)</h4>
                                                <p className="text-xs text-muted-foreground mt-1">Tính năng này sắp được ra mắt.</p>
                                            </div>
                                            <Button variant="secondary" size="sm" disabled>Sắp ra mắt</Button>
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
