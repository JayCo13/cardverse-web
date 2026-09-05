'use client';

import { useEffect, useState } from 'react';

/** One object URL per mounted file, including cleanup on replacement. */
export function FilePreview({ file, alt, className }: { file: File; alt: string; className?: string }) {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (preview?.file !== file) return <div className={className} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={preview.url} alt={alt} className={className} />;
}
