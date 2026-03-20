# 리멤버 → 나인하이어 지원자 연동 자동화 파이프라인

> **문서 목적**: 이 문서는 개발 담당자에게 프로젝트 인수인계를 위해 작성됩니다.
> 현업 배경 지식 없이도 전체 구조와 진행 현황을 파악할 수 있도록 작성하였습니다.

---

## 1. 배경 및 목적

### 1.1 현황

바이오던스(Biodance)는 채용 플랫폼 **리멤버(Remember)**를 통해 지원자를 받고 있으며,
채용 관리 시스템(ATS)으로 **나인하이어(NineHire)**를 사용하고 있습니다.

### 1.2 문제

현재는 담당자가 리멤버 채용 관리 페이지에서 지원자 정보를 **수동으로 확인**하고,
나인하이어에 **수동으로 입력**하는 방식으로 운영 중입니다.

- 공고 수: 약 **40개** (상시 운영 중)
- 공고당 지원자: 수십~수백 명
- 문제: 수작업으로 인한 누락, 중복 입력 오류, 담당자 리소스 낭비

### 1.3 목표

```
리멤버 지원자 데이터 자동 수집
        ↓
나인하이어 기등록자와 중복 제거
        ↓
신규 지원자만 업로드용 파일 생성
        ↓
담당자가 나인하이어에 수동 업로드 (최소 개입)
```

---

## 2. 시스템 구성

### 2.1 관련 플랫폼

| 플랫폼 | 역할 | URL |
|--------|------|-----|
| 리멤버(Remember) | 지원자 접수 플랫폼 | `career.rememberapp.co.kr` |
| 나인하이어(NineHire) | 채용 관리 시스템(ATS) | `app.ninehire.com` |

### 2.2 프로젝트 디렉토리 구조

```
TA_DB/
├── scripts/
│   ├── remember_auth.py              # 리멤버 자동 로그인 (Playwright)
│   ├── remember_applicant_download.py # 리멤버 지원자 일괄 다운로드
│   ├── remember_file_rename.py       # 다운로드 파일명 정규화 (선택)
│   └── ninehire_dedup.py             # 나인하이어 중복 제거 + 업로드 CSV 생성
├── output/
│   ├── remember_applicants/          # 리멤버 다운로드 결과물
│   │   └── YYYYMMDD_{포지션명}/
│   │       ├── applicants.csv        # 지원자 목록
│   │       └── files/               # 이력서 PDF, 첨부파일
│   └── upload_ready/
│       └── YYYYMMDD_upload_ready.csv # 나인하이어 업로드용 (중복 제거 후)
├── data/
│   └── ninehire_uploaded.json        # 나인하이어 업로드 이력 (로컬 관리)
├── .env                              # 인증 정보 (비공개 — 아래 참고)
└── docs/
    └── remember-ninehire-pipeline.md # 이 문서
```

---

## 3. 개발 완료 내용

### 3.1 리멤버 자동 로그인 (`remember_auth.py`)

**기능**: 리멤버 채용 관리 페이지에 자동 로그인하여 API 인증 토큰을 발급받습니다.

**상세 동작**:
1. Playwright(브라우저 자동화 도구)로 Chrome 브라우저를 열어 리멤버 로그인 페이지 접속
2. 이메일/비밀번호 자동 입력
3. SMS 2단계 인증(MFA) 처리:
   - "인증번호 전송" 버튼 자동 클릭
   - 터미널에서 사용자가 SMS 코드를 직접 입력
   - 인증 코드 자동 입력 후 제출
4. 로그인 완료 후 API 요청에서 인증 토큰 캡처
5. 발급된 토큰을 `.env` 파일에 자동 저장

**인증 토큰 특성**:
- 리멤버 API는 `Token token=xxxxx` 형식의 32자리 HEX 토큰 사용
- 토큰은 세션마다 만료됨 → 스크립트 실행 시 자동 갱신

