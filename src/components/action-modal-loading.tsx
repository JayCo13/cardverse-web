"use client";

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocalization } from '@/context/localization-context';

export function ActionModalLoading() {
  const { locale } = useLocalization();
  const label = locale.startsWith('vi') ? 'Đang tải…' : locale.startsWith('ja') ? '読み込み中…' : 'Loading…';
  return <Dialog open>
    <DialogContent aria-describedby={undefined} aria-busy="true" className="sm:max-w-md">
      <DialogTitle>{label}</DialogTitle>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-36 w-full" />
    </DialogContent>
  </Dialog>;
}
