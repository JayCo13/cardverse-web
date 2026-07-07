"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, FileText, HandCoins, Loader2, Lock, Pencil, Save } from "lucide-react";
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
    min_offer_percent: number | null;
    image_url: string | null;
    image_urls: string[] | null;
    category: string | null;
    condition: string | null;
    publisher: string | null;
    set_name: string | null;
    season: string | null;
    grading_company: string | null;
    grade: number | null;
    finish: string | null;
    card_number: string | null;
    language: string | null;
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
    const [originalDescription, setOriginalDescription] = useState("");
    const [price, setPrice] = useState("");
    const [acceptOffers, setAcceptOffers] = useState(false);
    const [minOfferPercent, setMinOfferPercent] = useState("0");
    const [hasOpenOffers, setHasOpenOffers] = useState(false);
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
            offers: "Cho phép người mua trả giá",
            minOfferPercent: "Mức offer tối thiểu (%)",
            minOfferHint: "Buyer phải offer ít nhất theo tỷ lệ này so với giá bán.",
            save: "Lưu thay đổi",
            cancel: "Huỷ",
            loadFailed: "Không thể tải listing này.",
            saveFailed: "Không thể lưu thay đổi.",
            saved: "Đã cập nhật listing",
            unavailable: "Chỉ listing bán ngay đang hoạt động mới có thể chỉnh sửa.",
            descriptionMin: "Mô tả cần ít nhất 300 ký tự.",
            identityTitle: "Thông tin nhận dạng (chỉ đọc)",
            contentSection: "Nội dung bài đăng",
            commercialSection: "Giá và offer",
            lockedWarning: "Để bảo vệ buyer, ảnh và thông tin nhận dạng thẻ không thể thay đổi sau khi đăng. Nếu thông tin này sai, hãy đóng listing và đăng lại.",
            openOfferWarning: "Listing đang có offer chờ xử lý. Giá và cài đặt offer được khóa cho đến khi offer được xử lý.",
            legacyDescription: "Mô tả cũ dưới 300 ký tự vẫn được giữ nguyên. Nếu thay đổi, mô tả mới phải đủ 300 ký tự.",
            category: "Danh mục", condition: "Tình trạng", publisher: "Nhà phát hành", set: "Set / Bộ thẻ",
            season: "Mùa", grading: "Grading", finish: "Biến thể / Finish", cardNumber: "Số thẻ",
            language: "Ngôn ngữ", quantity: "Số lượng", listingType: "Loại listing", unknown: "Chưa có",
        }
        : locale === "ja-JP"
            ? {
                title: "出品を編集",
                subtitle: "マーケットプレイスに表示される情報を更新します。",
                name: "タイトル",
                description: "説明",
                price: "販売価格（VND）",
                offers: "購入者からの価格交渉を許可",
                minOfferPercent: "最低オファー率（%）",
                minOfferHint: "オファーは販売価格に対してこの割合以上である必要があります。",
                save: "変更を保存",
                cancel: "キャンセル",
                loadFailed: "出品を読み込めません。",
                saveFailed: "変更を保存できません。",
                saved: "出品を更新しました",
                unavailable: "有効な即時販売の出品のみ編集できます。",
                descriptionMin: "説明は300文字以上必要です。",
                identityTitle: "カード識別情報（読み取り専用）",
                contentSection: "出品内容",
                commercialSection: "価格とオファー",
                lockedWarning: "購入者保護のため、出品後は画像とカード識別情報を変更できません。誤りがある場合は出品を終了し、再出品してください。",
                openOfferWarning: "未処理のオファーがあるため、価格とオファー設定は処理完了までロックされます。",
                legacyDescription: "300文字未満の旧説明はそのまま保存できます。変更する場合は300文字以上が必要です。",
                category: "カテゴリー", condition: "状態", publisher: "メーカー", set: "セット",
                season: "シーズン", grading: "グレーディング", finish: "バリエーション / Finish", cardNumber: "カード番号",
                language: "言語", quantity: "数量", listingType: "出品タイプ", unknown: "未設定",
            }
            : {
                title: "Edit listing",
                subtitle: "Update the information shown on the marketplace.",
                name: "Title",
                description: "Description",
                price: "Sale price (VND)",
                offers: "Allow buyers to make offers",
                minOfferPercent: "Minimum offer (%)",
                minOfferHint: "Buyers must offer at least this percentage of the sale price.",
                save: "Save changes",
                cancel: "Cancel",
                loadFailed: "Unable to load this listing.",
                saveFailed: "Unable to save changes.",
                saved: "Listing updated",
                unavailable: "Only active Buy Now listings can be edited.",
                descriptionMin: "Description must be at least 300 characters.",
                identityTitle: "Card identity (read-only)",
                contentSection: "Listing content",
                commercialSection: "Price and offers",
                lockedWarning: "To protect buyers, images and card identity cannot be changed after publishing. If these details are wrong, close the listing and create a new one.",
                openOfferWarning: "This listing has an open offer. Price and offer settings are locked until the offer is resolved.",
                legacyDescription: "A legacy description under 300 characters may remain unchanged. If edited, the new description must contain at least 300 characters.",
                category: "Category", condition: "Condition", publisher: "Publisher", set: "Set",
                season: "Season", grading: "Grading", finish: "Variant / Finish", cardNumber: "Card number",
                language: "Language", quantity: "Quantity", listingType: "Listing type", unknown: "Not specified",
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
                const nextDescription = next.description || "";
                setDescription(nextDescription);
                setOriginalDescription(nextDescription);
                setPrice(String(next.price || ""));
                setAcceptOffers(!!next.accept_offers);
                setMinOfferPercent(String(next.min_offer_percent || 0));
                setHasOpenOffers(Boolean(payload.hasOpenOffers));
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
        const descriptionChanged = description.trim() !== originalDescription.trim();
        if (descriptionChanged && description.trim().length < 300) {
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
                    acceptOffers,
                    minOfferPercent: Number.parseFloat(minOfferPercent) || 0,
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
    const identityItems = listing ? [
        { label: copy.listingType, value: listing.listing_type },
        { label: copy.category, value: listing.category },
        { label: copy.condition, value: listing.condition },
        { label: copy.publisher, value: listing.publisher },
        { label: copy.set, value: listing.set_name },
        { label: copy.season, value: listing.season },
        {
            label: copy.grading,
            value: listing.grading_company
                ? `${listing.grading_company.toUpperCase()}${listing.grade != null ? ` ${listing.grade}` : ""}`
                : null,
        },
        { label: copy.finish, value: listing.finish },
        { label: copy.cardNumber, value: listing.card_number },
        { label: copy.language, value: listing.language?.toUpperCase() },
        { label: copy.quantity, value: String(listing.quantity || 1) },
    ] : [];

    return (
        <div className="flex min-h-screen flex-col bg-background">
            <Header />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:py-10">
                <Button variant="ghost" className="mb-5 rounded-full px-4 text-muted-foreground hover:text-foreground" onClick={() => router.back()}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> {copy.cancel}
                </Button>

                <Card className="overflow-hidden border-white/10 bg-card/80 shadow-2xl shadow-black/20">
                    <CardHeader className="border-b border-white/10 bg-gradient-to-r from-orange-500/10 via-transparent to-transparent px-6 py-6 sm:px-8">
                        <CardTitle className="flex items-center gap-3 text-2xl sm:text-3xl">
                            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/25">
                                <Pencil className="h-5 w-5" />
                            </span>
                            {copy.title}
                        </CardTitle>
                        <CardDescription className="pl-14 text-sm sm:text-base">{copy.subtitle}</CardDescription>
                    </CardHeader>
                    <CardContent className="p-5 sm:p-8">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-16 text-muted-foreground">
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            </div>
                        ) : error || !listing ? (
                            <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300">{error || copy.loadFailed}</p>
                        ) : !editable ? (
                            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-300">{copy.unavailable}</p>
                        ) : (
                            <form className="grid gap-7 lg:grid-cols-[300px_minmax(0,1fr)]" onSubmit={handleSubmit}>
                                <div className="space-y-3 lg:col-span-2">
                                    <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/12 to-amber-500/5 p-4 text-sm text-amber-100 shadow-sm">
                                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                                        <p className="leading-relaxed">{copy.lockedWarning}</p>
                                    </div>
                                    {hasOpenOffers && (
                                        <div className="flex gap-3 rounded-xl border border-orange-500/30 bg-gradient-to-r from-orange-500/15 to-orange-500/5 p-4 text-sm text-orange-100 shadow-sm">
                                            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
                                            <p className="leading-relaxed">{copy.openOfferWarning}</p>
                                        </div>
                                    )}
                                </div>

                                <aside className="space-y-4 self-start lg:sticky lg:top-24">
                                    <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-white/10 bg-black/30 shadow-xl shadow-black/25">
                                        {listing.image_url && (
                                            <Image
                                                src={optimizeCloudinaryUrl(listing.image_url, 500)}
                                                alt={listing.name}
                                                fill
                                                sizes="300px"
                                                className="object-contain p-2"
                                            />
                                        )}
                                    </div>

                                    <div className="rounded-2xl border border-white/10 bg-muted/15 p-5 shadow-sm">
                                        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                                            <Lock className="h-4 w-4 text-amber-400" />
                                            {copy.identityTitle}
                                        </h3>
                                        <dl className="divide-y divide-white/5">
                                            {identityItems.map(item => (
                                                <div key={item.label} className="flex items-start justify-between gap-3 py-2.5 text-xs first:pt-0 last:pb-0">
                                                    <dt className="text-muted-foreground">{item.label}</dt>
                                                    <dd className="max-w-[58%] text-right font-medium leading-relaxed text-foreground/90">{item.value || copy.unknown}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                    </div>
                                </aside>

                                <div className="space-y-5">
                                    <section className="rounded-2xl border border-white/10 bg-background/35 p-5 shadow-sm sm:p-6">
                                        <h3 className="mb-5 flex items-center gap-2 text-lg font-semibold">
                                            <FileText className="h-5 w-5 text-orange-400" />
                                            {copy.contentSection}
                                        </h3>
                                        <div className="space-y-5">
                                            <div className="space-y-2">
                                                <Label htmlFor="listing-name" className="text-sm font-medium">{copy.name}</Label>
                                                <Input id="listing-name" value={name} onChange={event => setName(event.target.value)} minLength={5} maxLength={200} required className="h-11 bg-background/60" />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="listing-description" className="text-sm font-medium">{copy.description}</Label>
                                                <Textarea id="listing-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={5000} required className="min-h-44 resize-y bg-background/60" />
                                                <div className="flex items-start justify-between gap-3 text-xs">
                                                    {originalDescription.trim().length < 300 && description.trim() === originalDescription.trim() ? (
                                                        <p className="leading-relaxed text-amber-300">{copy.legacyDescription}</p>
                                                    ) : <span />}
                                                    <p className={`shrink-0 rounded-full px-2 py-0.5 ${description.trim().length < 300 ? 'bg-white/5 text-muted-foreground' : 'bg-green-500/10 text-green-400'}`}>
                                                        {description.trim().length}/300
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="rounded-2xl border border-white/10 bg-background/35 p-5 shadow-sm sm:p-6">
                                        <h3 className="mb-5 flex items-center gap-2 text-lg font-semibold">
                                            <HandCoins className="h-5 w-5 text-orange-400" />
                                            {copy.commercialSection}
                                        </h3>
                                        <div className="space-y-4">
                                            <div className="space-y-2">
                                                <Label htmlFor="listing-price" className="text-sm font-medium">{copy.price}</Label>
                                                <Input id="listing-price" value={formatPrice(price)} onChange={event => setPrice(event.target.value)} inputMode="numeric" disabled={hasOpenOffers} required className="h-12 bg-background/60 text-lg font-semibold" />
                                            </div>
                                            <div className={`flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors ${acceptOffers ? 'border-orange-500/30 bg-orange-500/5' : 'border-white/10 bg-background/30'}`}>
                                                <Label htmlFor="listing-offers" className="cursor-pointer text-sm font-medium">{copy.offers}</Label>
                                                <Switch id="listing-offers" checked={acceptOffers} onCheckedChange={setAcceptOffers} disabled={hasOpenOffers} />
                                            </div>
                                            {acceptOffers && (
                                                <div className="space-y-2 rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
                                                    <Label htmlFor="listing-min-offer">{copy.minOfferPercent}</Label>
                                                    <div className="relative">
                                                        <Input
                                                            id="listing-min-offer"
                                                            type="number"
                                                            min={0}
                                                            max={100}
                                                            step={1}
                                                            value={minOfferPercent}
                                                            onChange={event => setMinOfferPercent(event.target.value)}
                                                            disabled={hasOpenOffers}
                                                            className="h-11 bg-background/60 pr-10 font-semibold"
                                                        />
                                                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                                                    </div>
                                                    <p className="text-xs leading-relaxed text-muted-foreground">{copy.minOfferHint}</p>
                                                </div>
                                            )}
                                        </div>
                                    </section>

                                    <div className="flex flex-col-reverse gap-3 rounded-2xl border border-white/10 bg-background/35 p-4 sm:flex-row sm:items-center sm:justify-end">
                                        <Button type="button" variant="outline" className="min-w-28" onClick={() => router.back()}>{copy.cancel}</Button>
                                        <Button type="submit" disabled={isSaving} className="min-w-40 bg-orange-500 text-white shadow-lg shadow-orange-500/15 hover:bg-orange-600">
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
