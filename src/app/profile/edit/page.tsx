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
import { User, Camera, Save, ArrowLeft, Lock } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useAuthModal } from "@/components/auth-modal";

export default function EditProfilePage() {
    const router = useRouter();
    const supabase = useSupabase();
    const { user, profile, isLoading: isUserLoading } = useUser();
    const { refreshProfile } = useAuth();
    const { setOpen } = useAuthModal();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [displayName, setDisplayName] = useState("");
    const [phoneNumber, setPhoneNumber] = useState("");
    const [address, setAddress] = useState("");
    const [city, setCity] = useState("");
    const [profileImageUrl, setProfileImageUrl] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [imageFile, setImageFile] = useState<File | null>(null);

    // Load profile data
    useEffect(() => {
        if (profile) {
            setDisplayName(profile.display_name || "");
            setPhoneNumber(profile.phone_number || "");
            setAddress(profile.address || "");
            setCity(profile.city || "");
            setProfileImageUrl(profile.profile_image_url || "");
            setIsLoading(false);
        }
    }, [profile]);

    // Handle image selection
    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            setError("Image must be less than 5MB");
            return;
        }

        // Validate file type
        if (!file.type.startsWith("image/")) {
            setError("Please select an image file");
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        setError(null);
        setSuccess(false);
        setIsSaving(true);

        try {
            let newImageUrl = profileImageUrl;

            // Upload new image if selected
            if (imageFile) {
                const uploadedUrl = await uploadImage(imageFile);
                if (uploadedUrl) {
                    newImageUrl = uploadedUrl;
                } else {
                    setError("Failed to upload image");
                    setIsSaving(false);
                    return;
                }
            }

            // Update profile in database
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

                // Redirect to profile after short delay
                setTimeout(() => {
                    router.push("/profile");
                }, 1500);
            }
        } catch (err) {
            setError("An unexpected error occurred");
        } finally {
            setIsSaving(false);
        }
    };

    // Show login prompt if not logged in
    if (!isUserLoading && !user) {
        return (
            <>
                <Header />
                <div className="container mx-auto px-4 py-16 text-center">
                    <User className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                    <h1 className="text-2xl font-bold mb-2">Đăng nhập để chỉnh sửa hồ sơ</h1>
                    <p className="text-muted-foreground mb-6">
                        Bạn cần đăng nhập để chỉnh sửa thông tin cá nhân.
                    </p>
                    <Button onClick={() => setOpen(true)}>Đăng nhập</Button>
                </div>
                <Footer />
            </>
        );
    }

    if (isUserLoading || isLoading) {
        return (
            <>
                <Header />
                <div className="container mx-auto px-4 py-8 max-w-2xl">
                    <Skeleton className="h-64 w-full rounded-2xl mb-6" />
                </div>
                <Footer />
            </>
        );
    }

    return (
        <>
            <Header />
            <main className="container mx-auto px-4 py-8 max-w-2xl">
                <Card>
                    <CardHeader>
                        <div className="flex items-center gap-4">
                            <Link href="/profile">
                                <Button variant="ghost" size="icon">
                                    <ArrowLeft className="h-5 w-5" />
                                </Button>
                            </Link>
                            <div>
                                <CardTitle>Chỉnh sửa hồ sơ</CardTitle>
                                <CardDescription>
                                    Cập nhật thông tin cá nhân của bạn
                                </CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-6">
                            {/* Avatar Upload */}
                            <div className="flex flex-col items-center gap-4">
                                <div className="relative">
                                    <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden border-4 border-primary/30">
                                        {imagePreview || profileImageUrl ? (
                                            <Image
                                                src={imagePreview || profileImageUrl}
                                                alt="Profile"
                                                fill
                                                className="object-cover"
                                            />
                                        ) : (
                                            <User className="h-12 w-12 text-primary" />
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="absolute -bottom-1 -right-1 p-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
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
                                <p className="text-sm text-muted-foreground">
                                    Click để thay đổi ảnh đại diện
                                </p>
                            </div>

                            {/* Form Fields */}
                            <div className="grid gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="displayName">Tên hiển thị</Label>
                                    <Input
                                        id="displayName"
                                        value={displayName}
                                        onChange={(e) => setDisplayName(e.target.value)}
                                        placeholder="Nhập tên của bạn"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="email">Email</Label>
                                    <Input
                                        id="email"
                                        value={user?.email || ""}
                                        disabled
                                        className="bg-muted"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Email không thể thay đổi
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="phoneNumber">Số điện thoại</Label>
                                    <Input
                                        id="phoneNumber"
                                        value={phoneNumber}
                                        onChange={(e) => setPhoneNumber(e.target.value)}
                                        placeholder="Nhập số điện thoại"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="address">Địa chỉ</Label>
                                    <Input
                                        id="address"
                                        value={address}
                                        onChange={(e) => setAddress(e.target.value)}
                                        placeholder="Nhập địa chỉ"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="city">Thành phố</Label>
                                    <Input
                                        id="city"
                                        value={city}
                                        onChange={(e) => setCity(e.target.value)}
                                        placeholder="Nhập thành phố"
                                    />
                                </div>
                            </div>

                            {/* Password Reset Link */}
                            <div className="border-t pt-4">
                                <Link href="/reset-password">
                                    <Button variant="outline" type="button" className="w-full">
                                        <Lock className="h-4 w-4 mr-2" />
                                        Đổi mật khẩu
                                    </Button>
                                </Link>
                            </div>

                            {/* Error/Success Messages */}
                            {error && (
                                <p className="text-sm text-red-500 text-center">{error}</p>
                            )}
                            {success && (
                                <p className="text-sm text-green-500 text-center">
                                    Cập nhật thành công! Đang chuyển hướng...
                                </p>
                            )}

                            {/* Submit Button */}
                            <Button
                                type="submit"
                                className="w-full"
                                disabled={isSaving}
                            >
                                {isSaving ? (
                                    "Đang lưu..."
                                ) : (
                                    <>
                                        <Save className="h-4 w-4 mr-2" />
                                        Lưu thay đổi
                                    </>
                                )}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </main>
            <Footer />
        </>
    );
}
