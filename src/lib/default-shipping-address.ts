import type { SavedAddress } from '@/components/address-book';

/** Shared selection rule without loading the address editor into the root provider. */
export const pickDefaultAddress = (list: SavedAddress[]): SavedAddress | null =>
  list.find(address => address.is_default) ?? list[0] ?? null;
