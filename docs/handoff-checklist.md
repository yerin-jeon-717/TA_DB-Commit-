# 인수인계 체크리스트

> 개발 담당자 교체 또는 신규 환경 셋업 시 이 체크리스트를 순서대로 진행하세요.

---

## A. 전달할 파일 목록

아래 파일들을 모두 전달해야 합니다. 폴더째로 압축하여 전달하는 것을 권장합니다.

| 파일/폴더 | 설명 | 필수 여부 |
|-----------|------|-----------|
| `scripts/remember_auth.py` | 리멤버 자동 로그인 | ✅ 필수 |
| `scripts/remember_applicant_download.py` | 리멤버 지원자 다운로드 | ✅ 필수 |
| `scripts/remember_file_rename.py` | 이력서 파일명 정규화 | ✅ 필수 |
| `scripts/ninehire_dedup.py` | 나인하이어 중복 제거 | ✅ 필수 |
| `.env.example` | 환경 변수 템플릿 | ✅ 필수 |
| `setup.bat` | Windows 초기 설치 스크립트 | ✅ 필수 |
| `docs/remember-ninehire-pipeline.md` | 전체 기술 문서 | ✅ 필수 |
| `docs/handoff-checklist.md` | 이 문서 | ✅ 필수 |
| `data/ninehire_uploaded.json` | 나인하이어 업로드 이력 | ⚠️ 있을 경우 전달 |
| `.env` | 실제 인증 정보 | ⚠️ 별도 보안 채널로 전달 |

> ⚠️ `.env` 파일(실제 비밀번호 포함)은 이메일/Slack이 아닌 **1Password, 카카오톡 비밀 채팅** 등 보안 채널로 별도 전달하세요.

---

## B. 인수자 셋업 순서

### Step 1. 파일 준비
```
받은 파일을 원하는 폴더에 압축 해제
예: C:\work\TA_DB\
```

### Step 2. 초기 설치 실행
```
setup.bat 더블클릭
→ Python, Playwright, Chromium 자동 설치
→ .env 파일 자동 생성
```

> setup.bat 실행이 안 되면 PowerShell에서 수동 실행:
> ```powershell
> pip install playwright
> playwright install chromium
> copy .env.example .env
> ```

### Step 3. 인증 정보 입력
`.env` 파일을 메모장으로 열어 아래 값 입력:
```
REMEMBER_EMAIL=받은 이메일 주소
REMEMBER_PASSWORD=받은 비밀번호
```

### Step 4. 나인하이어 기존 데이터 임포트 (최초 1회)
```powershell
# NineHire에서 지원자 전체 내보내기 CSV를 data/ 폴더에 저장 후:
python3 scripts/ninehire_dedup.py --import data\ninehire_export.csv
```

### Step 5. 첫 실행 테스트
```powershell
python3 scripts/remember_applicant_download.py
```
- 브라우저가 열리며 자동 로그인 진행
- SMS 인증번호 입력 프롬프트 → 핸드폰 확인 후 입력
- `output/remember_applicants/` 폴더에 결과물 생성 확인

---

## C. 정기 운영 체크리스트

매번 실행 시 아래 순서 준수:

- [ ] `python3 scripts/remember_applicant_download.py` 실행
- [ ] SMS 인증번호 입력
- [ ] `output/remember_applicants/` 결과물 확인
- [ ] `python3 scripts/ninehire_dedup.py` 실행
- [ ] `output/upload_ready/YYYYMMDD_upload_ready.csv` 확인
- [ ] NineHire에 CSV 수동 업로드
- [ ] `python3 scripts/ninehire_dedup.py --mark-uploaded output/upload_ready/YYYYMMDD_...csv` 실행

---

## D. 미완료 과제 (추가 개발 필요)

| 우선순위 | 과제 | 설명 |
|----------|------|------|
| 🔴 높음 | 나인하이어 초기 데이터 임포트 | NineHire 내보내기 기능 확인 후 `--import` 실행 필요 |
| 🟡 선택 | SMS 인증 완전 자동화 | 현재 담당자가 인증번호를 직접 입력해야 함 |
| 🟡 선택 | 나인하이어 API 자동 업로드 | NineHire API Key 방식 미지원으로 현재 수동 업로드 |

---

## E. 문제 발생 시 확인 방법

| 증상 | 확인 방법 |
|------|-----------|
| 전체 오류 로그 | `type remember_run.log` (Windows) |
| 로그인 실패 | 프로젝트 루트의 `debug_mfa_before.png` 스크린샷 확인 |
| 토큰 만료 | `python3 scripts/remember_auth.py` 단독 실행 후 SMS 입력 |
| 이력서 PDF 0바이트 | 리멤버 utils-api 일시 장애 가능 — 재실행하면 SKIP 처리됨 |

---

## F. 주요 계정 정보 (별도 보안 전달)

| 항목 | 전달 방법 |
|------|-----------|
| 리멤버 이메일/비밀번호 | 보안 채널 별도 전달 |
| 나인하이어 로그인 계정 | 보안 채널 별도 전달 |
| 나인하이어 API Key | `.env` 파일에 포함 또는 NineHire 설정에서 재발급 |
| 나인하이어 Company ID | `f0b5bd00-4e82-11ec-be75-dd3d4f039103` (고정값) |
| 리멤버 SMS 수신 전화번호 | 담당자 변경 시 리멤버 계정에서 업데이트 필요 |
