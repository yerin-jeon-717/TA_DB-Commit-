# 인재풀 통합 DB 검색 엔진 (Talent Pool Intelligence Engine)

## Overview
- **Company**: 뷰티셀렉션
- **Target User**: TA 담당자 (내부) — 경쟁사 현직원 모니터링 및 채용 후보 검색
- **Intent**: 경쟁사 15개사 현직원 데이터를 리멤버/링크드인에서 수집·정제·통합 → 웹 검색 엔진 호스팅
- **Backend Sheet**: [통합 인재 DB](https://docs.google.com/spreadsheets/d/1AiGiGG1CQWKFKpkNrjYu-7n4fa9_Xxy9mjaajPpwmZ4)
- **Hosting**: GitHub + Vercel (현재 인증 없음, 추후 계정별 접근 제어 예정)
- **Platform**: Google Sheets + Apps Script (GAS) + 웹 프론트엔드 (TBD)

---

## Target Companies (모니터링 대상 경쟁사 15개)
더파운더즈, 에이피알(APR), 아모레퍼시픽, 비나우, 구다이글로벌, CosRX, 토리든, 달바,
엘앤피코스메틱, 티르티르, 크레이버, 더퓨어랩, 아렌시아, 앱솔브랩, 아시아마스터트레이드

---

## Data Pipeline Architecture

```
리멤버 크롤링           링크드인 크롤링
      ↓                       ↓
 raw_remember (A~H)      raw_linkedin (A~L)
      ↓                       ↓
      └────── 포맷 정규화 (GAS) ──────┘
                    ↓
           중복 탐지 & 통합
                    ↓
        기업별 통합 시트 (1사 = 1시트)
                    ↓
          웹 검색 엔진 (Vercel)
```

---

## Column Schemas

### 리멤버 raw (A~H)
| Col | 필드명 | 비고 |
|-----|--------|------|
| A | 이름 | `정OO` 형식 (성+OO, 실명 비식별) |
| B | 프로필 페이지 | 리멤버 URL (RichText 하이퍼링크) |
| C | 팀 | |
| D | 직책 | |
| E | 재직 기간 | `YYYY.MM ~ 현재` 또는 `n년 n개월` 혼재 |
| F | 이전 경력 | **현직장 데이터 혼입 주의** |
| G | 학력 | |
| H | 크롤링 시간 | |

### 링크드인 raw (A~L)
| Col | 필드명 | 비고 |
|-----|--------|------|
| A | 이름 | 영문(`Donggyu Park`) 또는 국문(`송호영`) |
| B | 현재직책 | |
| C | (기업명)_재직기간 | |
| D | 학력 | |
| E | 전체경력 | |
| F | 총재직기간 | |
| G | 총재직기간(인턴제외) | |
| H | 이직처 | |
| I | 업데이트상태 | |
| J | 프로필URL | LinkedIn URL, **누락 없음** |
| K | 수집일시 | |
| L | 상태 | |

### 통합 시트 (A~L) — 최종 출력 형식
| Col | 필드명 | 소스 | 비고 |
|-----|--------|------|------|
| A | 회사명 | 수동 | |
| B | 이름 | 리멤버/링크드인 | 링크드인 영문명 → 국문 번역 필요 |
| C | 리멤버 페이지 | 리멤버 B열 | RichText URL 보존 필수 |
| D | 링크드인 페이지 | 링크드인 J열 | RichText URL 보존 필수 |
| E | 대분류(직무) | 수동 입력 예정 | raw 데이터에 없음 |
| F | 팀 | 리멤버 C열 | |
| G | 직책 | 리멤버 D열 / 링크드인 B열 | |
| H | 총 경력 | GAS 계산 | 재직기간+이전경력 합산 |
| I | 재직 기간 | 리멤버 E열 / 링크드인 C열 | 포맷 정규화 후 |
| J | 이전 경력 | 리멤버 F열 / 링크드인 E열 | 현직장 제거 후 |
| K | 학력 | 리멤버 G열 / 링크드인 D열 | |
| L | 기준일 | 크롤링 시간 | |

---

## Core Features

### 1. RichText 하이퍼링크 보존
- `getValue()` 금지 → `getRichTextValue()`로 URL 추출
- 타겟 셀에 `setLinkUrl()`로 물리적 URL 결합
- **C열(리멤버 URL), D열(링크드인 URL)은 `setValues` 범위에서 절대 제외**

### 2. 이름 번역 (링크드인 영문명 → 국문)
- 한글 미포함 이름 → `LanguageApp.translate(t, 'en', 'ko')`
- 출력: `Donggyu Park\n박동규` (원문 + 번역 병기)
- **Bottom-up Rule**: 마지막 줄(`pop()`) = 국문 성함 → 중복 대조 기준

### 3. 순차 데이터 정화
실행 순서 고정 (역순 금지):
1. **Recovery** — '재직 기간' 공백 시 '이전 경력'에서 `현직장명|영문명` 키워드 검색
2. **Migration** — 찾은 경력 날짜 → '재직 기간'으로 복사
3. **Back-calc** — "n년 n개월" 단독 형식 → 실행일(2026.03) 기준 `YYYY.MM ~ 현재 (n년 n개월)` 역산
4. **Clean-up** — '이전 경력'에서 현직장 키워드 라인 삭제
- **Zero-Padding**: 출력 형식 항상 `"0년 4개월"` (단독 `"4개월"` 금지)

### 4. 중복 탐지 (리멤버 ↔ 링크드인 동일인 판별)

#### 실제 데이터 포맷 (확정)
```
[이전 경력 — 포맷 정화 후]
[2022.06 ~ 2022.08 (0년 3개월)] 제로그라운드 주식회사 | BX디자인팀 | 팀원
[2020.12 ~ 2022.02 (1년 3개월)] 주식회사 엠엠엠디 | 디자인팀 | 팀원

[링크드인 전체경력 — 포맷 정화 전, 줄바꿈 없이 연속]
APR Corporation - DevOps Engineer (2025년 6월 - 현재)Ingkle - 소프트웨어 엔지니어 (2022년 1월 - 2025년 5월)

[리멤버 재직 기간 — 정화 전후 동일]
2022.10 ~ 현재 (3년 5개월)
```

#### 확정된 버그 (v19.28)
| 버그 | 원인 | 영향 |
|------|------|------|
| `extractNonAprCompanies` 전면 실패 | 정규식 `\]\s*(.+?)\s*-\s*` 가 `-` 구분자 탐색 → 실제 구분자는 `\|` | 경력 유사도 비교 불가 |
| 성씨 단독 매칭 무효 | 김/이/박 = 한국 성씨 ~45%, 동일 회사 재직자 간 오탐 폭발 | 오탐지율 90% 핵심 원인 |

#### 개선 방향: Gate 방식 (입사년월 필수 조건)

```
[STEP 1] 포맷 정화 선행 (정화 없이 대조 금지)
    ↓
[STEP 2] 입사년월(YYYY.MM) 추출 — 재직 기간 첫 날짜
    ↓
[STEP 3] 입사년월 일치 여부 (Gate — 불일치 시 즉시 제외)
    └─ 일치 → STEP 4
[STEP 4] 보조 조건 (성씨 / 학력 / 이전 경력)
    ├─ 2개↑ 일치 → 자동 병합
    └─ 1개 일치 → 검토 리포트
```

**수정 코드안:**
```js
// Bug 1 수정: 구분자 | 기준 회사명 추출 (기존 - 는 실제 포맷에 없음)
function extractCompaniesFromCareer(text) {
  return text.split('\n').map(line => {
    const m = line.match(/\]\s*([^|\n]+)/);  // ] 이후 첫 | 까지
    return m ? m[1].trim() : '';
  }).filter(n => n.length > 0 && !isExcludedCompany(n));
}
```

> 링크드인 `전체경력`도 줄바꿈 구분 확인됨 → `split('\n')` 정상 작동

### 5. 기업명 마스터 매핑
- 형식: `{ "에이피알": "APR", "에이피알(주)": "APR", "a.p.r": "APR", "aprilskin": "APR", ... }`
- 적용: 중복 탐지 전 회사명 정규화에 사용
- 관리: `COMPANY_CONFIG.excludeKeywords` 배열과 연동

### 6. Smart Sync (예정)
- 원클릭 실행: 소스 시트 선택 → 임시 시트 → 정화·번역·대조 일괄 처리
- 자동 병합 (Gate 통과 + 보조 2↑) + 검토 리포트 (보조 1) 분리 출력

---

## GAS Architecture (v19.28)
| 함수 | 역할 |
|------|------|
| `importLinkedInData()` | 링크드인 raw → 통합 시트 가져오기, RichText URL 이식 |
| `importRememberData()` | 리멤버 raw → 통합 시트 가져오기, RichText URL 이식 |
| `translateNameColumn()` | 영문명 → 국문 번역 병기 |
| `unifyFormatLinkedinToRemember()` | 재직기간/이전경력 포맷 정규화 (역산 포함) |
| `updateCurrentSheetCareer()` | 총 경력 합산 계산 |
| `runDuplicateScan()` | 중복 대조 리포트 생성 |
| `applyDuplicateSelections()` | 선택 중복 병합 실행 (LinkedIn URL 이식 후 삭제) |
| `runRegionMapping()` | Region 자동 태깅 |
| `getOrSelectCompany()` | 현재 작업 대상 회사 선택/캐시 (ScriptProperties) |

---

## Web Search Engine
- **Hosting**: GitHub → Vercel
- **Auth**: 현재 오픈 (링크 공유), 추후 계정별 접근 제어 예정
- **기능 목표**: 이름/기업/직무/경력 필터 검색, 프로필 링크 연결
- **Stack**: TBD

---

## Golden Rules (서브에이전트 포함 모든 코드 수정 시 필수)
1. **Pinpoint Update** — C열(리멤버 URL), D열(링크드인 URL)은 `setValues` 범위에서 절대 제외
2. **Bottom-up Name** — 이름 마지막 줄(`pop()`) = 국문 성함, 중복 대조의 기준
3. **Zero-Padding** — 기간 출력은 항상 `"0년 4개월"` 형식 (정렬 무결성)
4. **Format-first** — 중복 탐지 실행 전 반드시 포맷 정화 선행
5. **Gate-first Dedup** — 입사년월 불일치 시 다른 조건 확인 없이 즉시 제외

---

## Known Issues & TODO
- [x] 중복 탐지 재설계 — Gate 방식 구현 + `extractNonAprCompanies` 정규식 수정 (`scripts/talent_pool_engine.gs` v20.0)
- [ ] 기업명 마스터 매핑 테이블 구축 (15개사 + 업계 주요사)
- [ ] 통합 시트 스키마 기준 데이터 정합성 검증 자동화
- [ ] 웹 검색 엔진 스택 결정 및 구현 (Vercel)
- [ ] Smart Sync 파이프라인 구현
- [ ] 경쟁사별 통합 시트 순차 확장 (현재: 더파운더즈, APR)
- [ ] 추후 계정별 인증 구현
