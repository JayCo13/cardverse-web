'use client';

import { useEffect, useState } from 'react';
import { AddressPicker, type AddressData } from '@/components/address-picker';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSupabase, useUser } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
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
export function SellerAddressForm({ onSaved, submitLabel = 'Lưu địa chỉ lấy hàng' }: SellerAddressFormProps) {
  const supabase = useSupabase();
  const { user } = useUser();
  const { toast } = useToast();

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
        title: 'Địa chỉ chưa đầy đủ',
        description: 'Vui lòng chọn đầy đủ Tỉnh/Thành, Quận/Huyện và Phường/Xã.',
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
        } as Record<string, unknown>)
        .eq('id', user.id);
      if (error) throw error;
      toast({ title: '✅ Đã lưu địa chỉ lấy hàng', description: 'Bây giờ bạn có thể đăng bán thẻ.' });
      onSaved?.(address);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Lỗi', description: err.message || 'Không thể lưu địa chỉ.' });
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
      <AddressPicker value={initial} onChange={setAddress} detailPlaceholder="Số nhà, tên đường..." />
      <Button
        type="button"
        onClick={handleSave}
        disabled={isSaving || !address}
        className="bg-orange-500 hover:bg-orange-600 text-white"
      >
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
        {submitLabel}
      </Button>
    </div>
  );
}
