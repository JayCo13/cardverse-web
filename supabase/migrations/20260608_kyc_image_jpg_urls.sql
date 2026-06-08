-- Backfill KYC image URLs so HEIC/HEIF originals render in browsers (web + admin panel).
--
-- The seller KYC flow used to store the raw Cloudinary secure_url. iPhone uploads are
-- HEIC, whose .heic delivery URLs Chrome/admin cannot render, so CCCD front/back images
-- appear broken in the admin "KYC Sellers" view. New submissions are fixed at upload time
-- (see src/lib/cloudinary-url.ts toDisplaySafeUrl); this migration repairs existing rows.
--
-- Mirrors getCloudinaryJpgUrl(): insert f_jpg,q_auto/ after /upload/ and rewrite the
-- .heic/.heif extension to .jpg. Only touches res.cloudinary.com URLs that don't already
-- carry an f_jpg transform, so it is idempotent.

do $$
declare
    col text;
begin
    foreach col in array array['id_card_front_url', 'id_card_back_url', 'bank_screenshot_url']
    loop
        -- 1) Insert the f_jpg,q_auto transform after /upload/ when missing.
        execute format(
            $f$
            update public.seller_verifications
            set %1$I = regexp_replace(%1$I, '/upload/', '/upload/f_jpg,q_auto/')
            where %1$I like '%%res.cloudinary.com%%'
              and %1$I like '%%/upload/%%'
              and %1$I not like '%%f_jpg%%'
            $f$, col
        );

        -- 2) Rewrite .heic/.heif extension (keeping any ?query) to .jpg.
        execute format(
            $f$
            update public.seller_verifications
            set %1$I = regexp_replace(%1$I, '\.(heic|heif)(\?.*)?$', '.jpg\2', 'i')
            where %1$I like '%%res.cloudinary.com%%'
              and %1$I ~* '\.(heic|heif)(\?.*)?$'
            $f$, col
        );
    end loop;
end $$;
