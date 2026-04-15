
'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useLocalization } from '@/context/localization-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, ShieldAlert, X, Loader2, Info, HandCoins, Plus, Trash2, Layers } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useSupabase, useUser } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { uploadImageToCloudinary } from '@/lib/cloudinary';
import {
  getCategories,
  getCategoryConfig,
  getPublishers,
  getStaticSets,
  getSeasons,
  isSinglePublisher,
  isFreeText,
  isDbSets,
  fetchDbSetsGrouped,
  type SetConfig,
  type GroupedSets,
} from '@/lib/card-catalog';
import { CardPickerDialog, type SelectedCatalogCard } from '@/components/card-picker-dialog';
import { SearchableSetPicker } from '@/components/searchable-set-picker';

/** Individual card in a bundle */
interface BundleItem {
  id: string;
  title: string;
  price: number | undefined;
}

const getFormSchema = (t: (key: string) => string) => z.object({
  name: z.string().min(5, { message: "Title must be at least 5 characters." }),
  isBundle: z.boolean().default(false),
  category: z.string({ required_error: "Please select a category." }),
  publisher: z.string({ required_error: "Please select a publisher." }),
  setName: z.string().optional(),
  season: z.string().optional(),
  quantity: z.preprocess(
    (a) => {
      if (typeof a === 'number') return a;
      if (typeof a === 'string') return parseInt(a, 10) || 1;
      return 1;
    },
    z.number().positive().default(1)
  ),
  condition: z.string().optional(),
  isPsaGraded: z.boolean().default(false),
  psaGrade: z.number().min(1).max(10).optional(),
  listingType: z.enum(['sale', 'auction', 'razz']),
  price: z.preprocess(
    (a) => a ? parseFloat(z.string().parse(a)) : undefined,
    z.number().positive().optional()
  ),
  startingBid: z.preprocess(
    (a) => a ? parseFloat(z.string().parse(a)) : undefined,
    z.number().positive().optional()
  ),
  auctionEnds: z.string().optional(),
  ticketPrice: z.preprocess(
    (a) => a ? parseFloat(z.string().parse(a)) : undefined,
    z.number().positive().optional()
  ),
  totalTickets: z.preprocess(
    (a) => a ? parseInt(z.string().parse(a), 10) : undefined,
    z.number().positive().optional()
  ),
  description: z.string().min(10, { message: "Description must be at least 10 characters." }),
  images: z.array(z.instanceof(File)).min(1, "Please upload at least one image.").max(4, "You can upload a maximum of 4 images."),
  // Offer settings
  acceptOffers: z.boolean().default(false),
  minOfferPercent: z.preprocess(
    (a) => {
      if (typeof a === 'number') return a;
      if (typeof a === 'string') return parseInt(a, 10) || 0;
      return 0;
    },
    z.number().min(0).max(99).default(0)
  ),
  // Free text fallbacks for "Khác" category
  freePublisher: z.string().optional(),
  freeSetName: z.string().optional(),
  freeSeason: z.string().optional(),
}).refine(data => {
  if (data.listingType === 'sale') return data.price !== undefined;
  return true;
}, { message: "Price is required for 'Buy Now' listings.", path: ['price'] })
  .refine(data => {
    if (data.listingType === 'auction') return data.startingBid !== undefined && data.auctionEnds !== undefined;
    return true;
  }, { message: "Starting bid and end date are required for auctions.", path: ['startingBid'] })
  .refine(data => {
    if (data.listingType === 'razz') return data.ticketPrice !== undefined && data.totalTickets !== undefined;
    return true;
  }, { message: "Ticket price and total tickets are required for razz listings.", path: ['ticketPrice'] })
  .refine(data => {
    if (data.isPsaGraded) return data.psaGrade !== undefined;
    return true;
  }, { message: "PSA Grade is required when PSA Graded is selected.", path: ['psaGrade'] })
  .refine(data => {
    if (!data.isPsaGraded) return data.condition !== undefined && data.condition !== null && data.condition !== '';
    return true;
  }, { message: "Condition is required if not PSA Graded.", path: ['condition'] });


