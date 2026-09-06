'use client';

import Link from "next/link";
import { useUser } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/**
 * Wraps a name, an avatar, or both, and makes it open that person's profile.
 *
 * One component so every surface that names a member behaves the same way —
 * the same reason `VerifiedSellerBadge` exists. Before this, a buyer could see
 * a seller on the card page, in their cart, in an order and in a chat, and not
 * one of the four could be clicked.
 *
 * Renders a plain `<span>` when there is no id: seller rows can arrive with the
 * profile join missing, and a link to `/users/undefined` is worse than text.
 */
export function UserLink({
  userId,
  children,
  className,
  /**
   * Set when the link sits inside a row that is itself clickable — a cart
   * group header that toggles a checkbox, a list row that opens a detail. The
   * click would otherwise do both things at once.
   *
   * It does NOT make an `<a>` legal inside a `<button>`; for those, offer the
   * profile somewhere else (see the chat inbox's "..." menu).
   */
  stopPropagation = false,
  /**
   * "text" underlines on hover, which is the affordance a name needs.
   * "plain" is for wrapping an avatar: `no-underline` in a caller's className
   * would not cancel `hover:underline` — they sit in different variants, so
   * tailwind-merge keeps both and the fallback initial picks up a stray rule.
   */
  variant = "text",
  title,
}: {
  userId?: string | null;
  children: React.ReactNode;
  className?: string;
  stopPropagation?: boolean;
  variant?: "text" | "plain";
  title?: string;
}) {
  const { user } = useUser();

  if (!userId) {
    return <span className={className}>{children}</span>;
  }

  // Your own row points at the owner page, which shows strictly more than the
  // public one and does not need the id in the URL.
  const href = user?.id === userId ? "/profile" : `/users/${userId}`;

  return (
    <Link
      href={href}
      title={title}
      onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
      className={cn(
        "transition-colors hover:text-primary",
        variant === "text" && "underline-offset-2 hover:underline",
        className,
      )}
    >
      {children}
    </Link>
  );
}
