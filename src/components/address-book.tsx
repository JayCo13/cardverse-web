'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GoshipRegionPicker, type GoshipRegion } from '@/components/goship-region-picker';
import { useToast } from '@/hooks/use-toast';
import { useLocalization } from '@/context/localization-context';
import {
    MapPin, Plus, Pencil, Trash2, Loader2, Check, Star, ArrowLeft,
} from 'lucide-react';

export type SavedAddress = {
    id: string;
    recipient_name: string;
    phone: string;
    province_id: number;
    province_name: string;
    district_id: number | null;
    district_name: string | null;
    ward_code: string;
    ward_name: string;
    detail: string;
    is_default: boolean;
    /**
     * The carrier's ids for this address — the geography it was picked in.
     *
     * province_id/name, district_id/name and ward_code/name are copied from
     * GoShip's lists on save, never the other way round. Null only on rows
     * saved before addresses moved to GoShip's geography; such a row cannot
     * have a waybill booked against it and is re-picked on edit.
     */
    goship: { city: string; district: string; ward: string } | null;
};

/**
 * The address a buyer is presumed to be shipping to.
 *
 * Their default, or the only one they have. Exported because the listing page
 * quotes a real fee against it before the address book is ever opened, and two
 * definitions of "default" would let that quote disagree with the one checkout
 * shows a moment later.
 */
export const pickDefaultAddress = (list: SavedAddress[]): SavedAddress | null =>
    list.find(address => address.is_default) ?? list[0] ?? null;

type AddressBookProps = {
    // Checkout mode: show a radio to pick the shipping address and report it up.
    selectable?: boolean;
    selectedId?: string | null;
    onSelect?: (address: SavedAddress | null) => void;
    // Notified whenever the underlying list changes (add/edit/delete/default).
    onAddressesChange?: (addresses: SavedAddress[]) => void;
};

type FormState = {
    name: string;
    phone: string;
    goship: GoshipRegion | null;
    detail: string;
    isDefault: boolean;
};

const emptyForm: FormState = { name: '', phone: '', goship: null, detail: '', isDefault: false };

