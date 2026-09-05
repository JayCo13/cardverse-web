/**
 * Dispute evidence videos — the packing video a seller may attach at dispatch,
 * and the unboxing video a buyer may attach on delivery.
 *
 * The browser uploads straight to Cloudinary and posts back the resulting URL,
 * so the server has to check that what came back is a video in our own account
 * and our own evidence folder. Without that check a party could point the order
 * at any URL on the internet and the reviewer would be judging a file we never
 * received.
 */

export const EVIDENCE_VIDEO_FOLDER = 'cardverse/orders/evidence';

/** Cloudinary's own ceiling for a single unsigned-size upload on most plans. */
export const EVIDENCE_VIDEO_MAX_BYTES = 100 * 1024 * 1024;

export const EVIDENCE_VIDEO_ACCEPT = 'video/*';

export function isAcceptableEvidenceVideoFile(file: File): boolean {
  return file.type.startsWith('video/') && file.size > 0 && file.size <= EVIDENCE_VIDEO_MAX_BYTES;
}

/**
 * True only for a Cloudinary video URL in our cloud and our evidence folder.
 * `cloudName` is the server's own configured value, never one from the request.
 */
export function isEvidenceVideoUrl(url: unknown, cloudName: string | undefined): url is string {
  if (typeof url !== 'string' || !cloudName) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname !== 'res.cloudinary.com') return false;
  // /<cloud>/video/upload/<transformations...>/<folder>/<public_id>.<ext>
  const path = parsed.pathname;
  return path.startsWith(`/${cloudName}/video/upload/`)
    && path.includes(`/${EVIDENCE_VIDEO_FOLDER}/`);
}
