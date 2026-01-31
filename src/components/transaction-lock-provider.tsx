"use client";

import { useTransactionLock } from "@/hooks/use-transaction-lock";

/**
 * Provider component that enforces transaction lock globally
 * Wraps children and redirects users to active transaction room if they try to navigate away
 */
export function TransactionLockProvider({ children }: { children: React.ReactNode }) {
    const { isChecking } = useTransactionLock();

    // Don't block rendering, the hook will handle redirects
    return <>{children}</>;
}
