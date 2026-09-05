'use client';

import { useState } from 'react';
import { Video } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getCloudinarySignature, uploadVideoDirectToCloudinary } from '@/lib/cloudinary-direct';
import {
  EVIDENCE_VIDEO_ACCEPT,
  EVIDENCE_VIDEO_FOLDER,
  EVIDENCE_VIDEO_MAX_BYTES,
  isAcceptableEvidenceVideoFile,
} from '@/lib/evidence-video';

/**
 * The seller's packing video, offered at dispatch.
 *
 * Shared because a seller can ship from either the orders list or an order's
 * own page, and the video is accepted at that one moment — a dialog that
 * omitted it would quietly cost the seller every dispute the buyer filmed.
 */
export function PackingVideoField({
  value,
  onChange,
  locale,
  disabled,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  locale: string;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const maxMb = Math.round(EVIDENCE_VIDEO_MAX_BYTES / (1024 * 1024));
  const tx = (vi: string, en: string, ja: string) =>
    (locale === 'ja-JP' ? ja : locale === 'en-US' ? en : vi);

  const pick = async (file: File) => {
    if (!isAcceptableEvidenceVideoFile(file)) {
      toast({
        variant: 'destructive',
        title: tx('Video không hợp lệ', 'Invalid video', '無効な動画'),
        description: tx(
          `Chọn một tệp video dưới ${maxMb}MB.`,
          `Pick a video file under ${maxMb}MB.`,
          `${maxMb}MB 未満の動画を選んでください。`,
        ),
      });
      return;
    }
    setBusy(true);
    try {
      const signature = await getCloudinarySignature(EVIDENCE_VIDEO_FOLDER);
      const { secureUrl } = await uploadVideoDirectToCloudinary(file, signature);
      onChange(secureUrl);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: tx('Lỗi', 'Error', 'エラー'),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 rounded-lg border border-border/60 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Video className="h-4 w-4 text-orange-400" />
        {tx('Video đóng gói (không bắt buộc)', 'Packing video (optional)', '梱包動画（任意）')}
      </p>
      <p className="text-xs leading-5 text-muted-foreground">
        {tx(
          'Chỉ nhận ở bước này, không đính thêm được về sau. Nếu có tranh chấp mà bạn không có video còn người mua có, phần thua thuộc về bạn.',
          'Accepted at this step only — it cannot be attached later. If a dispute follows and you have no video while the buyer does, you lose it.',
          'この時点でのみ受け付けます。後から追加はできません。',
        )}
      </p>
      {value ? (
        <p className="text-xs text-emerald-300">{tx('Đã tải video lên.', 'Video uploaded.', '動画をアップロードしました。')}</p>
      ) : (
        <input
          type="file"
          accept={EVIDENCE_VIDEO_ACCEPT}
          disabled={busy || disabled}
          onChange={async e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) await pick(file);
          }}
          className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-orange-500/15 file:px-3 file:py-1.5 file:text-orange-300"
        />
      )}
      {busy && <p className="text-xs text-muted-foreground">{tx('Đang tải lên…', 'Uploading…', 'アップロード中…')}</p>}
    </div>
  );
}
