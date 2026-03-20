# 리멤버 지원자 데이터 다운로드 가이드

## 개요

| 항목 | 내용 |
|------|------|
| 목적 | 리멤버에 지원한 자사 채용 공고 지원자 데이터 일괄 추출 |
| 출력물 | 지원자 목록 CSV + 이력서/포트폴리오 파일 |
| 파일명 형식 | `{컬럼명}_{이름}_{연락처 또는 이메일}_{원본파일명}` |
| 예시 | `포트폴리오_최태오_01012345678_portfolio.pdf` |

---

## 사전 준비

### 1. Python 패키지 설치

```bash
pip install requests python-dotenv
```

### 2. .env 파일 생성

```bash
cp .env.example .env
```

---

## STEP 1. API 인증 정보 캡처 (DevTools)

리멤버는 로그인 세션 기반 인증을 사용합니다.
브라우저 DevTools로 API 요청을 캡처해 `.env`에 입력해야 합니다.

### 캡처 방법

1. **Chrome에서 리멤버 채용 관리 페이지 접속**
   `https://career.rememberapp.co.kr` → 로그인 → 채용 공고 목록

2. **DevTools 열기**: `F12` 또는 `Ctrl+Shift+I` → **Network** 탭

3. **필터**: `Fetch/XHR` 선택

4. **지원자 목록 페이지 클릭** (공고 하나 클릭)
   → Network 탭에 API 요청이 여러 개 뜸

5. **지원자 목록 요청 찾기**
   - URL에 `applicant`, `candidate`, `apply` 등 키워드 포함
   - Method: `GET`

6. **Headers 탭에서 값 복사 → `.env` 붙여넣기**

| 항목 | Headers 탭 위치 | .env 키 |
|------|----------------|---------|
| Authorization | `Authorization: Bearer eyJ...` | `REMEMBER_AUTH_TOKEN=eyJ...` |
| Cookie | `Cookie: _ga=...` (전체) | `REMEMBER_COOKIE=_ga=...` |

7. **포지션 ID 확인**
   - 요청 URL에서 숫자 추출: `/api/v1/positions/`**`12345`**`/applicants`
   - 또는 채용 관리 페이지 URL: `?positionId=`**`12345`**
   - `.env`의 `REMEMBER_POSITION_IDS=12345` 에 입력

### API 엔드포인트 구조 수정

캡처한 실제 URL이 스크립트 기본값과 다를 경우,
`scripts/remember_applicant_download.py` 내 `fetch_applicants()` 함수의 아래 항목 수정:

```python
LIST_URL   = f"{BASE_URL}/api/v1/positions/{position_id}/applicants"  # ← 실제 URL로 수정
page_param = "page"   # ← 실제 파라미터명으로 수정
size_param = "size"   # ← 실제 파라미터명으로 수정
```

응답 JSON 구조도 확인 후 수정:

```python
# fetch_applicants() 내부
items = data.get("data", {}).get("list", data.get("items", []))  # ← 실제 구조로 수정
```

응답 예시를 DevTools > Response 탭에서 확인:
```json
{
  "data": {
    "list": [ { "name": "최태오", "phone": "01012345678", ... } ]
  }
}
```

---

## STEP 2. 지원자 다운로드 실행

```bash
python scripts/remember_applicant_download.py
```

### 출력 폴더 구조

```
output/
  remember_applicants/
    20240319_마케터/
      applicants.csv          ← 지원자 목록
      files/
        이력서_최태오_01012345678_resume.pdf
        포트폴리오_최태오_01012345678_portfolio.pdf
        이력서_홍길동_hong@email.com_cv.pdf
```

### CSV 컬럼

| 컬럼 | 내용 |
|------|------|
| 포지션명 | 채용 공고 제목 |
| 이름 | 지원자 이름 |
| 연락처 | 휴대폰 번호 |
| 이메일 | 이메일 주소 |
| 지원일자 | 지원 날짜/시간 |

---

## STEP 3. 파일명 일괄 변경 (선택)

다운로드 스크립트가 이미 표준 형식으로 저장하지만,
수동 다운로드 파일이 있거나 재처리가 필요할 때 사용합니다.

```bash
# 미리 보기 (실제 변경 없음)
python scripts/remember_file_rename.py --dry-run

# 최신 세션 폴더에 적용
python scripts/remember_file_rename.py

# 특정 폴더 지정
python scripts/remember_file_rename.py --dir output/remember_applicants/20240319_마케터
```

### 파일명 변환 규칙

| 원본 파일명 키워드 | 변환 후 레이블 |
|--------------------|----------------|
| portfolio, 포트폴리오 | 포트폴리오 |
| resume, cv, 이력서 | 이력서 |
| cover letter | 자기소개서 |
| certificate, 자격증 | 자격증 |
| 기타 | 첨부파일 |

---

## 트러블슈팅

### 401 Unauthorized
- `.env`의 토큰/쿠키 만료 → 브라우저에서 재캡처 후 재입력

### 빈 지원자 목록 반환
- `fetch_applicants()` 내 응답 데이터 추출 경로 수정 필요
- DevTools Response 탭에서 실제 JSON 구조 확인

### 파일 다운로드 실패
- `_resume_url`, `_portfolio_url` 필드명 수정 필요
- `parse_applicant()` 내 `raw.get("resume_url", ...)` 실제 필드명으로 수정

### 토큰 유효기간
- 리멤버 세션은 일반적으로 수 시간~수일 유효
- 장시간 작업 시 중간에 재캡처 필요할 수 있음
