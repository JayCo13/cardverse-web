
'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import type { CardCategory, ListingType, CardCondition } from '@/lib/types';
import { useLocalization } from '@/context/localization-context';
import type { Filters as BaseFilters } from '@/app/buy/page';

// The sidebar may or may not have listingTypes in its filters
type Filters = BaseFilters & { listingTypes?: ListingType[] };
interface FilterSidebarProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  showListingTypeFilter?: boolean;
}

export function FilterSidebar({ filters, onFiltersChange, showListingTypeFilter = true }: FilterSidebarProps) {
  const { t, locale } = useLocalization();

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
    const baseFilters: Filters = { search: '', categories: [], conditions: [] };
    if (showListingTypeFilter) {
      baseFilters.listingTypes = [];
    }
    onFiltersChange(baseFilters);
  };

  const categories: CardCategory[] = locale === 'en-US' 
    ? ['Pokémon', 'Soccer', 'Magic', 'Other'] 
    : ['Pokémon', 'Bóng đá', 'Ma thuật', 'Khác'];

  const listingTypes: { value: ListingType, label: string }[] = [
    { value: 'sale', label: t('buy_now_label') },
    { value: 'auction', label: t('auction_label') },
    { value: 'razz', label: t('razz_label') },
  ];

  const conditions: CardCondition[] = locale === 'en-US'
    ? ['Mint', 'Near Mint', 'Excellent', 'Good', 'Played']
    : ['Hoàn hảo', 'Gần như mới', 'Tuyệt vời', 'Tốt', 'Đã qua sử dụng'];


  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">{t('filter_title')}</h3>
        <Button variant="ghost" size="sm" onClick={clearFilters}>{t('filter_clear')}</Button>
      </div>
      
      <Input
        placeholder={t('filter_search_placeholder')}
        value={filters.search}
        onChange={handleSearchChange}
      />

      <Accordion type="multiple" defaultValue={['category', 'listingType', 'condition']} className="w-full">
        <AccordionItem value="category">
          <AccordionTrigger>{t('category_label')}</AccordionTrigger>
          <AccordionContent className="space-y-2">
            {categories.map((category) => (
              <div key={category} className="flex items-center space-x-2">
                <Checkbox
                  id={`cat-${category}`}
                  checked={filters.categories.includes(category)}
                  onCheckedChange={() => handleCategoryChange(category)}
                />
                <Label htmlFor={`cat-${category}`}>{category}</Label>
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
      </Accordion>
    </div>
  );
}
