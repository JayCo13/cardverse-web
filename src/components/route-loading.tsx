import { Skeleton } from '@/components/ui/skeleton';

/**
 * The placeholder a route shows while its own segment is still on the wire.
 *
 * Every page here is server-rendered on demand, and the round trip that fetches
 * it costs the best part of a second from Vietnam. Without a `loading.tsx` Next
 * has nothing to show for that second, so a link click left the previous page
 * frozen on screen — the single most common reason the site "felt" slow even
 * when the work behind it was quick.
 *
 * Header and Footer live in the root layout, so these fall back only the page
 * body: the chrome stays put and just the middle swaps.
 *
 * The shapes are deliberately close to what each route actually renders. A
 * skeleton that lands in roughly the right places reads as the page arriving; a
 * generic grey box reads as a second loading screen.
 */

type Variant = 'list' | 'detail' | 'panel';

const shell = 'flex flex-1 flex-col';

function ListSkeleton() {
    return (
        <main className="container mx-auto flex-1 px-4 py-8">
            <div className="mx-auto mb-8 max-w-md space-y-3 text-center">
                <Skeleton className="mx-auto h-10 w-72" />
                <Skeleton className="mx-auto h-4 w-56" />
            </div>
            <div className="flex flex-col gap-6 lg:flex-row">
                <aside className="hidden w-64 shrink-0 space-y-6 lg:block">
                    <Skeleton className="h-10 w-full" />
                    {[0, 1, 2].map(group => (
                        <div key={group} className="space-y-3">
                            <Skeleton className="h-4 w-24" />
                            {[0, 1, 2, 3].map(row => (
                                <Skeleton key={row} className="h-4 w-full" />
                            ))}
                        </div>
                    ))}
                </aside>
                <div className="flex-1 space-y-4">
                    <div className="flex items-center justify-between">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-10 w-40" />
                    </div>
                    {[0, 1, 2, 3].map(row => (
                        <Skeleton key={row} className="h-56 w-full rounded-xl" />
                    ))}
                </div>
            </div>
        </main>
    );
}

function DetailSkeleton() {
    return (
        <main className="container mx-auto flex-1 px-4 py-8">
            <Skeleton className="mb-6 h-9 w-32" />
            <div className="grid gap-8 lg:grid-cols-2">
                <Skeleton className="aspect-[3/4] w-full rounded-xl" />
                <div className="space-y-4">
                    <Skeleton className="h-10 w-4/5" />
                    <Skeleton className="h-5 w-2/5" />
                    <Skeleton className="h-28 w-full rounded-xl" />
                    <Skeleton className="h-12 w-full rounded-lg" />
                    <Skeleton className="h-12 w-full rounded-lg" />
                    <div className="space-y-2 pt-4">
                        {[0, 1, 2, 3].map(row => (
                            <Skeleton key={row} className="h-4 w-full" />
                        ))}
                    </div>
                </div>
            </div>
        </main>
    );
}

function PanelSkeleton() {
    return (
        <main className="container mx-auto flex-1 px-4 py-8">
            <div className="mx-auto max-w-4xl space-y-6">
                <Skeleton className="h-9 w-56" />
                <Skeleton className="h-32 w-full rounded-xl" />
                {[0, 1, 2].map(row => (
                    <Skeleton key={row} className="h-40 w-full rounded-xl" />
                ))}
            </div>
        </main>
    );
}

export function RouteLoading({ variant = 'panel' }: { variant?: Variant }) {
    return (
        <div className={shell} aria-busy="true" aria-live="polite">
            {variant === 'list' ? <ListSkeleton />
                : variant === 'detail' ? <DetailSkeleton />
                    : <PanelSkeleton />}
        </div>
    );
}