**사용 방법**:
```bash
# 토큰만 발급받고 싶을 때 (단독 실행)
python3 scripts/remember_auth.py
```
> SMS 인증번호 입력 프롬프트가 나타나면 핸드폰에서 받은 번호를 입력하면 됩니다.

---

### 3.2 리멤버 지원자 일괄 다운로드 (`remember_applicant_download.py`)

**기능**: 리멤버의 모든 활성 공고에서 지원자 정보와 이력서 파일을 일괄 다운로드합니다.

**상세 동작**:
1. `.env` 파일에서 인증 토큰 로드 → 토큰 유효성 검증
2. 토큰 만료 시: `remember_auth.py` 자동 호출 → 토큰 갱신 후 재시도
3. 리멤버 API로 전체 공고 목록 자동 조회 (현재 약 40개)
4. 공고별 지원자 목록 수집 (지원/승인/불합격 모든 단계 포함)
5. 지원자별 상세 프로필 조회 → 이력서 PDF 생성 및 다운로드
6. 공고별 폴더에 CSV + 이력서 파일 저장

**출력 파일**:
```
output/remember_applicants/
  20260320_[바이오던스] 채널 그로스 담당자/
    applicants.csv          ← 지원자 목록 (이름/연락처/이메일/지원일자/상태)
    files/
      이력서_홍길동_01012345678_resume.pdf
      첨부파일_홍길동_01012345678_portfolio.pdf
```

**CSV 컬럼 구조**:

| 컬럼 | 내용 | 예시 |
|------|------|------|
| 포지션명 | 공고 제목 | `[바이오던스] 채널 그로스 담당자` |
| 이름 | 지원자 성명 | `홍길동` |
| 연락처 | 휴대폰 번호 | `01012345678` |
| 이메일 | 이메일 주소 | `example@email.com` |
| 지원일자 | 지원서 접수 날짜 | `2026-03-10` |
| 지원상태 | 처리 단계 | `applied` / `approved` / `rejected` |
| 지원ID | 리멤버 내부 식별자 | `3128580` |

**사용 방법**:
```bash
# 전체 활성 공고 자동 다운로드 (가장 많이 사용)
python3 scripts/remember_applicant_download.py

# 특정 공고 ID만 다운로드
python3 scripts/remember_applicant_download.py --positions 301443,301444

# 공고 제목 키워드로 필터
python3 scripts/remember_applicant_download.py --filter 바이오던스

# 실행 로그 확인 (오류 발생 시)
cat remember_run.log
```

**리멤버 API 구조** (참고):

| 기능 | 방식 | URL |
|------|------|-----|
| 공고 목록 조회 | GET | `career-api.rememberapp.co.kr/recruiters/me/job_postings` |
| 지원자 목록 조회 | POST | `.../job_postings/{id}/applicants/list` |
| 지원자 상세 조회 | GET | `.../job_postings/{id}/applicants/{id}/open_profile` |
| 이력서 PDF 생성 | POST | `utils-api.rememberapp.co.kr/jsx/resume/download/career` |

---

### 3.3 이력서 파일명 정규화 (`remember_file_rename.py`)

**기능**: 다운로드된 이력서 파일을 규칙에 맞게 일괄 이름 변경합니다.

**파일명 변환 규칙**:
```
변환 전: resume_abc123.pdf
변환 후: 이력서_홍길동_01012345678_resume_abc123.pdf
         └──────┘ └────┘ └──────────┘
         문서유형  이름    연락처
```

문서 유형 자동 분류:
- `resume`, `이력서`, `cv` 포함 → **이력서**
- `portfolio`, `포트폴리오` 포함 → **포트폴리오**
- `cover letter`, `자기소개서` 포함 → **자기소개서**
- 그 외 → **첨부파일**