export default function CreateListingPage() {
  const { t, locale } = useLocalization();
  const { user } = useUser();
  const { setOpen } = useAuthModal();
  const router = useRouter();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const supabase = useSupabase();

  const formSchema = getFormSchema(t);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      listingType: 'sale',
      isPsaGraded: false,
      description: "",
      images: [],
      price: undefined,
      startingBid: undefined,
      auctionEnds: undefined,
      ticketPrice: undefined,
      totalTickets: undefined,
      condition: undefined,
      psaGrade: 10,
      publisher: undefined,
      setName: "",
      season: "",
      quantity: 1,
      isBundle: false,
      acceptOffers: false,
      minOfferPercent: 0,
      freePublisher: "",
      freeSetName: "",
      freeSeason: "",
    },
  });

  const listingType = form.watch('listingType');
  const isPsaGraded = form.watch('isPsaGraded');
  const images = form.watch('images');
  const selectedCategory = form.watch('category');
  const selectedPublisher = form.watch('publisher');
  const acceptOffers = form.watch('acceptOffers');
  const watchedPrice = form.watch('price');
  const isBundle = form.watch('isBundle');

  // Bundle items state (managed outside react-hook-form for flexibility)
  const [bundleItems, setBundleItems] = useState<BundleItem[]>([
    { id: crypto.randomUUID(), title: '', price: undefined },
    { id: crypto.randomUUID(), title: '', price: undefined },
  ]);

  const addBundleItem = () => {
    setBundleItems(prev => [...prev, { id: crypto.randomUUID(), title: '', price: undefined }]);
  };

  const removeBundleItem = (id: string) => {
    if (bundleItems.length <= 2) return; // minimum 2 items in a bundle
    setBundleItems(prev => prev.filter(item => item.id !== id));
  };

  const updateBundleItem = (id: string, field: 'title' | 'price', value: string) => {
    setBundleItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      if (field === 'price') {
        return { ...item, price: value ? parseFloat(value) : undefined };
      }
      return { ...item, [field]: value };
    }));
  };

  // Computed bundle price range
  const bundlePriceRange = (() => {
    const prices = bundleItems.map(i => i.price).filter((p): p is number => p !== undefined && p > 0);
    if (prices.length === 0) return null;
    return { min: Math.min(...prices), max: Math.max(...prices), total: prices.reduce((a, b) => a + b, 0) };
  })();

  // DB-driven sets state
  const [dbGroupedSets, setDbGroupedSets] = useState<GroupedSets>({ en: [], jp: [], other: [] });
  const [loadingDbSets, setLoadingDbSets] = useState(false);

  // Derived state from catalog
  const categoryConfig = selectedCategory ? getCategoryConfig(selectedCategory) : undefined;
  const availablePublishers = selectedCategory ? getPublishers(selectedCategory) : [];
  const staticSets = selectedCategory ? getStaticSets(selectedCategory, selectedPublisher) : [];
  const useDbSets = selectedCategory ? isDbSets(selectedCategory) : false;
  const availableSeasons = selectedCategory ? getSeasons(selectedCategory) : [];
  const singlePublisher = selectedCategory ? isSinglePublisher(selectedCategory) : false;
  const freeTextMode = selectedCategory ? isFreeText(selectedCategory) : false;

  useEffect(() => {
    if (!user) {
      setOpen(true);
    }
  }, [user, setOpen]);

  useEffect(() => {
    if (isPsaGraded) {
      form.setValue('condition', 'PSA Graded');
      form.clearErrors('condition');
    } else {
      if (form.getValues('condition') === 'PSA Graded') {
        form.setValue('condition', undefined);
      }
    }
  }, [isPsaGraded, form]);

  // Handle category change: reset fields, auto-set publisher, fetch DB sets
  const prevCategoryRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selectedCategory === prevCategoryRef.current) return;
    prevCategoryRef.current = selectedCategory;

    if (!selectedCategory) return;

    // Reset dependent fields
    form.setValue('setName', undefined);
    form.setValue('season', undefined);

    // Auto-set publisher for single-publisher categories
    const pubs = getPublishers(selectedCategory);
    if (pubs.length === 1) {
      form.setValue('publisher', pubs[0]);
    }

    // Fetch DB-driven sets (Pokemon, One Piece)
    if (isDbSets(selectedCategory)) {
      setLoadingDbSets(true);
      fetchDbSetsGrouped(selectedCategory).then(grouped => {
        setDbGroupedSets(grouped);
        setLoadingDbSets(false);
      });
    } else {
      setDbGroupedSets({ en: [], jp: [], other: [] });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory]);

  // When publisher changes (for multi-publisher categories like Soccer), reset set
  const prevPublisherRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selectedPublisher === prevPublisherRef.current) return;
    prevPublisherRef.current = selectedPublisher;
    // Only reset set if publisher actually changed by user (not auto-set)
    if (selectedPublisher && !isSinglePublisher(selectedCategory)) {
      form.setValue('setName', undefined);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPublisher]);

  const categories = getCategories(locale);

  const conditions = locale === 'en-US'
    ? ['Mint', 'Near Mint', 'Excellent', 'Good', 'Played']
    : ['Hoàn hảo', 'Gần như mới', 'Tuyệt vời', 'Tốt', 'Đã qua sử dụng'];

  const handleFiles = (files: FileList | null) => {
    if (files) {
      const newFiles = Array.from(files);
      const currentFiles = form.getValues('images') || [];
      const combined = [...currentFiles, ...newFiles].slice(0, 4);
      form.setValue('images', combined, { shouldValidate: true });
    }
  };

  /** Handle card picked from the collection dialog — auto-fill form fields */
  const handleCardPicked = (card: SelectedCatalogCard) => {
    // Set category (this triggers the useEffect to fetch sets)
    form.setValue('category', card.category);
    prevCategoryRef.current = card.category;

    // Set publisher
    form.setValue('publisher', card.publisher);

    // Set name
    form.setValue('name', card.name);

    // Set the set name (with slight delay to let category effect settle)
    setTimeout(() => {
      form.setValue('setName', card.setName);
    }, 100);

    // Fetch DB sets for the selected category
    if (isDbSets(card.category)) {
      setLoadingDbSets(true);
      fetchDbSetsGrouped(card.category).then(grouped => {
        setDbGroupedSets(grouped);
        setLoadingDbSets(false);
        // Set the setName after data is loaded
        form.setValue('setName', card.setName);
      });
    }

    toast({
      title: '✅ Đã điền thông tin',
      description: `${card.name} — ${card.setName}`,
    });
  };

  const removeImage = (index: number) => {
    const currentFiles = form.getValues('images') || [];
    const newFiles = currentFiles.filter((_, i) => i !== index);
    form.setValue('images', newFiles, { shouldValidate: true });
  };

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!user) {
      setOpen(true);
      return;
    }
    setIsSubmitting(true);

    try {
      // Upload all images to Cloudinary
      const uploadedUrls: string[] = [];
      for (const image of values.images) {
        const formData = new FormData();
        formData.append('file', image);
        const uploadResult = await uploadImageToCloudinary(formData);

        if (!uploadResult.success || !uploadResult.url) {
          throw new Error(uploadResult.error || 'Failed to upload image');
        }
        uploadedUrls.push(uploadResult.url);
      }

      const finalCondition = values.isPsaGraded
        ? `PSA ${values.psaGrade}`
        : values.condition;

      // Resolve publisher/set/season — either from dropdowns or free text
      const resolvedPublisher = freeTextMode
        ? (values.freePublisher || 'Khác')
        : values.publisher;
      const resolvedSetName = freeTextMode
        ? (values.freeSetName || '')
        : (values.setName || '');
      const resolvedSeason = freeTextMode
        ? (values.freeSeason || '')
        : (values.season || '');

      // Bundle validation
      if (values.isBundle) {
        const validItems = bundleItems.filter(i => i.title.trim() && i.price && i.price > 0);
        if (validItems.length < 2) {
          toast({
            variant: 'destructive',
            title: 'Lỗi',
            description: 'Bán nhiều thẻ cần ít nhất 2 thẻ với đầy đủ tên và giá.',
          });
          setIsSubmitting(false);
          return;
        }
      }

      const cardData: any = {
        seller_id: user.id,
        name: values.name,
        category: values.category,
        condition: finalCondition,
        description: values.description,
        listing_type: values.listingType,
        image_url: uploadedUrls[0],
        image_urls: uploadedUrls,
        publisher: resolvedPublisher,
        set_name: resolvedSetName,
        season: resolvedSeason,
        quantity: values.isBundle ? bundleItems.filter(i => i.title.trim()).length : (values.quantity || 1),
        status: 'active',
      };

      // Add offer fields if enabled
      if (values.acceptOffers) {
        cardData.accept_offers = true;
        cardData.min_offer_percent = values.minOfferPercent || 0;
      }

      // Add bundle fields if enabled
      if (values.isBundle) {
        cardData.is_bundle = true;
        cardData.bundle_items = bundleItems
          .filter(i => i.title.trim() && i.price && i.price > 0)
          .map(i => ({ title: i.title, price: i.price }));
      }

      if (values.listingType === 'sale') {
        cardData.price = values.price;
      } else if (values.listingType === 'auction') {
        cardData.current_bid = values.startingBid;
        cardData.starting_bid = values.startingBid;
        cardData.auction_ends = new Date(values.auctionEnds!).toISOString();
      } else if (values.listingType === 'razz') {
        cardData.ticket_price = values.ticketPrice;
        cardData.total_tickets = values.totalTickets;
        cardData.razz_entries = 0;
      }

      const { error: insertError } = await supabase.from('cards').insert(cardData);

      if (insertError) {
        console.error('Supabase insert error:', insertError);
        throw new Error(insertError.message);
      }

      toast({
        title: "Đăng bán thành công!",
        description: "Thẻ của bạn đã được đăng trên chợ.",
      });

      router.push('/buy');

    } catch (error: any) {
      console.error("Error creating listing: ", error);
      toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: error.message || "There was a problem creating your listing.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const renderContent = () => {
    if (!user) {
      return (
        <div className="flex flex-col items-center justify-center text-center py-16">
          <ShieldAlert className="h-16 w-16 text-primary mb-4" />
          <h2 className="text-2xl font-semibold mb-2">{t('auth_required_title')}</h2>
          <p className="text-muted-foreground">{t('auth_required_desc')}</p>
        </div>
      );
    }

    return (
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit, (errors) => {
          console.log('Form validation errors:', errors);
        })} className="space-y-8">

          {/* ─── Quick Fill from Collection ─── */}
          <div className="flex items-center gap-4 p-4 rounded-xl border border-dashed border-primary/30 bg-primary/5">
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-primary">Điền nhanh từ bộ sưu tập</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Chọn thẻ từ bộ sưu tập của bạn để tự động điền thông tin</p>
            </div>
            <CardPickerDialog onSelect={handleCardPicked} />
          </div>

          {/* ─── Bundle Toggle ─── */}
          <FormField
            control={form.control}
            name="isBundle"
            render={({ field }) => (
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
                <FormItem className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                      <Layers className="h-5 w-5 text-violet-500" />
                    </div>
                    <div>
                      <FormLabel className="text-base font-semibold cursor-pointer">Bán nhiều thẻ</FormLabel>
                      <p className="text-xs text-muted-foreground mt-0.5">Đăng bán nhiều thẻ trong cùng một bài viết</p>
                    </div>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              </div>
            )}
          />

          {/* Card Title (Main) */}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className='text-lg font-semibold'>
                  {isBundle ? 'Tiêu đề bài bán' : t('card_title_label')}
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder={isBundle ? 'VD: Bộ sưu tập Pokémon Base Set hàng hiếm' : t('card_title_placeholder')}
                    {...field}
                  />
                </FormControl>
                {isBundle && (
                  <p className="text-xs text-muted-foreground">Đây là tiêu đề chính hiển thị trên chợ</p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Category & Condition */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='text-lg font-semibold'>{t('category_label')}</FormLabel>
                  <Select
                    onValueChange={(val) => {
                      field.onChange(val);
                    }}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('category_placeholder')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories.map(cat => <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="condition"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='text-lg font-semibold'>{t('condition_label')}</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isPsaGraded}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('condition_placeholder')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {conditions.map(cond => <SelectItem key={cond} value={cond}>{cond}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* ─── Dynamic Publisher / Set / Season Section ─── */}
          {selectedCategory && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-5">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" />
                <h3 className="text-base font-semibold text-primary">
                  Thông tin chi tiết — {categoryConfig?.label || selectedCategory}
                </h3>
              </div>

              {freeTextMode ? (
                /* ─── Free Text Mode (for "Khác" category) ─── */
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="freePublisher"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nhà phát hành</FormLabel>
                        <FormControl>
                          <Input placeholder="VD: Panini, Topps..." {...field} value={field.value ?? ''} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="freeSetName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tên Set / Bộ sưu tập</FormLabel>
                        <FormControl>
                          <Input placeholder="VD: Chrome, Prizm..." {...field} value={field.value ?? ''} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="freeSeason"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mùa / Năm</FormLabel>
                        <FormControl>
                          <Input placeholder="VD: 2024-25, Season 1..." {...field} value={field.value ?? ''} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              ) : (
                /* ─── Structured Dropdowns ─── */
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Publisher */}
                  <FormField
                    control={form.control}
                    name="publisher"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nhà phát hành</FormLabel>
                        {singlePublisher ? (
                          <div className="h-10 px-3 py-2 rounded-md border bg-muted text-sm flex items-center">
                            {availablePublishers[0]}
                          </div>
                        ) : (
                          <Select onValueChange={field.onChange} value={field.value || undefined}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Chọn nhà phát hành" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {availablePublishers.map(pub => (
                                <SelectItem key={pub} value={pub}>{pub}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Set Name */}
                  <FormField
                    control={form.control}
                    name="setName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Set / Bộ sưu tập</FormLabel>
                        <FormControl>
                          <SearchableSetPicker
                            value={field.value || undefined}
                            onChange={field.onChange}
                            groupedSets={useDbSets ? dbGroupedSets : undefined}
                            flatSets={!useDbSets ? staticSets : undefined}
                            loading={loadingDbSets}
                            disabled={loadingDbSets}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Season (only if category uses seasons) */}
                  {categoryConfig?.hasSeasons ? (
                    <FormField
                      control={form.control}
                      name="season"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Mùa / Năm</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || undefined}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Chọn mùa/năm" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {availableSeasons.map(season => (
                                <SelectItem key={season} value={season}>{season}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    /* Quantity fills the 3rd column when no season */
                    <FormField
                      control={form.control}
                      name="quantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Số lượng</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="1"
                              placeholder="1"
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              )}

              {/* If has seasons, show quantity on a separate row */}
              {categoryConfig?.hasSeasons && !freeTextMode && (
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem className="max-w-[200px]">
                      <FormLabel>Số lượng</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          placeholder="1"
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
          )}

          {/* Quantity standalone (only when no category selected yet) */}
          {!selectedCategory && (
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem className="max-w-[200px]">
                  <FormLabel className='text-lg font-semibold'>Số lượng</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="1"
                      placeholder="1"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {/* PSA Graded */}
          <FormField
            control={form.control}
            name="isPsaGraded"
            render={({ field }) => (
              <FormItem className="space-y-4">
                <div className="flex items-center space-x-2">
                  <FormControl>
                    <Checkbox
                      id="psa-graded"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <Label htmlFor="psa-graded" className="text-base font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    PSA Graded
                  </Label>
                </div>
                {field.value && (
                  <FormField
                    control={form.control}
                    name="psaGrade"
                    render={({ field: sliderField }) => (
                      <FormItem className="rounded-lg border p-4">
                        <div className="flex justify-between items-center">
                          <FormLabel className="text-lg font-semibold">PSA Grade</FormLabel>
                          <span className="w-12 text-center text-lg font-bold text-primary rounded-md bg-muted px-2 py-1">{sliderField.value ?? 10}</span>
                        </div>
                        <FormControl>
                          <Slider
                            id="psa-grade-slider"
                            min={1}
                            max={10}
                            step={1}
                            defaultValue={[sliderField.value || 10]}
                            onValueChange={(value) => sliderField.onChange(value[0])}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Images */}
          <FormField
            control={form.control}
            name="images"
            render={({ field }) => (
              <FormItem>
                <FormLabel className='text-lg font-semibold'>{t('images_label')}</FormLabel>
                <FormControl>
                  <div
                    className='border-2 border-dashed border-muted rounded-lg p-8 text-center cursor-pointer'
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleFiles(e.dataTransfer.files);
                    }}
                    onClick={() => document.getElementById('image-upload')?.click()}
                  >
                    <Upload className='mx-auto h-12 w-12 text-muted-foreground' />
                    <p className='mt-4 text-muted-foreground'>{t('images_description')}</p>
                    <Input
                      type="file"
                      className='sr-only'
                      id="image-upload"
                      multiple
                      onChange={(e) => handleFiles(e.target.files)}
                      accept={"image/jpeg,image/jpg,image/png,image/webp"}
                    />
                    <Button variant="outline" type="button" className="mt-4">
                      {t('browse_files')}
                    </Button>
                  </div>
                </FormControl>
                <FormMessage />
                {images && images.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mt-4">
                    {images.map((file, index) => (
                      <div key={index} className="relative group aspect-square">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={URL.createObjectURL(file)}
                          alt={`preview ${index}`}
                          className="object-cover rounded-md w-full h-full"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => removeImage(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </FormItem>
            )}
          />

          {/* Listing Type */}
          <FormField
            control={form.control}
            name="listingType"
            render={({ field }) => (
              <FormItem className="space-y-3">
                <FormLabel className='text-lg font-semibold'>{t('listing_type_label')}</FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    className="flex flex-col sm:flex-row gap-4"
                  >
                    <FormItem className="flex items-center space-x-3 space-y-0">
                      <FormControl>
                        <RadioGroupItem value="sale" />
                      </FormControl>
                      <FormLabel className="font-normal text-base">{t('buy_now_label')}</FormLabel>
                    </FormItem>
                    {/* Tạm ẩn Đấu giá và Razz
                    <FormItem className="flex items-center space-x-3 space-y-0">
                      <FormControl>
                        <RadioGroupItem value="auction" />
                      </FormControl>
                      <FormLabel className="font-normal text-base">{t('auction_label')}</FormLabel>
                    </FormItem>
                    <FormItem className="flex items-center space-x-3 space-y-0">
                      <FormControl>
                        <RadioGroupItem value="razz" />
                      </FormControl>
                      <FormLabel className="font-normal text-base">{t('razz_label')}</FormLabel>
                    </FormItem>
                    */}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* ─── Bundle Items ─── */}
          {isBundle && (
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-violet-500" />
                  <h3 className="text-base font-semibold text-violet-500">Danh sách thẻ</h3>
                  <span className="text-xs text-muted-foreground">({bundleItems.length} thẻ)</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addBundleItem}
                  className="gap-1.5 border-violet-500/30 text-violet-500 hover:bg-violet-500/10"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Thêm thẻ
                </Button>
              </div>

              <div className="space-y-3">
                {bundleItems.map((item, index) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-violet-500/10 bg-background/50 group animate-in slide-in-from-top-1 duration-150"
                  >
                    <span className="flex items-center justify-center h-8 w-8 rounded-full bg-violet-500/10 text-violet-500 text-sm font-bold shrink-0 mt-0.5">
                      {index + 1}
                    </span>
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
                      <Input
                        placeholder={`Tên thẻ #${index + 1}, VD: Holo Charizard`}
                        value={item.title}
                        onChange={(e) => updateBundleItem(item.id, 'title', e.target.value)}
                        className="text-sm"
                      />
                      <Input
                        type="number"
                        placeholder="Giá (VNĐ)"
                        value={item.price ?? ''}
                        onChange={(e) => updateBundleItem(item.id, 'price', e.target.value)}
                        className="text-sm"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeBundleItem(item.id)}
                      disabled={bundleItems.length <= 2}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Bundle summary */}
              {bundlePriceRange && (
                <div className="flex items-center justify-between pt-3 border-t border-violet-500/10 text-sm">
                  <span className="text-muted-foreground">Giá hiển thị trên chợ:</span>
                  <span className="font-semibold text-violet-500">
                    {bundlePriceRange.min === bundlePriceRange.max
                      ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(bundlePriceRange.min)
                      : `${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(bundlePriceRange.min)} — ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(bundlePriceRange.max)}`
                    }
                  </span>
                </div>
              )}
              {bundlePriceRange && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Tổng giá trị:</span>
                  <span className="font-bold text-green-500">
                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(bundlePriceRange.total)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Price Fields */}
          {listingType === 'sale' && (
            <FormField
              control={form.control}
              name="price"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='text-lg font-semibold'>
                    {isBundle ? 'Giá bán cả bộ' : t('price_label')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder={isBundle
                        ? 'Nhập giá bán cho cả bộ (có thể khác tổng giá từng thẻ)'
                        : (locale === 'en-US' ? 'Enter your price in USD' : 'Nhập giá của bạn bằng VND')
                      }
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  {isBundle && bundlePriceRange && (
                    <p className="text-xs text-muted-foreground">
                      💡 Tổng giá từng thẻ: {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(bundlePriceRange.total)} — Bạn có thể đặt giá bán cả bộ thấp hơn hoặc cao hơn
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {listingType === 'auction' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <FormField
                control={form.control}
                name="startingBid"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='text-lg font-semibold'>{t('starting_bid_label')}</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder={locale === 'en-US' ? 'Enter starting bid in USD' : 'Nhập giá khởi điểm bằng VND'} {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="auctionEnds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='text-lg font-semibold'>{t('auction_end_date_label')}</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {listingType === 'razz' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <FormField
                control={form.control}
                name="ticketPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='text-lg font-semibold'>{t('ticket_price_label')}</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder={locale === 'en-US' ? 'Enter ticket price in USD' : 'Nhập giá vé bằng VND'} {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="totalTickets"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='text-lg font-semibold'>{t('total_tickets_label')}</FormLabel>                  <FormControl>
                      <Input type="number" placeholder={locale === 'en-US' ? 'Enter total number of tickets' : 'Nhập tổng số vé'} {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {/* ─── Accept Offers ─── */}
          {listingType === 'sale' && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-4">
              <FormField
                control={form.control}
                name="acceptOffers"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                        <HandCoins className="h-5 w-5 text-amber-500" />
                      </div>
                      <div>
                        <FormLabel className="text-base font-semibold cursor-pointer">Nhận offer</FormLabel>
                        <p className="text-xs text-muted-foreground mt-0.5">Cho phép người mua gửi đề nghị giá cho thẻ này</p>
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {acceptOffers && (
                <FormField
                  control={form.control}
                  name="minOfferPercent"
                  render={({ field }) => (
                    <FormItem className="rounded-lg border border-amber-500/10 bg-background/50 p-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
                      <div className="flex items-center justify-between">
                        <FormLabel className="text-sm font-medium">Không nhận offer dưới</FormLabel>
                        <div className="flex items-center gap-1.5">
                          <span className="text-2xl font-bold text-amber-500 tabular-nums">{field.value || 0}</span>
                          <span className="text-sm font-semibold text-muted-foreground">%</span>
                        </div>
                      </div>
                      <FormControl>
                        <Slider
                          min={0}
                          max={99}
                          step={5}
                          defaultValue={[field.value || 0]}
                          onValueChange={(value) => field.onChange(value[0])}
                          className="[&_[role=slider]]:bg-amber-500 [&_[role=slider]]:border-amber-600"
                        />
                      </FormControl>
                      <div className="flex justify-between text-[11px] text-muted-foreground">
                        <span>Nhận mọi offer</span>
                        <span>Chỉ nhận gần giá gốc</span>
                      </div>
                      {watchedPrice && Number(watchedPrice) > 0 && field.value > 0 && (
                        <p className="text-xs text-amber-500/80 border-t border-amber-500/10 pt-3 mt-1">
                          💡 Offer tối thiểu: <span className="font-semibold">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(watchedPrice) * (field.value / 100))}</span>
                          {' '}(từ giá gốc {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(watchedPrice))})
                        </p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
          )}

          {/* Description */}
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel className='text-lg font-semibold'>{t('description_label')}</FormLabel>
                <FormControl>
                  <Textarea placeholder={t('description_placeholder')} rows={5} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex justify-end pt-4">
            <Button size="lg" type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('create_listing_button')}
            </Button>
          </div>
        </form>
      </Form>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-3xl" style={{ fontFamily: "'Orbitron', sans-serif" }}>{t('create_listing_title')}</CardTitle>
              <CardDescription>{t('create_listing_description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {renderContent()}
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
