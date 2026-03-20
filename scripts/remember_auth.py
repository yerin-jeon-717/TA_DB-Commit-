"""
리멤버 자동 로그인 및 토큰 발급 (Playwright)
- 이메일/비밀번호 자동 입력
- SMS 2단계 인증: 터미널에서 코드 직접 입력
- 토큰 캡처 후 .env 자동 업데이트
"""

import re
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout


ENV_PATH = Path(".env")


def load_env() -> dict:
    env = {}
    try:
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return env


def save_token(token: str):
    """토큰을 .env에 저장."""
    text = ENV_PATH.read_text(encoding="utf-8") if ENV_PATH.exists() else ""
    if "REMEMBER_AUTH_TOKEN=" in text:
        text = re.sub(r"REMEMBER_AUTH_TOKEN=.*", f"REMEMBER_AUTH_TOKEN={token}", text)
    else:
        text += f"\nREMEMBER_AUTH_TOKEN={token}\n"
    ENV_PATH.write_text(text, encoding="utf-8")
    print(f"  토큰 저장 완료: {token[:8]}...")


def get_token_via_browser(email: str, password: str) -> str:
    """
    Playwright로 리멤버 로그인 후 토큰 캡처.
    SMS MFA는 터미널 입력으로 처리.
    """
    captured = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page    = browser.new_page()

        # ── STEP 1. 로그인 ──
        print("  브라우저 시작...")
        page.goto("https://career.rememberapp.co.kr/login", wait_until="load", timeout=30000)

        print("  이메일/비밀번호 자동 입력 중...")
        page.locator("button, a").filter(has_text="이메일로 로그인").click()
        page.wait_for_selector('input[type="text"]', timeout=10000)
        page.locator('input[type="text"]').first.fill(email)
        page.fill('input[type="password"]', password)
        page.locator("button").filter(has_text="다음").click()

        # ── STEP 2. MFA 감지 ──
        try:
            page.wait_for_url("**/mfa**", timeout=10000)
            on_mfa = True
        except PWTimeout:
            on_mfa = "/mfa" in page.url

        if on_mfa:
            # 인증번호 전송 버튼 클릭 (있을 경우)
            try:
                send_btn = page.locator("button").filter(has_text="인증번호 전송")
                if send_btn.count() > 0 and send_btn.first.is_visible():
                    send_btn.first.click()
                    page.wait_for_timeout(2000)
            except Exception:
                pass

            # 디버그용 스크린샷 (MFA 페이지 확인)
            try:
                page.screenshot(path="debug_mfa_before.png")
                print("  [DEBUG] MFA 페이지 스크린샷: debug_mfa_before.png")
            except Exception:
                pass

            # 터미널에서 SMS 코드 입력
            print()
            print("=" * 50)
            print("  SMS 인증번호가 발송됐습니다.")
            print("  핸드폰을 확인하고 아래에 입력하세요:")
            print("=" * 50)
            sms_code = input("  인증번호 입력 > ").strip()

            # 코드 입력 필드 탐지 — 여러 셀렉터 순서대로 시도
            code_input = None
            selectors = [
                'input[inputmode="numeric"]',
                'input[type="number"]',
                'input[type="text"][maxlength]',
                'input[type="tel"]',
                'input[placeholder*="인증"]',
                'input[placeholder*="번호"]',
            ]
            for sel in selectors:
                try:
                    page.wait_for_selector(sel, timeout=3000)
                    loc = page.locator(sel).first
                    if loc.is_visible():
                        code_input = loc
                        print(f"  [DEBUG] 입력 필드 발견: {sel}")
                        break
                except PWTimeout:
                    continue

            if code_input is None:
                # fallback: 페이지에 보이는 모든 input 중 첫 번째
                print("  [WARN] 셀렉터 매칭 실패 - 첫 번째 visible input 사용")
                code_input = page.locator("input:visible").first

            # 클릭 후 코드 입력 (6자리 완성 시 폼 자동 제출)
            # force=True: 입력 필드 등장 애니메이션 중이어도 강제 클릭
            code_input.click(force=True)
            page.wait_for_timeout(300)
            code_input.fill("")
            code_input.type(sms_code, delay=100)

            print("  인증 처리 중... (폼 자동 제출 대기)")

            try:
                page.wait_for_url("**/job_postings**", timeout=20000)
            except PWTimeout:
                # 현재 URL 확인
                print(f"  [DEBUG] 현재 URL: {page.url}")
                try:
                    page.screenshot(path="debug_mfa_result.png")
                    print("  [DEBUG] 인증 후 스크린샷: debug_mfa_result.png")
                except Exception:
                    pass

        # ── STEP 3. 토큰 캡처 ──
        def on_request(request):
            if "career-api.rememberapp.co.kr" not in request.url:
                return
            auth  = request.headers.get("authorization", "")
            token = auth.replace("Token token=", "").strip()
            if token and token != "undefined" and len(token) >= 30 and not captured:
                captured.append(token)

        page.on("request", on_request)
        page.goto(
            "https://career.rememberapp.co.kr/job_postings",
            wait_until="load",
            timeout=30000,
        )
        page.wait_for_timeout(2000)
        browser.close()

    if not captured:
        raise RuntimeError("토큰 캡처 실패 — 인증번호 또는 로그인 정보를 확인하세요.")

    return captured[0]


def refresh_token() -> str:
    """
    .env에서 이메일/비밀번호 읽어 토큰 자동 발급.
    발급된 토큰은 .env에 자동 저장 후 반환.
    """
    env   = load_env()
    email = env.get("REMEMBER_EMAIL", "")
    pw    = env.get("REMEMBER_PASSWORD", "")

    if not email or not pw:
        print("\n[ERROR] .env에 REMEMBER_EMAIL / REMEMBER_PASSWORD가 없습니다.")
        sys.exit(1)

    print("토큰 자동 발급 중...")
    token = get_token_via_browser(email, pw)
    save_token(token)
    return token


if __name__ == "__main__":
    token = refresh_token()
    print(f"발급된 토큰: {token}")