**사용 방법**:
```bash
# 최신 다운로드 폴더에 자동 적용
python3 scripts/remember_file_rename.py

# 결과 미리 보기 (실제 변경 없음)
python3 scripts/remember_file_rename.py --dry-run

# 특정 폴더 지정
python3 scripts/remember_file_rename.py --dir output/remember_applicants/20260320_바이오던스_마케터
```

> 이미 규칙에 맞는 파일명은 자동으로 건너뜁니다 (중복 변환 방지).

---

### 3.4 나인하이어 중복 제거 (`ninehire_dedup.py`)

**기능**: 리멤버 다운로드 데이터에서 나인하이어에 이미 등록된 지원자를 제거하고, 신규 지원자만 담은 업로드용 CSV를 생성합니다.

**중복 판정 기준**:
- **연락처(전화번호) 또는 이메일**이 일치하고
- **지원일자 차이가 7일 이내**인 경우 → 중복으로 처리

> ※ 7일 허용 오차를 두는 이유: 리멤버와 나인하이어의 날짜 기록 기준이 미세하게 다를 수 있기 때문입니다.

**중복 이력 관리 방식**:

나인하이어 API 인증 문제(세션 토큰 30분 만료, API Key 방식 미지원)로 인해 **로컬 파일 기반 이력 관리**를 채택하였습니다.

```
data/ninehire_uploaded.json  ← 나인하이어에 업로드된 지원자 이력 (누적 관리)
```

**사용 방법**:

```bash
# [최초 1회] 나인하이어 기존 지원자 데이터 임포트
# → NineHire에서 지원자 전체 내보내기(CSV) 후 실행
python3 scripts/ninehire_dedup.py --import data/ninehire_export.csv

# [매 실행] 중복 제거 + 업로드용 CSV 생성
python3 scripts/ninehire_dedup.py

# [업로드 직후] 나인하이어에 업로드한 목록을 이력에 기록
python3 scripts/ninehire_dedup.py --mark-uploaded output/upload_ready/20260320_upload_ready.csv

# 지원일자 허용 오차 변경 (기본 7일)
python3 scripts/ninehire_dedup.py --days 5
```

---

## 4. 전체 실행 순서 (담당자 운영 매뉴얼)

### 4.1 최초 1회 (초기 설정)

```
[1단계] 환경 설정
  → .env 파일에 리멤버 이메일/비밀번호 입력 (아래 환경 변수 참고)

[2단계] 나인하이어 기존 데이터 임포트
  → NineHire 접속 → 지원자 목록 → 전체 내보내기(CSV 다운로드)
  → 파일을 data/ 폴더에 저장
  → python3 scripts/ninehire_dedup.py --import data/ninehire_export.csv
```

### 4.2 이후 정기 실행 (반복 업무)

```bash
# Step 1. 리멤버 지원자 다운로드 (SMS 인증번호 입력 필요)
python3 scripts/remember_applicant_download.py

# Step 2. 중복 제거 → 업로드용 CSV 생성
python3 scripts/ninehire_dedup.py

# Step 3. NineHire 수동 업로드
#   → output/upload_ready/YYYYMMDD_upload_ready.csv 파일을 NineHire에 업로드

# Step 4. 업로드 이력 기록
python3 scripts/ninehire_dedup.py --mark-uploaded output/upload_ready/YYYYMMDD_upload_ready.csv
```

---

## 5. 환경 설정 (`.env` 파일)

프로젝트 루트의 `.env` 파일에 아래 값을 입력합니다.
(`.env` 파일은 보안상 Git에 포함되지 않습니다. `.env.example` 참고)

```env
# 리멤버 로그인 정보 (자동 토큰 발급용)
REMEMBER_EMAIL=your_email@company.com
REMEMBER_PASSWORD=your_password

# 리멤버 API 인증 토큰 (자동 갱신됨 — 직접 수정 불필요)
REMEMBER_AUTH_TOKEN=

# 다운로드 저장 경로 (기본값 유지 권장)
OUTPUT_DIR=output/remember_applicants

# 나인하이어 API Key (설정 > API 키 메뉴에서 확인)
NINEHIRE_API_KEY=
NINEHIRE_COMPANY_ID=f0b5bd00-4e82-11ec-be75-dd3d4f039103
```

