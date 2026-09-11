'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Save } from 'lucide-react';
import { PickupAddressPicker, type PickupAddress } from '@/components/pickup-address-picker';
import { useToast } from '@/hooks/use-toast';
import { useLocalization } from '@/context/localization-context';

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

    useEffect(() => {
        let cancelled = false;
        fetch('/api/shipping/pickup-address')
            .then((r) => (r.ok ? r.json() : null))
            .then((body) => { if (!cancelled && body?.data) setSaved(body.data); })
            .catch(() => { /* an empty form is the right fallback for a failed read */ });
        return () => { cancelled = true; };
    }, []);

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
            onSaved?.(body.data);
            toast({ description: tx('Đã lưu địa chỉ gửi hàng.', 'Sender address saved.', '発送元住所を保存しました。') });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <PickupAddressPicker value={saved} onChange={setDraft} />
            <div className="flex items-center gap-3">
                {/* Disabled until every field is valid — the picker reports null
                    for a half-finished address, which is what stops a waybill
                    being printed with a missing ward. */}
                <Button onClick={save} disabled={!draft || isSaving}>
                    {isSaving ? null : <Save className="mr-2 h-4 w-4" />}
                    {submitLabel || tx('Lưu địa chỉ gửi hàng', 'Save sender address', '発送元住所を保存')}
                </Button>
                {saved && !draft && (
                    <span className="text-xs text-green-400">
                        {tx('Đã có địa chỉ', 'Address on file', '登録済み')}
                    </span>
                )}
            </div>
        </div>
    );
}
