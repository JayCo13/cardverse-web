"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X, SpinnerGap } from "@phosphor-icons/react";

/**
 * Live camera scanner with an alignment frame. The user fills the card into
 * the 3:4 frame and taps to capture; we crop to exactly that frame region so
 * the card fills the image (no manual zoom needed). Returns a base64 JPEG
 * (no data-URL prefix). Falls back gracefully if the camera can't open.
 */
export function CameraScanner({
    open,
    onClose,
    onCapture,
}: {
    open: boolean;
    onClose: () => void;
    onCapture: (base64Jpeg: string) => void;
}) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const frameRef = useRef<HTMLDivElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setError(null);
        setReady(false);

        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
                    audio: false,
                });
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play().catch(() => { });
                    setReady(true);
                }
            } catch {
                setError('Không mở được camera. Hãy cấp quyền camera, hoặc dùng "Chọn ảnh từ thiết bị".');
            }
        })();

        return () => {
            cancelled = true;
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        };
    }, [open]);

    const capture = () => {
        const video = videoRef.current;
        const frame = frameRef.current;
        if (!video || !frame || !video.videoWidth) return;

        const vW = video.videoWidth;
        const vH = video.videoHeight;
        const rect = video.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();

        // The <video> uses object-cover — map the on-screen frame box back to
        // the video's intrinsic pixels so we crop exactly what the user framed.
        const scale = Math.max(rect.width / vW, rect.height / vH);
        const offX = (rect.width - vW * scale) / 2;
        const offY = (rect.height - vH * scale) / 2;

        let sx = (frameRect.left - rect.left - offX) / scale;
        let sy = (frameRect.top - rect.top - offY) / scale;
        let sw = frameRect.width / scale;
        let sh = frameRect.height / scale;

        sx = Math.max(0, Math.min(sx, vW));
        sy = Math.max(0, Math.min(sy, vH));
        sw = Math.min(sw, vW - sx);
        sh = Math.min(sh, vH - sy);

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(sw);
        canvas.height = Math.round(sh);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        onCapture(dataUrl.split(",")[1]);
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[110] bg-black flex flex-col">
            <div className="flex items-center justify-between p-4 text-white">
                <span className="text-sm font-semibold">Đưa thẻ vào khung</span>
                <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10" aria-label="Đóng">
                    <X className="w-5 h-5" />
                </button>
            </div>

            <div className="relative flex-1 overflow-hidden">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover" />

                {/* Alignment frame with dimmed surroundings */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div
                        ref={frameRef}
                        className="relative w-[78%] max-w-[340px] aspect-[3/4] rounded-2xl"
                        style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }}
                    >
                        <span className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-orange-400 rounded-tl-2xl" />
                        <span className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-orange-400 rounded-tr-2xl" />
                        <span className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-orange-400 rounded-bl-2xl" />
                        <span className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-orange-400 rounded-br-2xl" />
                        {ready && <div className="scan-beam rounded-2xl" />}
                    </div>
                </div>

                {!ready && !error && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <SpinnerGap className="w-8 h-8 animate-spin text-orange-400" weight="bold" />
                    </div>
                )}
                {error && (
                    <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80 bg-black/80">
                        {error}
                    </div>
                )}
            </div>

            <div className="p-6 flex flex-col items-center gap-3">
                <button
                    onClick={capture}
                    disabled={!ready}
                    className="w-16 h-16 rounded-full bg-orange-500 hover:bg-orange-600 ring-4 ring-white/20 flex items-center justify-center shadow-[0_0_25px_rgba(249,115,22,0.6)] active:scale-95 transition disabled:opacity-40"
                    aria-label="Chụp"
                >
                    <Camera className="w-7 h-7 text-white" weight="fill" />
                </button>
                <p className="text-xs text-white/40">Căn thẻ kín khung rồi bấm để quét</p>
            </div>
        </div>
    );
}
