"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from '@/lib/listing-description';
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ChevronDown, FileText, HandCoins, Loader2, Lock, Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
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

// Imported rather than repeated: this page and /sell/create held different
// numbers once already, which left a description long enough to publish a
// listing and too short to edit it.

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
    const [minOfferPercent, setMinOfferPercent] = useState(0);
    const [hasOpenOffers, setHasOpenOffers] = useState(false);
    const [openOfferCount, setOpenOfferCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const saveLockRef = useRef(false);
    // Only the phone layout uses this; the desktop sidebar shows the list outright.
    const [showLockedIdentity, setShowLockedIdentity] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const copy = locale === "vi-VN"
        ? {
            title: "Chỉnh sửa listing",
            subtitle: "Cập nhật thông tin đang hiển thị trên marketplace.",
            name: "Tiêu đề",
            description: "Mô tả",
            price: "Giá bán (VND)",
            offers: "Cho phép người mua trả giá",
            minOfferPercent: "Không nhận offer dưới",
            acceptAllOffers: "Nhận mọi offer",
            nearOriginalPrice: "Chỉ nhận gần giá gốc",
            save: "Lưu thay đổi",
            saving: "Đang lưu...",
            cancel: "Huỷ",
            loadFailed: "Không thể tải listing này.",
            saveFailed: "Không thể lưu thay đổi.",
            saved: "Đã cập nhật listing",
            unavailable: "Chỉ listing bán ngay đang hoạt động mới có thể chỉnh sửa.",
            descriptionMin: `Mô tả cần ít nhất ${DESCRIPTION_MIN} ký tự.`,
            descriptionMax: `Mô tả không được quá ${DESCRIPTION_MAX} ký tự.`,
            identityTitle: "Thông tin nhận dạng (chỉ đọc)",
            contentSection: "Nội dung bài đăng",
            commercialSection: "Giá và offer",
            lockedWarning: "Để bảo vệ buyer, ảnh và thông tin nhận dạng thẻ không thể thay đổi sau khi đăng. Nếu thông tin này sai, hãy đóng listing và đăng lại.",
            openOfferTitle: "Giá và cài đặt offer đang bị khóa",
            openOfferWarning: "Listing này đang có offer chờ xử lý. Bạn vẫn có thể sửa tiêu đề và mô tả. Nếu các offer được từ chối, hủy hoặc hết hạn, giá và cài đặt offer sẽ được mở lại; nếu một offer được chấp nhận, listing sẽ chuyển sang giao dịch.",
            viewOffers: "Xem và xử lý offer ({count})",
            legacyDescription: `Mô tả cũ ngắn hơn vẫn được giữ nguyên. Nếu thay đổi, mô tả mới phải đủ ${DESCRIPTION_MIN} ký tự.`,
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
                minOfferPercent: "この割合未満のオファーを受け付けない",
                acceptAllOffers: "すべてのオファーを受け付ける",
                nearOriginalPrice: "販売価格に近いオファーのみ",
                save: "変更を保存",
                saving: "保存中...",
                cancel: "キャンセル",
                loadFailed: "出品を読み込めません。",
                saveFailed: "変更を保存できません。",
                saved: "出品を更新しました",
                unavailable: "有効な即時販売の出品のみ編集できます。",
                descriptionMin: `説明は${DESCRIPTION_MIN}文字以上必要です。`,
                descriptionMax: `説明は${DESCRIPTION_MAX}文字以内にしてください。`,
                identityTitle: "カード識別情報（読み取り専用）",
                contentSection: "出品内容",
                commercialSection: "価格とオファー",
                lockedWarning: "購入者保護のため、出品後は画像とカード識別情報を変更できません。誤りがある場合は出品を終了し、再出品してください。",
                openOfferTitle: "価格とオファー設定はロックされています",
                openOfferWarning: "この出品には処理待ちのオファーがあります。タイトルと説明は引き続き編集できます。オファーが拒否、キャンセル、または期限切れになると設定が再び編集可能になり、承認された場合は取引に進みます。",
                viewOffers: "オファーを確認・管理 ({count})",
                legacyDescription: `短い旧説明はそのまま保存できます。変更する場合は${DESCRIPTION_MIN}文字以上が必要です。`,
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
                minOfferPercent: "Do not accept offers below",
                acceptAllOffers: "Accept all offers",
                nearOriginalPrice: "Only near the asking price",
                save: "Save changes",
                saving: "Saving...",
                cancel: "Cancel",
                loadFailed: "Unable to load this listing.",
                saveFailed: "Unable to save changes.",
                saved: "Listing updated",
                unavailable: "Only active Buy Now listings can be edited.",
                descriptionMin: `Description must be at least ${DESCRIPTION_MIN} characters.`,
                descriptionMax: `Description must be at most ${DESCRIPTION_MAX} characters.`,
                identityTitle: "Card identity (read-only)",
                contentSection: "Listing content",
                commercialSection: "Price and offers",
                lockedWarning: "To protect buyers, images and card identity cannot be changed after publishing. If these details are wrong, close the listing and create a new one.",
                openOfferTitle: "Price and offer settings are locked",
                openOfferWarning: "This listing has an offer awaiting resolution. You can still edit its title and description. Price and offer settings unlock if the offers are rejected, cancelled, or expire; accepting one moves the listing into a transaction.",
                viewOffers: "View and manage offers ({count})",
                legacyDescription: `A shorter legacy description may remain unchanged. If edited, the new description must contain at least ${DESCRIPTION_MIN} characters.`,
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
                setMinOfferPercent(Math.min(99, Math.max(0, next.min_offer_percent || 0)));
                setHasOpenOffers(Boolean(payload.hasOpenOffers));
                setOpenOfferCount(Number(payload.openOfferCount) || 0);
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
        if (!listing || saveLockRef.current) return;
        const descriptionChanged = description.trim() !== originalDescription.trim();
        if (descriptionChanged && description.trim().length < DESCRIPTION_MIN) {
            toast({ variant: "destructive", title: copy.saveFailed, description: copy.descriptionMin });
            return;
        }
        if (description.trim().length > DESCRIPTION_MAX) {
            toast({ variant: "destructive", title: copy.saveFailed, description: copy.descriptionMax });
            return;
        }
        saveLockRef.current = true;
        setIsSaving(true);
        let saved = false;
        try {
            const response = await fetch(`/api/marketplace/listings/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name,
                    description,
                    price: parsePrice(price),
                    acceptOffers,
                    minOfferPercent,
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || copy.saveFailed);
            toast({ title: copy.saved });
            saved = true;
            router.push(`/cards/${id}`);
            router.refresh();
        } catch (saveError) {
            toast({
                variant: "destructive",
                title: copy.saveFailed,
                description: saveError instanceof Error ? saveError.message : copy.saveFailed,
            });
        } finally {
            if (!saved) {
                saveLockRef.current = false;
                setIsSaving(false);
            }
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

    // The same rows serve the desktop sidebar and the collapsed panel a phone
    // gets, so the locked list is only described once.
    const identityRows = identityItems.map(item => (
        <div key={item.label} className="flex items-start justify-between gap-3 py-2.5 text-xs first:pt-0 last:pb-0">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className="max-w-[58%] text-right font-medium leading-relaxed text-foreground/90">{item.value || copy.unknown}</dd>
        </div>
    ));

    // Enough of the card's identity to recognise it at a glance, for the strip
    // that stands in for the full sidebar on a phone.
    const identitySummary = identityItems
        .filter(item => item.value)
        .slice(0, 3)
        .map(item => item.value)
        .join(" · ");

    return (
        <div className="flex flex-1 flex-col bg-background">
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
                            <form className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-7" onSubmit={handleSubmit}>
                                <div className="space-y-3 lg:col-span-2">
                                    <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/12 to-amber-500/5 p-4 text-sm text-amber-100 shadow-sm">
                                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                                        <p className="leading-relaxed">{copy.lockedWarning}</p>
                                    </div>
                                </div>

                                {/* On a phone this stack collapses into one column, which
                                    put a 421px card image and eleven locked rows between
                                    the seller and the two fields they came to change. The
                                    strip below carries the same identity in 96px and keeps
                                    the full list one tap away; the sidebar it replaces
                                    still runs unchanged from lg up. */}
                                <div className="space-y-3 lg:hidden">
                                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-muted/15 p-3 shadow-sm">
                                        <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                                            {listing.image_url && (
                                                <Image
                                                    src={optimizeCloudinaryUrl(listing.image_url, 200)}
                                                    alt={listing.name}
                                                    fill
                                                    sizes="64px"
                                                    className="object-contain p-1"
                                                />
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold">{listing.name}</p>
                                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{identitySummary}</p>
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-white/10 bg-muted/15 shadow-sm">
                                        <button
                                            type="button"
                                            onClick={() => setShowLockedIdentity(open => !open)}
                                            aria-expanded={showLockedIdentity}
                                            className="flex w-full items-center gap-2 p-4 text-left text-sm font-semibold"
                                        >
                                            <Lock className="h-4 w-4 shrink-0 text-amber-400" />
                                            <span className="min-w-0 flex-1 truncate">{copy.identityTitle}</span>
                                            <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${showLockedIdentity ? "rotate-180" : ""}`} />
                                        </button>
                                        {showLockedIdentity && <dl className="divide-y divide-white/5 px-4 pb-4">{identityRows}</dl>}
                                    </div>
                                </div>

                                <aside className="hidden space-y-4 self-start lg:block lg:sticky lg:top-24">
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
                                        <dl className="divide-y divide-white/5">{identityRows}</dl>
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
                                                <Textarea id="listing-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={DESCRIPTION_MAX} required className="min-h-44 resize-y bg-background/60" />
                                                <div className="flex items-start justify-between gap-3 text-xs">
                                                    {originalDescription.trim().length < DESCRIPTION_MIN && description.trim() === originalDescription.trim() ? (
                                                        <p className="leading-relaxed text-amber-300">{copy.legacyDescription}</p>
                                                    ) : <span />}
                                                    <p className={`shrink-0 rounded-full px-2 py-0.5 ${description.trim().length < DESCRIPTION_MIN ? 'bg-white/5 text-muted-foreground' : 'bg-green-500/10 text-green-400'}`}>
                                                        {description.trim().length}/{DESCRIPTION_MAX}
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
                                            {hasOpenOffers && (
                                                <div className="flex gap-3 rounded-xl border border-orange-500/35 bg-orange-500/10 p-4 text-sm shadow-sm" role="status">
                                                    <Lock className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
                                                    <div className="space-y-1">
                                                        <p className="font-semibold text-orange-200">{copy.openOfferTitle}</p>
                                                        <p className="leading-relaxed text-muted-foreground">{copy.openOfferWarning}</p>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => router.push(`/offers?view=received&cardId=${id}`)}
                                                            className="mt-3 min-h-10 border-orange-500/40 text-orange-300 hover:bg-orange-500/10 hover:text-orange-200"
                                                        >
                                                            <HandCoins className="mr-1.5 h-4 w-4" />
                                                            {copy.viewOffers.replace("{count}", String(openOfferCount))}
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}
                                            <div className="space-y-2">
                                                <Label htmlFor="listing-price" className="text-sm font-medium">{copy.price}</Label>
                                                <Input id="listing-price" value={formatPrice(price)} onChange={event => setPrice(event.target.value)} inputMode="numeric" disabled={hasOpenOffers} required className="h-12 bg-background/60 text-lg font-semibold" />
                                            </div>
                                            <div className={`flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors ${acceptOffers ? 'border-orange-500/30 bg-orange-500/5' : 'border-white/10 bg-background/30'}`}>
                                                <Label htmlFor="listing-offers" className="cursor-pointer text-sm font-medium">{copy.offers}</Label>
                                                <Switch id="listing-offers" checked={acceptOffers} onCheckedChange={setAcceptOffers} disabled={hasOpenOffers} />
                                            </div>
                                            {acceptOffers && (
                                                <div className="space-y-3 rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
                                                    <div className="flex items-center justify-between gap-4">
                                                        <Label htmlFor="listing-min-offer" className="text-sm font-medium">{copy.minOfferPercent}</Label>
                                                        <div className="flex items-center gap-1.5" aria-live="polite">
                                                            <span className="text-2xl font-bold tabular-nums text-amber-500">{minOfferPercent}</span>
                                                            <span className="text-sm font-semibold text-muted-foreground">%</span>
                                                        </div>
                                                    </div>
                                                    <Slider
                                                        id="listing-min-offer"
                                                        min={0}
                                                        max={99}
                                                        step={5}
                                                        value={[minOfferPercent]}
                                                        onValueChange={value => setMinOfferPercent(value[0])}
                                                        disabled={hasOpenOffers}
                                                        aria-label={copy.minOfferPercent}
                                                        className="py-1 [&_[role=slider]]:border-amber-600 [&_[role=slider]]:bg-amber-500"
                                                    />
                                                    <div className="flex justify-between gap-4 text-[11px] text-muted-foreground">
                                                        <span>{copy.acceptAllOffers}</span>
                                                        <span className="text-right">{copy.nearOriginalPrice}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </section>

                                    <div className="flex flex-col-reverse gap-3 rounded-2xl border border-white/10 bg-background/35 p-4 sm:flex-row sm:items-center sm:justify-end">
                                        <Button type="button" variant="outline" className="min-w-28" onClick={() => router.back()}>{copy.cancel}</Button>
                                        <Button type="submit" loading={isSaving} className="min-w-40 bg-orange-500 text-white shadow-lg shadow-orange-500/15 hover:bg-orange-600">
                                            {isSaving ? null : <Save className="mr-2 h-4 w-4" />}
                                            {isSaving ? copy.saving : copy.save}
                                        </Button>
                                    </div>
                                </div>
                            </form>
                        )}
                    </CardContent>
                </Card>
            </main>
        </div>
    );
}
