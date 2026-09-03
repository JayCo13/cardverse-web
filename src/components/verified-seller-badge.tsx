'use client';

import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocalization } from "@/context/localization-context";

/**
 * The "seller đã xác minh" tick.
 *
 * One component so every surface that names a seller shows the same mark:
 * this badge drifted into three different colours and two different icons
 * before it was pulled together here. Renders nothing when the seller is not
 * verified, so callers can drop it in beside a name unconditionally.
 *
 * Verified means `profiles.seller_verified` — KYC identity + bank account
 * matched, granted by /api/seller/verify or an admin. It is not a rating.
 */
export function VerifiedSellerBadge({
  verified,
  className,
}: {
  verified?: boolean | null;
  className?: string;
}) {
  const { t } = useLocalization();
  if (!verified) return null;
  return (
    <BadgeCheck
      aria-label={t('verified_seller_label')}
      className={cn("h-4 w-4 shrink-0 text-orange-500", className)}
    />
  );
}
