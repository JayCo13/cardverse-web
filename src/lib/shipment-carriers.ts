import { OFFERABLE_COURIERS } from '@/lib/shipping-carriers';

type Coverage = { carriers?: string[] | null } | null | undefined;

/**
 * The carriers a shop may ship with: what it ticked, within what collects at
 * its door (profiles.carrier_coverage), within what the app offers at all.
 *
 * An empty tick list means the shop has not configured shipping yet. It must
 * never expand to every courier: doing so silently opts the seller into GHN
 * (or whichever live rate is cheapest). Missing coverage is no filter — the
 * live route quote is still the final route gate. Pure, so both the server
 * routes and verify scripts can call it.
 */
export function shipmentCarriers(saved: string[] | null | undefined, coverage?: Coverage): string[] {
  const offerable = OFFERABLE_COURIERS.map(c => c.code as string);
  const collects = Array.isArray(coverage?.carriers)
    ? offerable.filter(c => coverage.carriers!.includes(c))
    : offerable;
  return collects.filter(code => saved?.includes(code));
}