> ⚠️ `.env` 파일은 절대 Git에 커밋하지 마세요. 비밀번호와 토큰이 포함됩니다.

---

## 6. 개발 환경 및 의존성

### 6.1 필수 설치

```bash
# Python 3.10 이상 필요
python3 --version

# Playwright 설치 (브라우저 자동화)
pip install playwright
playwright install chromium
```

### 6.2 그 외

- 리멤버 지원자 다운로드: Python 표준 라이브러리만 사용 (추가 패키지 불필요)
- 나인하이어 중복 제거: Python 표준 라이브러리만 사용

---

## 7. 미완료 과제 (추가 개발 필요)

### 7.1 [우선순위 높음] 나인하이어 초기 데이터 임포트

**현황**: 나인하이어에 이미 등록된 기존 지원자 데이터를 로컬 이력 파일에 반영하는 작업이 아직 완료되지 않았습니다.

**필요 작업**:
1. NineHire → 지원자 관리 → 전체 내보내기(CSV) 기능 확인 및 실행
2. 내보낸 CSV를 `data/` 폴더에 저장
3. `python3 scripts/ninehire_dedup.py --import data/ninehire_export.csv` 실행

**이 작업을 하지 않으면**: 이미 나인하이어에 등록된 지원자도 신규로 분류되어 중복 업로드될 수 있습니다.

---

### 7.2 [선택] SMS 인증 완전 자동화

**현황**: 리멤버 로그인 시 SMS 2단계 인증(MFA) 코드를 사람이 직접 입력해야 합니다.

**현재 동작 방식**:
```
스크립트 실행
    ↓
브라우저 자동으로 열림 (리멤버 로그인 페이지)
    ↓
이메일/비밀번호 자동 입력
    ↓
"SMS 인증번호를 입력하세요" 프롬프트 표시
    ↓
담당자가 핸드폰에서 인증번호 확인 후 터미널에 입력
    ↓
이후 모든 과정 자동화
```

**완전 자동화를 위해 필요한 것**: SMS를 직접 수신하여 코드를 읽어오는 방식(SMS API 연동 등)이 필요하며, 현재 인프라 및 비용 고려가 필요합니다.

---

### 7.3 [선택] 나인하이어 API 자동 연동

**현황**: 나인하이어 API를 통한 자동 업로드가 구현되지 않아, 현재는 CSV 파일을 수동 업로드하는 방식입니다.

**장벽**: 나인하이어 API가 세션 토큰 방식(30분 만료)만 지원하며, 서버 간 연동에 적합한 API Key 방식이 미지원 상태입니다. (2026년 3월 기준)

**해결 방안 후보**:
1. 나인하이어 측에 API Key 방식 지원 요청
2. Playwright로 나인하이어 자동 로그인 → 세션 토큰 캡처 → API 호출

---

## 8. 참고 정보

### 8.1 주요 계정 정보 (인수인계 시 별도 전달)

| 항목 | 내용 |
|------|------|
| 리멤버 계정 | `.env` 파일 참고 |
| NineHire 회사 ID | `f0b5bd00-4e82-11ec-be75-dd3d4f039103` |
| NineHire API Key | `.env` 또는 NineHire 설정 → API 키 메뉴 |

### 8.2 문제 발생 시 확인 방법

```bash
# 실행 로그 전체 확인
cat remember_run.log

# 디버그 스크린샷 확인 (로그인 오류 시)
# 프로젝트 루트에 debug_mfa_before.png 등이 생성됨
```

### 8.3 리멤버 API 인증 토큰 수동 갱신

토큰이 만료되어 자동 갱신이 안 되는 경우:
```bash
python3 scripts/remember_auth.py
# SMS 인증번호 입력 후 토큰이 .env에 자동 저장됨
```