export function AddressBook({ selectable = false, selectedId, onSelect, onAddressesChange }: AddressBookProps) {
    const { toast } = useToast();
    const { locale } = useLocalization();
    const copy = locale === 'ja-JP'
        ? {
            missingTitle: '情報が不足しています',
            errorTitle: 'エラー',
            missingDesc: '名前、電話番号、住所を入力してください。',
            updated: '住所を更新しました',
            added: '住所を追加しました',
            saveError: '住所を保存できません',
            deleted: '住所を削除しました',
            deleteError: '住所を削除できません',
            defaulted: '既定の住所に設定しました',
            defaultError: '既定の設定に失敗しました',
            editAddress: '住所を編集',
            addAddress: '新しい住所を追加',
            recipient: '受取人名',
            phone: '電話番号',
            defaultCheckbox: '既定の住所にする',
            cancel: 'キャンセル',
            save: '住所を保存',
            empty: 'まだ住所がありません。追加すると支払いが速くなります。',
            default: '既定',
            edit: '編集',
            setDefault: '既定にする',
            delete: '削除',
            addNew: '新しい住所を追加',
            detailPlaceholder: '番地、通り名...',
            needsRegion: '住所を選び直してください',
          }
        : locale === 'vi-VN'
            ? {
                missingTitle: 'Thiếu thông tin',
                errorTitle: 'Lỗi',
                missingDesc: 'Nhập tên, SĐT và chọn đầy đủ địa chỉ.',
                updated: 'Đã cập nhật địa chỉ',
                added: 'Đã thêm địa chỉ',
                saveError: 'Không thể lưu địa chỉ',
                deleted: 'Đã xóa địa chỉ',
                deleteError: 'Không thể xóa địa chỉ',
                defaulted: 'Đã đặt làm mặc định',
                defaultError: 'Không thể đặt mặc định',
                editAddress: 'Sửa địa chỉ',
                addAddress: 'Thêm địa chỉ mới',
                recipient: 'Tên người nhận',
                phone: 'Số điện thoại',
                defaultCheckbox: 'Đặt làm địa chỉ mặc định',
                cancel: 'Hủy',
                save: 'Lưu địa chỉ',
                empty: 'Chưa có địa chỉ nào. Thêm địa chỉ nhận hàng để thanh toán nhanh hơn.',
                default: 'Mặc định',
                edit: 'Sửa',
                setDefault: 'Đặt mặc định',
                delete: 'Xóa',
                addNew: 'Thêm địa chỉ mới',
                detailPlaceholder: 'Số nhà, tên đường...',
                needsRegion: 'Cần chọn lại địa chỉ',
              }
            : {
                missingTitle: 'Missing information',
                errorTitle: 'Error',
                missingDesc: 'Enter name, phone number, and full address.',
                updated: 'Address updated',
                added: 'Address added',
                saveError: 'Could not save address',
                deleted: 'Address deleted',
                deleteError: 'Could not delete address',
                defaulted: 'Set as default address',
                defaultError: 'Could not set default',
                editAddress: 'Edit address',
                addAddress: 'Add new address',
                recipient: 'Recipient name',
                phone: 'Phone number',
                defaultCheckbox: 'Set as default address',
                cancel: 'Cancel',
                save: 'Save address',
                empty: 'No addresses yet. Add one for faster checkout.',
                default: 'Default',
                edit: 'Edit',
                setDefault: 'Set default',
                delete: 'Delete',
                addNew: 'Add new address',
                detailPlaceholder: 'Street number, street name...',
                needsRegion: 'Needs re-picking',
              };
    const [addresses, setAddresses] = useState<SavedAddress[]>([]);
    const [loading, setLoading] = useState(true);
    const [mode, setMode] = useState<'list' | 'form'>('list');
    const [editing, setEditing] = useState<SavedAddress | null>(null);
    const [form, setForm] = useState<FormState>(emptyForm);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
    const mutationLocksRef = useRef(new Set<string>());

    const emitList = useCallback((list: SavedAddress[]) => {
        setAddresses(list);
        onAddressesChange?.(list);
    }, [onAddressesChange]);

    const load = useCallback(async (autoSelect: boolean) => {
        setLoading(true);
        try {
            const res = await fetch('/api/shipping-addresses');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            const list: SavedAddress[] = data.addresses ?? [];
            emitList(list);
            // In checkout mode, pre-select the default (or first) address once.
            const pick = autoSelect && selectable ? pickDefaultAddress(list) : null;
            if (pick) onSelect?.(pick);
            if (list.length === 0) setMode('list');
        } catch (err) {
            console.error('Failed to load addresses:', err);
            toast({
                variant: 'destructive',
                title: copy.errorTitle,
                description: err instanceof Error ? err.message : copy.saveError,
            });
        } finally {
            setLoading(false);
        }
    }, [copy.errorTitle, copy.saveError, emitList, onSelect, selectable, toast]);

    useEffect(() => {
        void load(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const openCreate = () => {
        setEditing(null);
        setForm({ ...emptyForm, isDefault: addresses.length === 0 });
        setMode('form');
    };

    const openEdit = (addr: SavedAddress) => {
        setEditing(addr);
        setForm({
            name: addr.recipient_name,
            phone: addr.phone,
            // The picker re-emits the saved ids once its lists load. A row
            // saved before addresses moved to GoShip's geography has none, so
            // it stays null until the buyer picks — which is the point of
            // opening it.
            goship: addr.goship,
            detail: addr.detail,
            isDefault: addr.is_default,
        });
        setMode('form');
    };

    const handleGoshipChange = useCallback((region: GoshipRegion | null) => {
        setForm(f => ({ ...f, goship: region }));
    }, []);

    const handleSave = async () => {
        if (!form.name.trim() || !form.phone.trim() || !form.goship || !form.detail.trim()) {
            toast({ variant: 'destructive', title: copy.missingTitle, description: copy.missingDesc });
            return;
        }
        setSaving(true);
        try {
            // Just the carrier's ids and the street. The province/ward names
            // are filled in server-side from GoShip's own lists, so there is
            // nothing here for the browser to get wrong.
            const payload = {
                recipient_name: form.name,
                phone: form.phone,
                goship: form.goship,
                detail: form.detail,
                is_default: form.isDefault,
            };
            const res = await fetch(
                editing ? `/api/shipping-addresses/${editing.id}` : '/api/shipping-addresses',
                {
                    method: editing ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            const saved: SavedAddress = data.address;
            setMode('list');
            setEditing(null);
            await load(false);
            // After save, select it in checkout mode so the user can pay right away.
            if (selectable) onSelect?.(saved);
            toast({ title: editing ? copy.updated : copy.added });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : copy.saveError;
            toast({ variant: 'destructive', title: copy.errorTitle, description: message });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (addr: SavedAddress) => {
        const lockKey = `delete:${addr.id}`;
        if (mutationLocksRef.current.has(lockKey)) return;
        mutationLocksRef.current.add(lockKey);
        setDeletingId(addr.id);
        try {
            const res = await fetch(`/api/shipping-addresses/${addr.id}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            const remaining = addresses.filter(a => a.id !== addr.id);
            emitList(remaining);
            if (selectable && selectedId === addr.id) {
                onSelect?.(remaining.find(a => a.is_default) ?? remaining[0] ?? null);
            }
            await load(false);
            toast({ title: copy.deleted });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : copy.deleteError;
            toast({ variant: 'destructive', title: copy.errorTitle, description: message });
        } finally {
            mutationLocksRef.current.delete(lockKey);
            setDeletingId(null);
        }
    };

    const handleSetDefault = async (addr: SavedAddress) => {
        const lockKey = `default:${addr.id}`;
        if (mutationLocksRef.current.has(lockKey)) return;
        mutationLocksRef.current.add(lockKey);
        setSettingDefaultId(addr.id);
        try {
            const res = await fetch(`/api/shipping-addresses/${addr.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_default: true }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            await load(false);
            toast({ title: copy.defaulted });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : copy.defaultError;
            toast({ variant: 'destructive', title: copy.errorTitle, description: message });
        } finally {
            mutationLocksRef.current.delete(lockKey);
            setSettingDefaultId(null);
        }
    };

    // ── Form view ──
    if (mode === 'form') {
        return (
            <div className="space-y-3">
                <button
                    type="button"
                    onClick={() => { setMode('list'); setEditing(null); }}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="h-4 w-4" />
                    {editing ? copy.editAddress : copy.addAddress}
                </button>

                <div className="grid grid-cols-2 gap-2">
                    <Input
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        placeholder={copy.recipient}
                        className="h-9 text-sm"
                    />
                    <Input
                        value={form.phone}
                        onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                        placeholder={copy.phone}
                        className="h-9 text-sm"
                    />
                </div>

                {/* Tỉnh → Quận/Huyện → Phường/Xã in GoShip's geography, the
                    same lists the seller picks their sender address from, so
                    both ends of a waybill sit in one structure and nothing is
                    translated between the 2025 map and the carrier's.

                    Keyed per row: the picker seeds its selections from the
                    address it mounts with, so switching from one address to
                    another (or to a blank "add") has to be a remount. */}
                <GoshipRegionPicker
                    key={`goship-${editing?.id ?? 'new'}`}
                    idPrefix={`ab-${editing?.id ?? 'new'}`}
                    value={editing?.goship ?? null}
                    onChange={handleGoshipChange}
                />
                <Input
                    value={form.detail}
                    onChange={e => setForm(f => ({ ...f, detail: e.target.value }))}
                    placeholder={copy.detailPlaceholder}
                    maxLength={255}
                    className="h-9 text-sm"
                />

                <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                        type="checkbox"
                        checked={form.isDefault}
                        disabled={addresses.length === 0}
                        onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))}
                        className="h-4 w-4 accent-orange-500"
                    />
                    {copy.defaultCheckbox}
                </label>

                <div className="flex gap-2 pt-1">
                    <Button variant="outline" className="flex-1" onClick={() => { setMode('list'); setEditing(null); }}>
                        {copy.cancel}
                    </Button>
                    <Button
                        className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                        onClick={handleSave}
                        disabled={saving || !form.goship || !form.detail.trim()}
                    >
                        {copy.save}
                    </Button>
                </div>
            </div>
        );
    }

    // ── List view ──
    return (
        <div className="space-y-2">
            {loading ? (
                <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
            ) : addresses.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 p-4 text-center text-sm text-muted-foreground">
                    {copy.empty}
                </div>
            ) : (
                addresses.map(addr => {
                    const selected = selectable && selectedId === addr.id;
                    // No carrier ids: saved before addresses moved to GoShip's
                    // geography. Picking it at checkout would place an order
                    // no waybill can be booked for, so the click opens the
                    // form instead and the badge says why.
                    const needsRegion = !addr.goship;
                    return (
                        <div
                            key={addr.id}
                            onClick={selectable ? () => (needsRegion ? openEdit(addr) : onSelect?.(addr)) : undefined}
                            className={`rounded-lg border p-3 transition-colors ${
                                selectable ? 'cursor-pointer' : ''
                            } ${selected ? 'border-orange-500 bg-orange-500/5' : 'border-border/50 hover:bg-accent/40'}`}
                        >
                            <div className="flex items-start gap-2.5">
                                {selectable && (
                                    <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border flex items-center justify-center ${
                                        selected ? 'border-orange-500 bg-orange-500' : 'border-muted-foreground/40'
                                    }`}>
                                        {selected && <Check className="h-3 w-3 text-white" />}
                                    </div>
                                )}
                                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-semibold text-sm">{addr.recipient_name}</span>
                                        <span className="text-xs text-muted-foreground">{addr.phone}</span>
                                        {addr.is_default && (
                                            <span className="inline-flex items-center gap-1 rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-medium text-orange-500">
                                                <Star className="h-2.5 w-2.5 fill-orange-500" /> {copy.default}
                                            </span>
                                        )}
                                        {needsRegion && (
                                            <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
                                                {copy.needsRegion}
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                                        {[addr.detail, addr.ward_name, addr.district_name, addr.province_name].filter(Boolean).join(', ')}
                                    </p>
                                    <div className="mt-1.5 flex items-center gap-3 text-xs">
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); openEdit(addr); }}
                                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                                        >
                                            <Pencil className="h-3 w-3" /> {copy.edit}
                                        </button>
                                        {!addr.is_default && (
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); handleSetDefault(addr); }}
                                                disabled={settingDefaultId === addr.id}
                                                className="inline-flex items-center gap-1 text-muted-foreground hover:text-orange-500"
                                            >
                                                {settingDefaultId === addr.id
                                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                                    : <Star className="h-3 w-3" />} {copy.setDefault}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); handleDelete(addr); }}
                                            disabled={deletingId === addr.id}
                                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-red-400"
                                        >
                                            {deletingId === addr.id
                                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                                : <Trash2 className="h-3 w-3" />} {copy.delete}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })
            )}

            {!loading && (
                <Button variant="outline" className="w-full border-dashed" onClick={openCreate}>
                    <Plus className="h-4 w-4 mr-1.5" /> {copy.addNew}
                </Button>
            )}
        </div>
    );
}
