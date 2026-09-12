'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, MapPin, Pencil, Save } from 'lucide-react';
import { PickupAddressPicker, type PickupAddress } from '@/components/pickup-address-picker';
import { useToast } from '@/hooks/use-toast';
import { useLocalization } from '@/context/localization-context';

function samePickupAddress(left: PickupAddress, right: PickupAddress) {
    return left.city === right.city
        && left.district === right.district
        && left.ward === right.ward
        && left.street === right.street
        && left.name === right.name
        && left.phone === right.phone;
}

/**
 * Where a seller ships from. The only address a seller sets.
 *
 * It replaced a pair of forms that asked for the same physical place twice —
 * one in the 2025 structure for the profile columns, one in GoShip's for the
 * waybill. Saving here writes both, from the single set of ids the seller
 * picked, so there is nothing left to keep in sync and nothing to translate
 * between two geographies. See /api/shipping/pickup-address for why that is
 * sound rather than merely convenient.
 *
 * Used on /sell to edit it, and on /sell/create as the step that stands between
 * a new seller and their first listing.
 */

export function SenderAddressForm({
    onSaved,
    submitLabel,
}: {
    onSaved?: (address: PickupAddress) => void;
    submitLabel?: string;
}) {
    const { locale } = useLocalization();
    const { toast } = useToast();
    const tx = (vi: string, en: string, ja: string) =>
        (locale === 'ja-JP' ? ja : locale === 'en-US' ? en : vi);

    const [saved, setSaved] = useState<PickupAddress | null>(null);
    const [draft, setDraft] = useState<PickupAddress | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [editing, setEditing] = useState(false);
    // Nothing is rendered until the saved address is known. The form used to
    // mount open, with the picker already fetching GoShip's city list, and
    // then collapse into the summary a second later once the read came back —
    // a layout jump on every load of /sell, and two wasted round trips.
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/shipping/pickup-address')
            .then((r) => (r.ok ? r.json() : null))
            .then((body) => {
                if (cancelled) return;
                if (body?.data) setSaved(body.data);
                else setEditing(true);
            })
            .catch(() => { if (!cancelled) setEditing(true); /* an empty form is the right fallback for a failed read */ })
            .finally(() => { if (!cancelled) setLoaded(true); });
        return () => { cancelled = true; };
    }, []);

    const changeDraft = (address: PickupAddress | null) => {
        // Loading the saved values into the picker must not make the Save
        // button active. It becomes active only after a complete, real edit.
        setDraft(address && (!saved || !samePickupAddress(address, saved)) ? address : null);
    };

    const save = async () => {
        if (!draft) return;
        setIsSaving(true);
        try {
            const response = await fetch('/api/shipping/pickup-address', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(draft),
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                toast({
                    variant: 'destructive',
                    description: body?.error || tx('Không lưu được địa chỉ.', 'Could not save the address.', '住所を保存できませんでした。'),
                });
                return;
            }
            setSaved(body.data);
            setDraft(null);
            setEditing(false);
            onSaved?.(body.data);
            toast({ description: tx('Đã lưu địa chỉ gửi hàng.', 'Sender address saved.', '発送元住所を保存しました。') });
        } finally {
            setIsSaving(false);
        }
    };

    if (!loaded) {
        return (
            <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />…
            </p>
        );
    }

    if (saved && !editing) {
        return (
            <div className="flex flex-col gap-3 rounded-lg border border-green-500/20 bg-green-500/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{saved.street}</p>
                        <p className="truncate text-xs text-muted-foreground">{saved.name} · {saved.phone}</p>
                    </div>
                </div>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setEditing(true)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    {tx('Sửa địa chỉ', 'Edit address', '住所を編集')}
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* The saved address arrives after the form initially renders.
                Remount the controlled picker when it does, so its initial
                fields are populated from the saved server value. */}
            <PickupAddressPicker
                key={saved ? [saved.city, saved.district, saved.ward, saved.street, saved.name, saved.phone].join('|') : 'new'}
                value={saved}
                onChange={changeDraft}
            />
            <div className="flex items-center gap-3">
                {/* Disabled until every field is valid — the picker reports null
                    for a half-finished address, which is what stops a waybill
                    being printed with a missing ward. */}
                <Button onClick={save} disabled={!draft || isSaving}>
                    {isSaving ? null : <Save className="mr-2 h-4 w-4" />}
                    {submitLabel || tx('Lưu địa chỉ gửi hàng', 'Save sender address', '発送元住所を保存')}
                </Button>
                {saved && <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>{tx('Hủy', 'Cancel', 'キャンセル')}</Button>}
            </div>
        </div>
    );
}
