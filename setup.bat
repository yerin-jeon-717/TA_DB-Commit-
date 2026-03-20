@echo off
chcp 65001 >nul
echo ================================================
echo  리멤버 → 나인하이어 파이프라인 초기 설정
echo ================================================
echo.

:: Python 버전 확인
echo [1/4] Python 버전 확인...
python3 --version 2>nul || python --version 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python이 설치되어 있지 않습니다.
    echo   https://www.python.org/downloads/ 에서 Python 3.10 이상을 설치하세요.
    pause
    exit /b 1
)

:: Playwright 설치
echo.
echo [2/4] Playwright 설치 중...
pip install playwright
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Playwright 설치 실패. pip 상태를 확인하세요.
    pause
    exit /b 1
)

:: Chromium 브라우저 설치
echo.
echo [3/4] Chromium 브라우저 설치 중...
playwright install chromium
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Chromium 설치 실패.
    pause
    exit /b 1
)

:: .env 파일 생성
echo.
echo [4/4] 환경 설정 파일 확인...
if not exist .env (
    copy .env.example .env >nul
    echo [생성됨] .env 파일이 생성되었습니다.
    echo          .env 파일을 열어 REMEMBER_EMAIL 과 REMEMBER_PASSWORD 를 입력하세요.
) else (
    echo [확인됨] .env 파일이 이미 존재합니다.
)

:: 출력 폴더 생성
if not exist output\remember_applicants mkdir output\remember_applicants
if not exist output\upload_ready mkdir output\upload_ready
if not exist data mkdir data

echo.
echo ================================================
echo  설치 완료!
echo.
echo  다음 단계:
echo  1. .env 파일에 리멤버 이메일/비밀번호 입력
echo  2. python3 scripts/remember_applicant_download.py 실행
echo  3. python3 scripts/ninehire_dedup.py 실행
echo ================================================
pause
