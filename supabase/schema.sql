-- ============================================================
-- 인재풀 통합 DB — Supabase Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS talent_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 인물 식별자 (GAS M열에서 생성, 이직 추적 키)
  person_id     TEXT UNIQUE,            -- N열 UUID (generatePersonIds로 생성)

  -- 출처
  source_sheet  TEXT NOT NULL,          -- 통합_ 시트명 (예: 통합_APR)
  company       TEXT NOT NULL,          -- A열 회사명

  -- 인물
  name          TEXT,                   -- B열 이름 (국문, 영문+국문 병기 가능)
  remember_url  TEXT,                   -- C열 리멤버 페이지 URL
  linkedin_url  TEXT,                   -- D열 링크드인 페이지 URL

  -- 직무
  job_category  TEXT,                   -- E열 대분류(직무)
  team          TEXT,                   -- F열 팀
  role          TEXT,                   -- G열 직책

  -- 경력
  total_career  TEXT,                   -- H열 총 경력
  tenure        TEXT,                   -- I열 재직 기간 (정규화된 포맷)
  tenure_start  TEXT,                   -- YYYY.MM (입사일 — 정렬용)
  prev_career   TEXT,                   -- J열 이전 경력

  -- 기타
  education     TEXT,                   -- K열 학력
  region        TEXT,                   -- Region 태그

  -- 메타
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 (검색 성능)
CREATE INDEX IF NOT EXISTS idx_talent_person_id    ON talent_profiles (person_id);
CREATE INDEX IF NOT EXISTS idx_talent_company      ON talent_profiles (company);
CREATE INDEX IF NOT EXISTS idx_talent_source_sheet ON talent_profiles (source_sheet);
CREATE INDEX IF NOT EXISTS idx_talent_tenure_start ON talent_profiles (tenure_start DESC);
CREATE INDEX IF NOT EXISTS idx_talent_job_category ON talent_profiles (job_category);

-- RLS 활성화
ALTER TABLE talent_profiles ENABLE ROW LEVEL SECURITY;

-- 공개 읽기 허용 (anon key — 프론트엔드 직접 조회용)
DROP POLICY IF EXISTS "public read" ON talent_profiles;
CREATE POLICY "public read"
  ON talent_profiles FOR SELECT
  TO anon
  USING (true);

-- service_role은 모든 작업 허용 (GAS sync용)
DROP POLICY IF EXISTS "service full access" ON talent_profiles;
CREATE POLICY "service full access"
  ON talent_profiles FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 마이그레이션 (기존 테이블에 person_id 추가 시 1회 실행)
-- ============================================================
-- ALTER TABLE talent_profiles ADD COLUMN IF NOT EXISTS person_id TEXT UNIQUE;
-- CREATE INDEX IF NOT EXISTS idx_talent_person_id ON talent_profiles (person_id);
--
-- 기존 1000건 재업로드 순서:
-- 1. GAS: [🆔 person_id 일괄 생성 (M열)] 실행
-- 2. Supabase 대시보드 SQL: TRUNCATE talent_profiles;   ← 기존 데이터 초기화
-- 3. GAS: [📤 모든 통합_ 시트 일괄 업로드] 실행
