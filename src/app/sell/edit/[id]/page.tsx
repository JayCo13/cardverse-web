"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Pencil, Save } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useLocalization } from "@/context/localization-context";
import { useToast } from "@/hooks/use-toast";
import { optimizeCloudinaryUrl } from "@/lib/cloudinary-url";

type EditableListing = {
    id: string;
    status: string;
    listing_type: string;
    name: string;
    description: string | null;
    price: number | null;
    quantity: number | null;
    accept_offers: boolean | null;
    image_url: string | null;
};

const parsePrice = (value: string) => {
    const digits = value.replace(/[^\d]/g, "");
    return digits ? Number.parseInt(digits, 10) : 0;
};

const formatPrice = (value: string) => {
    const price = parsePrice(value);
    return price > 0 ? new Intl.NumberFormat("vi-VN").format(price) : "";
};

export default function EditListingPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const { locale } = useLocalization();
    const { toast } = useToast();
    const [listing, setListing] = useState<EditableListing | null>(null);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [price, setPrice] = useState("");
    const [quantity, setQuantity] = useState("1");
    const [acceptOffers, setAcceptOffers] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const copy = locale === "vi-VN"
        ? {
            title: "Chỉnh sửa listing",
            subtitle: "Cập nhật thông tin đang hiển thị trên marketplace.",
            name: "Tiêu đề",
            description: "Mô tả",
            price: "Giá bán (VND)",
            quantity: "Số lượng",
            offers: "Cho phép người mua trả giá",
            save: "Lưu thay đổi",
            cancel: "Huỷ",
            loadFailed: "Không thể tải listing này.",
            saveFailed: "Không thể lưu thay đổi.",
            saved: "Đã cập nhật listing",
            unavailable: "Chỉ listing bán ngay đang hoạt động mới có thể chỉnh sửa.",
            descriptionMin: "Mô tả cần ít nhất 300 ký tự.",
        }
        : locale === "ja-JP"
            ? {
                title: "出品を編集",
                subtitle: "マーケットプレイスに表示される情報を更新します。",
                name: "タイトル",
                description: "説明",
                price: "販売価格（VND）",
                quantity: "数量",
                offers: "購入者からの価格交渉を許可",
                save: "変更を保存",
                cancel: "キャンセル",
                loadFailed: "出品を読み込めません。",
                saveFailed: "変更を保存できません。",
                saved: "出品を更新しました",
                unavailable: "有効な即時販売の出品のみ編集できます。",
                descriptionMin: "説明は300文字以上必要です。",
            }
            : {
                title: "Edit listing",
                subtitle: "Update the information shown on the marketplace.",
                name: "Title",
                description: "Description",
                price: "Sale price (VND)",
                quantity: "Quantity",
                offers: "Allow buyers to make offers",
                save: "Save changes",
                cancel: "Cancel",
                loadFailed: "Unable to load this listing.",
                saveFailed: "Unable to save changes.",
                saved: "Listing updated",
                unavailable: "Only active Buy Now listings can be edited.",
                descriptionMin: "Description must be at least 300 characters.",
            };

    useEffect(() => {
        let cancelled = false;
        const loadListing = async () => {
            try {
                const response = await fetch(`/api/marketplace/listings/${id}`, { cache: "no-store" });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || copy.loadFailed);
                if (cancelled) return;
                const next = payload.listing as EditableListing;
                setListing(next);
                setName(next.name);
                setDescription(next.description || "");
                setPrice(String(next.price || ""));
                setQuantity(String(next.quantity || 1));
                setAcceptOffers(!!next.accept_offers);
            } catch (loadError) {
                if (!cancelled) setError(loadError instanceof Error ? loadError.message : copy.loadFailed);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        void loadListing();
        return () => {
            cancelled = true;
        };
    }, [copy.loadFailed, id]);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!listing || isSaving) return;
        if (description.trim().length < 300) {
            toast({ variant: "destructive", title: copy.saveFailed, description: copy.descriptionMin });
            return;
        }
        setIsSaving(true);
        try {
            const response = await fetch(`/api/marketplace/listings/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name,
                    description,
                    price: parsePrice(price),
                    quantity: Number.parseInt(quantity, 10),
                    acceptOffers,
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || copy.saveFailed);
            toast({ title: copy.saved });
            router.push(`/cards/${id}`);
            router.refresh();
        } catch (saveError) {
            toast({
                variant: "destructive",
                title: copy.saveFailed,
                description: saveError instanceof Error ? saveError.message : copy.saveFailed,
            });
        } finally {
            setIsSaving(false);
        }
    };

    const editable = listing?.status === "active" && listing.listing_type === "sale";

    return (
        <div className="flex min-h-screen flex-col bg-background">
            <Header />
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
                <Button variant="ghost" className="mb-5" onClick={() => router.back()}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> {copy.cancel}
                </Button>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-2xl">
                            <Pencil className="h-6 w-6 text-orange-500" /> {copy.title}
                        </CardTitle>
                        <CardDescription>{copy.subtitle}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="flex items-center justify-center py-16 text-muted-foreground">
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            </div>
                        ) : error || !listing ? (
                            <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300">{error || copy.loadFailed}</p>
                        ) : !editable ? (
                            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-300">{copy.unavailable}</p>
                        ) : (
                            <form className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]" onSubmit={handleSubmit}>
                                <div>
                                    <div className="relative aspect-[3/4] overflow-hidden rounded-lg border bg-muted">
                                        {listing.image_url && (
                                            <Image
                                                src={optimizeCloudinaryUrl(listing.image_url, 500)}
                                                alt={listing.name}
                                                fill
                                                sizes="220px"
                                                className="object-contain"
                                            />
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-5">
                                    <div className="space-y-2">
                                        <Label htmlFor="listing-name">{copy.name}</Label>
                                        <Input id="listing-name" value={name} onChange={event => setName(event.target.value)} minLength={5} maxLength={200} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="listing-description">{copy.description}</Label>
                                        <Textarea id="listing-description" value={description} onChange={event => setDescription(event.target.value)} minLength={300} maxLength={5000} required className="min-h-36" />
                                        <p className={`text-right text-xs ${description.trim().length < 300 ? 'text-muted-foreground' : 'text-green-500'}`}>
                                            {description.trim().length}/300
                                        </p>
                                    </div>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label htmlFor="listing-price">{copy.price}</Label>
                                            <Input id="listing-price" value={formatPrice(price)} onChange={event => setPrice(event.target.value)} inputMode="numeric" required />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="listing-quantity">{copy.quantity}</Label>
                                            <Input id="listing-quantity" type="number" min={1} max={100} value={quantity} onChange={event => setQuantity(event.target.value)} required />
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                                        <Label htmlFor="listing-offers" className="cursor-pointer">{copy.offers}</Label>
                                        <Switch id="listing-offers" checked={acceptOffers} onCheckedChange={setAcceptOffers} />
                                    </div>
                                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                                        <Button type="button" variant="outline" onClick={() => router.back()}>{copy.cancel}</Button>
                                        <Button type="submit" disabled={isSaving} className="bg-orange-500 text-white hover:bg-orange-600">
                                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                            {copy.save}
                                        </Button>
                                    </div>
                                </div>
                            </form>
                        )}
                    </CardContent>
                </Card>
            </main>
            <Footer />
        </div>
    );
}
