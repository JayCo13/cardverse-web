
'use client';

import { useEffect, useState } from 'react';
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
import { Upload, ShieldAlert, X, Loader2 } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useSupabase, useUser } from '@/lib/supabase';
import { useAuthModal } from '@/components/auth-modal';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { uploadImageToCloudinary } from '@/lib/cloudinary';

const getFormSchema = (t: (key: string) => string) => z.object({
  name: z.string().min(5, { message: "Title must be at least 5 characters." }),
  category: z.string({ required_error: "Please select a category." }),
  publisher: z.string({ required_error: "Please select a publisher." }),
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
      season: "",
      quantity: 1,
    },
  });

  const listingType = form.watch('listingType');
  const isPsaGraded = form.watch('isPsaGraded');
  const images = form.watch('images');

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

  const categories = locale === 'en-US'
    ? ['Pokémon', 'Soccer', 'Basketball', 'One Piece', 'Yu-Gi-Oh', 'F1', 'Other']
    : ['Pokémon', 'Bóng đá', 'Bóng rổ', 'One Piece', 'Yu-Gi-Oh', 'F1', 'Khác'];

  const publishers = ['Panini', 'Topps', 'Daka', 'Namco Bandai', 'Khác'];

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

  const removeImage = (index: number) => {
    const currentFiles = form.getValues('images') || [];
    const newFiles = currentFiles.filter((_, i) => i !== index);
    form.setValue('images', newFiles, { shouldValidate: true });
  };

  async function onSubmit(values: z.infer<typeof formSchema>) {
    console.log('Form submitted with values:', values);
    if (!user) {
      console.log('No user, opening auth modal');
      setOpen(true);
      return;
    }
    console.log('Starting submission...');
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

      const cardData: any = {
        seller_id: user.id,
        name: values.name,
        category: values.category,
        condition: finalCondition,
        description: values.description,
        listing_type: values.listingType,
        image_url: uploadedUrls[0],
        image_urls: uploadedUrls,
        publisher: values.publisher,
        season: values.season || '',
        quantity: values.quantity || 1,
        status: 'active',
      };

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

      await supabase.from('cards').insert(cardData);

      toast({
        title: "Listing Created!",
        description: "Your card is now live on the marketplace.",
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
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className='text-lg font-semibold'>{t('card_title_label')}</FormLabel>
                <FormControl>
                  <Input placeholder={t('card_title_placeholder')} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='text-lg font-semibold'>{t('category_label')}</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('category_placeholder')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
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

          {/* Publisher, Season, Quantity Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FormField
              control={form.control}
              name="publisher"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='text-lg font-semibold'>Nhà phát hành</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Chọn nhà phát hành..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {publishers.map(pub => <SelectItem key={pub} value={pub}>{pub}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="season"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='text-lg font-semibold'>Mùa/Năm</FormLabel>
                  <FormControl>
                    <Input placeholder="VD: 2023, Season 1..." value={field.value ?? ''} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
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
          </div>

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
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {listingType === 'sale' && (
            <FormField
              control={form.control}
              name="price"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='text-lg font-semibold'>{t('price_label')}</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder={locale === 'en-US' ? 'Enter your price in USD' : 'Nhập giá của bạn bằng VND'} {...field} value={field.value ?? ''} />
                  </FormControl>
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
