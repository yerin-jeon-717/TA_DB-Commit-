-- ============================================================
-- RLS 정책 변경: public read → 로그인 사용자만 읽기 허용
-- Supabase 대시보드 > SQL Editor에서 실행
-- ============================================================

-- 기존 public read 정책 제거
DROP POLICY IF EXISTS "public read" ON talent_profiles;

-- 로그인한 사용자만 읽기 허용
CREATE POLICY "authenticated read"
  ON talent_profiles FOR SELECT
  TO authenticated
  USING (true);
