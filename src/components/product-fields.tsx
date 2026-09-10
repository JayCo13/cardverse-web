'use client';
import { PRODUCT_CONDITIONS, PRODUCT_DETAIL_KEYS, productCopy, type ProductDetails } from '@/lib/product-listing';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown } from 'lucide-react';

export function ProductFields({ locale, condition, onCondition, details, onDetails, typeLabel, onTypeLabel, other, disabled = false }: {
  locale: string; condition: string; onCondition: (v: string) => void; details: ProductDetails; onDetails: (v: ProductDetails) => void;
  typeLabel: string; onTypeLabel: (v: string) => void; other: boolean; disabled?: boolean;
}) {
  const copy = productCopy(locale);
  return (
    <fieldset disabled={disabled} className="space-y-5 rounded-xl border p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {other && (
          <label className="block space-y-2">
            <span className="text-sm font-medium">{copy.type}</span>
            <Input className="h-11" value={typeLabel} maxLength={80} onChange={e => onTypeLabel(e.target.value)} required />
          </label>
        )}
        <div className="space-y-2">
          <span className="text-sm font-medium">{copy.condition}</span>
          <Select value={condition} onValueChange={onCondition}>
            <SelectTrigger aria-label={copy.condition} className="h-11">
              <SelectValue placeholder={copy.condition} />
            </SelectTrigger>
            <SelectContent>
              {PRODUCT_CONDITIONS.map(value => <SelectItem key={value} value={value}>{copy[value]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Collapsed by default: none of it is required, and four more inputs
          open on a phone would bury the fields that are. */}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg border border-border/60 bg-background/60 px-3 py-2.5 text-sm font-medium transition-colors hover:border-orange-500/40">
          {copy.details}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {PRODUCT_DETAIL_KEYS.map(key => (
            <label className="block space-y-2" key={key}>
              <span className="text-sm font-medium">{copy[key]}</span>
              <Input className="h-11" maxLength={100} value={details[key] || ''} onChange={e => onDetails({ ...details, [key]: e.target.value })} />
            </label>
          ))}
        </div>
      </details>
    </fieldset>
  );
}
