
'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import type { Card, CardCategory, ListingType, CardCondition } from '@/lib/types';
import { useLocalization } from '@/context/localization-context';
import type { Filters as BaseFilters } from '@/app/buy/page';
import { getCategories } from '@/lib/card-catalog';

// The sidebar may or may not have listingTypes in its filters
type Filters = BaseFilters & { listingTypes?: ListingType[] };
interface FilterSidebarProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  showListingTypeFilter?: boolean;
  showAdvancedFilters?: boolean;
  availableCards?: Card[];
}

const uniqueSorted = (values: Array<string | null | undefined>) =>
  Array.from(new Set(values.filter((value): value is string => !!value))).sort((a, b) => a.localeCompare(b));

const formatPriceInput = (value?: string) => {
  const number = Number(value || 0);
  return number > 0 ? new Intl.NumberFormat('vi-VN').format(number) : '';
};

export function FilterSidebar({ filters, onFiltersChange, showListingTypeFilter = true, showAdvancedFilters = false, availableCards = [] }: FilterSidebarProps) {
  const { t, locale } = useLocalization();
  const copy = locale === 'vi-VN'
    ? {
        active: 'đang áp dụng', search: 'Tên, số thẻ, set hoặc người bán...', price: 'Khoảng giá', min: 'Từ', max: 'Đến', publisher: 'Nhà phát hành',
        sets: 'Set / Bộ thẻ', features: 'Tuỳ chọn nâng cao', offers: 'Có nhận offer',
        verified: 'Seller đã xác minh', bundles: 'Chỉ combo/bundle', graded: 'Chỉ thẻ đã grading', noOptions: 'Chưa có dữ liệu',
      }
    : locale === 'ja-JP'
      ? {
          active: '適用中', search: '名前、カード番号、セット、販売者...', price: '価格帯', min: '最低', max: '最高', publisher: '出版社', sets: 'セット',
          features: '詳細オプション', offers: '価格交渉可', verified: '認証済み販売者',
          bundles: 'セット商品のみ', graded: '鑑定済みのみ', noOptions: 'データなし',
        }
      : {
          active: 'active', search: 'Name, card number, set or seller...', price: 'Price range', min: 'Min', max: 'Max', publisher: 'Publisher', sets: 'Set',
          features: 'Advanced options', offers: 'Accepts offers', verified: 'Verified seller',
          bundles: 'Bundles only', graded: 'Graded cards only', noOptions: 'No options available',
        };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFiltersChange({ ...filters, search: event.target.value });
  };

  const handleCategoryChange = (category: CardCategory) => {
    const newCategories = filters.categories.includes(category)
      ? filters.categories.filter((c) => c !== category)
      : [...filters.categories, category];
    onFiltersChange({ ...filters, categories: newCategories });
  };

  const handleListingTypeChange = (listingType: ListingType) => {
    const currentListingTypes = filters.listingTypes || [];
    const newListingTypes = currentListingTypes.includes(listingType)
      ? currentListingTypes.filter((lt) => lt !== listingType)
      : [...currentListingTypes, listingType];
    onFiltersChange({ ...filters, listingTypes: newListingTypes });
  };
  
  const handleConditionChange = (condition: CardCondition) => {
    const newConditions = filters.conditions.includes(condition)
      ? filters.conditions.filter((c) => c !== condition)
      : [...filters.conditions, condition];
    onFiltersChange({ ...filters, conditions: newConditions });
  };

  const clearFilters = () => {
    const baseFilters: Filters = {
      search: '', categories: [], conditions: [], minPrice: '', maxPrice: '', publishers: [], sets: [],
      acceptsOffers: false, verifiedSellers: false, bundlesOnly: false, gradedOnly: false,
    };
    if (showListingTypeFilter) {
      baseFilters.listingTypes = [];
    }
    onFiltersChange(baseFilters);
  };

  const categories = getCategories(locale).filter(category => category.value !== 'Magic' && category.value !== 'Ma thuật');
  const publishers = uniqueSorted(availableCards.map(card => card.publisher));
  const sets = uniqueSorted(availableCards.map(card => card.setName));
  const availableConditions = uniqueSorted(availableCards.map(card => card.condition));
  const categoryCounts = new Map(categories.map(category => [
    category.value,
    availableCards.filter(card => card.category === category.value || card.category === category.label).length,
  ]));

  const activeFilterCount = filters.categories.length
    + filters.conditions.length
    + (filters.publishers?.length || 0)
    + (filters.sets?.length || 0)
    + (filters.search ? 1 : 0)
    + (filters.minPrice ? 1 : 0)
    + (filters.maxPrice ? 1 : 0)
    + (filters.acceptsOffers ? 1 : 0)
    + (filters.verifiedSellers ? 1 : 0)
    + (filters.bundlesOnly ? 1 : 0)
    + (filters.gradedOnly ? 1 : 0);

  const toggleArrayFilter = (key: 'publishers' | 'sets', value: string) => {
    const current = filters[key] || [];
    onFiltersChange({
      ...filters,
      [key]: current.includes(value) ? current.filter(item => item !== value) : [...current, value],
    });
  };

  const setBooleanFilter = (key: 'acceptsOffers' | 'verifiedSellers' | 'bundlesOnly' | 'gradedOnly', value: boolean) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const listingTypes: { value: ListingType, label: string }[] = [
    { value: 'sale', label: t('buy_now_label') },
    { value: 'auction', label: t('auction_label') },
    { value: 'razz', label: t('razz_label') },
  ];

  const conditions: CardCondition[] = availableConditions.length > 0
    ? availableConditions as CardCondition[]
    : locale === 'vi-VN'
      ? ['Hoàn hảo', 'Gần như mới', 'Tuyệt vời', 'Tốt', 'Đã qua sử dụng']
      : ['Mint', 'Near Mint', 'Excellent', 'Good', 'Played'];


  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold">{t('filter_title')}</h3>
          {activeFilterCount > 0 && <p className="text-xs text-orange-400">{activeFilterCount} {copy.active}</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={clearFilters}>{t('filter_clear')}</Button>
      </div>
      
      <Input
        placeholder={copy.search}
        value={filters.search}
        onChange={handleSearchChange}
      />

      <Accordion type="multiple" defaultValue={['category', 'listingType', 'condition', 'price', 'features']} className="w-full">
        <AccordionItem value="category">
          <AccordionTrigger>{t('category_label')}</AccordionTrigger>
          <AccordionContent className="space-y-2">
            {categories.map((category) => (
              <div key={category.value} className="flex items-center space-x-2">
                <Checkbox
                  id={`cat-${category.value}`}
                  checked={filters.categories.includes(category.value as CardCategory)}
                  onCheckedChange={() => handleCategoryChange(category.value as CardCategory)}
                />
                <Label htmlFor={`cat-${category.value}`} className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <span className="truncate">{category.label}</span>
                  {availableCards.length > 0 && (
                    <span className="text-xs font-normal text-muted-foreground">{categoryCounts.get(category.value) || 0}</span>
                  )}
                </Label>
              </div>
            ))}
          </AccordionContent>
        </AccordionItem>
        {showListingTypeFilter && (
            <AccordionItem value="listingType">
            <AccordionTrigger>{t('filter_listing_type')}</AccordionTrigger>
            <AccordionContent className="space-y-2">
                {listingTypes.map((type) => (
                <div key={type.value} className="flex items-center space-x-2">
                    <Checkbox
                    id={`lt-${type.value}`}
                    checked={filters.listingTypes?.includes(type.value)}
                    onCheckedChange={() => handleListingTypeChange(type.value)}
                    />
                    <Label htmlFor={`lt-${type.value}`} className="capitalize">{type.label}</Label>
                </div>
                ))}
            </AccordionContent>
            </AccordionItem>
        )}
        <AccordionItem value="condition">
          <AccordionTrigger>{t('condition_label')}</AccordionTrigger>
          <AccordionContent className="space-y-2">
            {conditions.map((condition) => (
              <div key={condition} className="flex items-center space-x-2">
                <Checkbox
                  id={`cond-${condition}`}
                  checked={filters.conditions.includes(condition)}
                  onCheckedChange={() => handleConditionChange(condition)}
                />
                <Label htmlFor={`cond-${condition}`}>{condition}</Label>
              </div>
            ))}
          </AccordionContent>
        </AccordionItem>
        {showAdvancedFilters && <>
        <AccordionItem value="price">
          <AccordionTrigger>{copy.price}</AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-2 gap-2">
              <Input
                aria-label={copy.min}
                placeholder={copy.min}
                inputMode="numeric"
                value={formatPriceInput(filters.minPrice)}
                onChange={event => onFiltersChange({ ...filters, minPrice: event.target.value.replace(/[^\d]/g, '') })}
              />
              <Input
                aria-label={copy.max}
                placeholder={copy.max}
                inputMode="numeric"
                value={formatPriceInput(filters.maxPrice)}
                onChange={event => onFiltersChange({ ...filters, maxPrice: event.target.value.replace(/[^\d]/g, '') })}
              />
            </div>
          </AccordionContent>
        </AccordionItem>
        {publishers.length > 0 && (
          <AccordionItem value="publisher">
            <AccordionTrigger>{copy.publisher}</AccordionTrigger>
            <AccordionContent className="max-h-48 space-y-2 overflow-y-auto pr-1">
              {publishers.map(publisher => (
                <div key={publisher} className="flex items-center space-x-2">
                  <Checkbox id={`publisher-${publisher}`} checked={filters.publishers?.includes(publisher)} onCheckedChange={() => toggleArrayFilter('publishers', publisher)} />
                  <Label htmlFor={`publisher-${publisher}`} className="min-w-0 truncate">{publisher}</Label>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        )}
        {sets.length > 0 && (
          <AccordionItem value="sets">
            <AccordionTrigger>{copy.sets}</AccordionTrigger>
            <AccordionContent className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {sets.map(setName => (
                <div key={setName} className="flex items-center space-x-2">
                  <Checkbox id={`set-${setName}`} checked={filters.sets?.includes(setName)} onCheckedChange={() => toggleArrayFilter('sets', setName)} />
                  <Label htmlFor={`set-${setName}`} className="min-w-0 truncate" title={setName}>{setName}</Label>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        )}
        <AccordionItem value="features">
          <AccordionTrigger>{copy.features}</AccordionTrigger>
          <AccordionContent className="space-y-2">
            {([
              ['acceptsOffers', copy.offers],
              ['verifiedSellers', copy.verified],
              ['bundlesOnly', copy.bundles],
              ['gradedOnly', copy.graded],
            ] as const).map(([key, label]) => (
              <div key={key} className="flex items-center space-x-2">
                <Checkbox id={`feature-${key}`} checked={!!filters[key]} onCheckedChange={value => setBooleanFilter(key, value === true)} />
                <Label htmlFor={`feature-${key}`}>{label}</Label>
              </div>
            ))}
          </AccordionContent>
        </AccordionItem>
        </>}
      </Accordion>
    </div>
  );
}
