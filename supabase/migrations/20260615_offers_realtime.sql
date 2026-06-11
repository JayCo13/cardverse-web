-- Cho phép client subscribe realtime trên bảng offers (chat drawer cập nhật
-- banner đề nghị ngay khi giá/trạng thái thay đổi mà không cần refresh).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.offers;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
