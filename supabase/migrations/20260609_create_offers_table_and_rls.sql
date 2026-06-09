-- Tạo bảng offers nếu chưa tồn tại
CREATE TABLE IF NOT EXISTS public.offers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  price bigint NOT NULL,
  message text,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'chosen'::text])),
  transaction_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT offers_pkey PRIMARY KEY (id),
  CONSTRAINT offers_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE CASCADE,
  CONSTRAINT offers_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- Bật RLS
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

-- Cấp quyền cho authenticated role để PostgREST có thể thấy bảng (tránh lỗi 404)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.offers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.offers TO anon;

-- Xóa policies cũ nếu có để tránh lỗi trùng lặp khi chạy lại
DROP POLICY IF EXISTS "Buyers can insert their own offers" ON public.offers;
DROP POLICY IF EXISTS "Users can view relevant offers" ON public.offers;
DROP POLICY IF EXISTS "Buyers can update pending offers" ON public.offers;
DROP POLICY IF EXISTS "Sellers can update offers for their cards" ON public.offers;

-- Policies

-- 1. Người mua có thể tạo offer của chính họ
CREATE POLICY "Buyers can insert their own offers"
  ON public.offers FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = buyer_id);

-- 2. Người mua xem offer của mình, người bán xem offer cho thẻ của họ
CREATE POLICY "Users can view relevant offers"
  ON public.offers FOR SELECT
  TO authenticated
  USING (
    auth.uid() = buyer_id 
    OR auth.uid() IN (SELECT seller_id FROM public.cards WHERE cards.id = card_id)
  );

-- 3. Người mua có thể cập nhật offer (sửa giá/lời nhắn) nếu đang pending
CREATE POLICY "Buyers can update pending offers"
  ON public.offers FOR UPDATE
  TO authenticated
  USING (auth.uid() = buyer_id AND status = 'pending');

-- 4. Người bán có thể cập nhật trạng thái offer (chấp nhận/từ chối)
CREATE POLICY "Sellers can update offers for their cards"
  ON public.offers FOR UPDATE
  TO authenticated
  USING (auth.uid() IN (SELECT seller_id FROM public.cards WHERE cards.id = card_id));

-- Buộc PostgREST reload schema cache ngay lập tức để nhận bảng mới
NOTIFY pgrst, 'reload schema';
