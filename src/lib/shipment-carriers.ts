import { OFFERABLE_COURIERS } from '@/lib/shipping-carriers';

type Coverage = { carriers?: string[] | null } | null | undefined;

/**
 * The carriers a shop may ship with: what it ticked, within what collects at
 * its door (profiles.carrier_coverage), within what the app offers at all.
 *
 * An empty tick list is no preference, not no carriers. Missing coverage is no
 * filter — the live route quote is the real gate anyway. Pure, so both the
 * server routes and verify scripts can call it.
 */
export function shipmentCarriers(saved: string[] | null | undefined, coverage?: Coverage): string[] {
  const offerable = OFFERABLE_COURIERS.map(c => c.code as string);
  const collects = coverage?.carriers?.length ? offerable.filter(c => coverage.carriers!.includes(c)) : offerable;
  const selected = collects.filter(code => saved?.includes(code));
  return selected.length ? selected : collects;
}
