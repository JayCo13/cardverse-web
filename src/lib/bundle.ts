export type BundleItem = { title?: string; price?: number; [k: string]: unknown };
export type BundleSelection = { title: string; price: number };

/**
 * Match a buyer's selection against a live bundle_items array, removing one item
 * per selection. Returns the matched total + the items that remain, or null if
 * any selected item is no longer present (someone bought it first).
 */
export function matchBundleSelection(
  items: BundleItem[],
  selection: BundleSelection[],
): { matchedTotal: number; remaining: BundleItem[] } | null {
  const remaining = [...items];
  let matchedTotal = 0;
  for (const sel of selection) {
    const idx = remaining.findIndex(
      (it) => String(it?.title ?? '') === sel.title && Number(it?.price) === sel.price,
    );
    if (idx === -1) return null;
    matchedTotal += Number(remaining[idx]?.price) || 0;
    remaining.splice(idx, 1);
  }
  return { matchedTotal, remaining };
}

/** Read a stored bundle_selection out of an order's metadata (jsonb). */
export function selectionFromMetadata(metadata: unknown): BundleSelection[] {
  const raw = (metadata as any)?.bundle_selection;
  if (!Array.isArray(raw)) return [];
  return raw.map((s: any) => ({ title: String(s?.title ?? ''), price: Number(s?.price) || 0 }));
}
