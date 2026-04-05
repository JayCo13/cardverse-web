'use client';

import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { Loader2 } from 'lucide-react';
import type { GroupedSets } from '@/lib/card-catalog';

interface SearchableSetPickerProps {
  /** Current selected value */
  value: string | undefined;
  /** Callback when value changes */
  onChange: (value: string) => void;
  /** Grouped sets (EN/JP/Other) — for DB-driven categories */
  groupedSets?: GroupedSets;
  /** Flat list of sets — for static categories */
  flatSets?: { name: string; code?: string }[];
  /** Loading state */
  loading?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the picker is disabled */
  disabled?: boolean;
}

export function SearchableSetPicker({
  value,
  onChange,
  groupedSets,
  flatSets,
  loading = false,
  placeholder = 'Tìm và chọn set...',
  disabled = false,
}: SearchableSetPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filterBySearch = (items: string[]): string[] => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(name => name.toLowerCase().includes(q));
  };

  // Build sections
  let sections: { label: string; items: string[] }[] = [];

  if (groupedSets) {
    const hasEn = groupedSets.en.length > 0;
    const hasJp = groupedSets.jp.length > 0;
    const hasOther = groupedSets.other.length > 0;

    if (hasEn) sections.push({ label: '🇺🇸 English Sets', items: filterBySearch(groupedSets.en) });
    if (hasJp) sections.push({ label: '🇯🇵 Japanese Sets', items: filterBySearch(groupedSets.jp) });
    if (hasOther) sections.push({ label: 'Sets', items: filterBySearch(groupedSets.other) });
  } else if (flatSets) {
    sections.push({
      label: 'Sets',
      items: filterBySearch(flatSets.map(s => s.name).filter(Boolean)),
    });
  }

  const totalResults = sections.reduce((sum, s) => sum + s.items.length, 0);

  const handleSelect = (name: string) => {
    onChange(name);
    setSearch('');
    setOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setSearch('');
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Input */}
      <div className="relative">
        <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          placeholder={loading ? 'Đang tải sets...' : (value || placeholder)}
          value={open ? search : (value || '')}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setSearch('');
          }}
          disabled={disabled || loading}
          className={`pl-9 pr-8 ${value ? 'text-foreground' : 'text-muted-foreground'}`}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
        )}
        {!loading && value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && !loading && (
        <>
          {/* Backdrop to close */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div className="absolute z-50 w-full mt-1 max-h-[320px] overflow-y-auto rounded-lg border border-border bg-popover shadow-xl">
            {totalResults === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                {search ? `Không tìm thấy set "${search}"` : 'Không có set nào'}
              </div>
            ) : (
              sections.map((section, sIdx) => (
                <div key={sIdx}>
                  {/* Section header */}
                  {sections.length > 1 && section.items.length > 0 && (
                    <div className="sticky top-0 z-10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/80 backdrop-blur-sm border-b border-border/50">
                      {section.label} ({section.items.length})
                    </div>
                  )}
                  {/* Items */}
                  {section.items.map((name, idx) => (
                    <button
                      key={`${sIdx}-${idx}`}
                      type="button"
                      onClick={() => handleSelect(name)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors ${
                        name === value ? 'bg-primary/10 text-primary font-medium' : ''
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
