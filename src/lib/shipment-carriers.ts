import { OFFERABLE_COURIERS } from '@/lib/shipping-carriers';

export function shipmentCarriers(saved: string[] | null | undefined): string[] {
  const allowed = OFFERABLE_COURIERS.map(c => c.code);
  const selected = allowed.filter(code => saved?.includes(code));
  return selected.length ? selected : allowed;
}
