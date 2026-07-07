'use client';

import { useEffect, useState } from 'react';
import { AddressPicker, type AddressData } from '@/components/address-picker';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSupabase, useUser } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useLocalization } from '@/context/localization-context';
import { Loader2, Save } from 'lucide-react';

type SellerAddressFormProps = {
  /** Called after the address is successfully saved to the seller's profile. */
  onSaved?: (address: AddressData) => void;
  submitLabel?: string;
};

/**
 * Lets an approved seller set/update their **pickup address** (the GHN "from"
 * address stored on `profiles.address_*`). This is required before listing a
 * card so the marketplace can calculate shipping fees for buyers.
 */
export function SellerAddressForm({ onSaved, submitLabel }: SellerAddressFormProps) {
  const supabase = useSupabase();
  const { user } = useUser();
  const { toast } = useToast();
  const { locale } = useLocalization();

  const copy = locale === 'ja-JP'
    ? {
        submit: '集荷住所を保存',
        incompleteTitle: '住所が未入力です',
        incompleteDesc: '都道府県、市区町村、町名をすべて選択してください。',
        savedTitle: '集荷住所を保存しました',
        savedDesc: 'これでカードを出品できます。',
        errorTitle: 'エラー',
        errorDesc: '住所を保存できませんでした。',
        detailPlaceholder: '番地、通り名...',
      }
    : locale === 'vi-VN'
      ? {
          submit: 'Lưu địa chỉ lấy hàng',
          incompleteTitle: 'Địa chỉ chưa đầy đủ',
          incompleteDesc: 'Vui lòng chọn đầy đủ Tỉnh/Thành, Quận/Huyện và Phường/Xã.',
          savedTitle: 'Đã lưu địa chỉ lấy hàng',
          savedDesc: 'Bây giờ bạn có thể đăng bán thẻ.',
          errorTitle: 'Lỗi',
          errorDesc: 'Không thể lưu địa chỉ.',
          detailPlaceholder: 'Số nhà, tên đường...',
        }
      : {
          submit: 'Save pickup address',
          incompleteTitle: 'Address is incomplete',
          incompleteDesc: 'Please select province/city, district, and ward.',
          savedTitle: 'Pickup address saved',
          savedDesc: 'You can list cards now.',
          errorTitle: 'Error',
          errorDesc: 'Could not save address.',
          detailPlaceholder: 'Street number, street name...',
        };

  const [initial, setInitial] = useState<Partial<AddressData> | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [address, setAddress] = useState<AddressData | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Prefill from any address the seller already saved.
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select(
          'address_province_id, address_province_name, address_district_id, address_district_name, address_ward_code, address_ward_name, address_detail'
        )
        .eq('id', user.id)
        .single();
      if (!active) return;
      const p = data as Record<string, any> | null;
      if (p?.address_district_id && p?.address_ward_code) {
        const existing: AddressData = {
          provinceId: p.address_province_id,
          provinceName: p.address_province_name || '',
          districtId: p.address_district_id,
          districtName: p.address_district_name || '',
          wardCode: p.address_ward_code,
          wardName: p.address_ward_name || '',
          detail: p.address_detail || '',
        };
        setInitial(existing);
        setAddress(existing);
      }
      setIsLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [user, supabase]);

  const handleSave = async () => {
    if (!user || !address) {
      toast({
        variant: 'destructive',
        title: copy.incompleteTitle,
        description: copy.incompleteDesc,
      });
      return;
    }
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          address_province_id: address.provinceId,
          address_province_name: address.provinceName,
          address_district_id: address.districtId,
          address_district_name: address.districtName,
          address_ward_code: address.wardCode,
          address_ward_name: address.wardName,
          address_detail: address.detail,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', user.id);
      if (error) throw error;
      toast({ title: copy.savedTitle, description: copy.savedDesc });
      onSaved?.(address);
    } catch (err: any) {
      toast({ variant: 'destructive', title: copy.errorTitle, description: err.message || copy.errorDesc });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AddressPicker value={initial} onChange={setAddress} detailPlaceholder={copy.detailPlaceholder} />
      <Button
        type="button"
        onClick={handleSave}
        disabled={isSaving || !address}
        className="bg-orange-500 hover:bg-orange-600 text-white"
      >
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
        {submitLabel ?? copy.submit}
      </Button>
    </div>
  );
}
