"""
리멤버 지원자 데이터 일괄 다운로드 (stdlib only)

실행:
  python3 scripts/remember_applicant_download.py              # 전체 활성 공고 자동
  python3 scripts/remember_applicant_download.py --positions 301443,301444
  python3 scripts/remember_applicant_download.py --filter 바이오던스
"""

import os, csv, json, time, sys, argparse, re
import urllib.request, urllib.parse, urllib.error
from pathlib import Path
from datetime import datetime


# ─────────────────────────────────────────────
#  .env 파서
# ─────────────────────────────────────────────

ENV_PATH = Path(".env")

def load_env():
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
    """새 토큰을 .env에 저장."""
    text = ENV_PATH.read_text(encoding="utf-8") if ENV_PATH.exists() else ""
    if "REMEMBER_AUTH_TOKEN=" in text:
        text = re.sub(r"REMEMBER_AUTH_TOKEN=.*", f"REMEMBER_AUTH_TOKEN={token}", text)
    else:
        text += f"\nREMEMBER_AUTH_TOKEN={token}\n"
    ENV_PATH.write_text(text, encoding="utf-8")

_env = load_env()

def getenv(key, default=""):
    return os.environ.get(key) or _env.get(key, default)


# ─────────────────────────────────────────────
#  CONFIG
# ─────────────────────────────────────────────

BASE_URL   = "https://career-api.rememberapp.co.kr"
UTILS_URL  = "https://utils-api.rememberapp.co.kr"
OUTPUT_DIR = getenv("OUTPUT_DIR", "output/remember_applicants")

# 가져올 지원자 스테이지
STAGE_MAP = {
    "APPLIED":  ["applied"],
    "APPROVED": ["approved"],
    "REJECTED": ["rejected"],
}

CSV_COLUMNS = ["포지션명", "이름", "연락처", "이메일", "지원일자", "지원상태", "지원ID"]

def make_headers(token: str) -> dict:
    return {
        "Authorization": f"Token token={token}",
        "Content-Type":  "application/json",
        "Accept":        "application/json",
        "User-Agent":    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin":        "https://career.rememberapp.co.kr",
        "Referer":       "https://career.rememberapp.co.kr/",
    }

UTILS_HEADERS = {
    "Content-Type": "application/json",
    "Accept":       "*/*",
    "User-Agent":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Origin":       "https://career.rememberapp.co.kr",
    "Referer":      "https://career.rememberapp.co.kr/",
}


# ─────────────────────────────────────────────
#  토큰 관리
# ─────────────────────────────────────────────

TOKEN = [getenv("REMEMBER_AUTH_TOKEN")]   # 리스트로 감싸 가변 참조

def get_token() -> str:
    return TOKEN[0]

def validate_token() -> bool:
    """job_postings 목록 호출로 토큰 유효성 확인 (MFA 완료 여부까지 검증)."""
    try:
        url = f"{BASE_URL}/recruiters/me/job_postings?page=1&per=1"
        req = urllib.request.Request(url, headers=make_headers(get_token()))
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status == 200
    except Exception:
        return False

def prompt_token_refresh():
    """토큰 만료 시 Playwright로 자동 재발급."""
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from scripts.remember_auth import refresh_token
    new_token = refresh_token()
    TOKEN[0] = new_token
    _env["REMEMBER_AUTH_TOKEN"] = new_token

def ensure_token():
    """토큰 유효성 보장. 만료 시 자동으로 갱신 요청."""
    if not get_token():
        print("[ERROR] .env에 REMEMBER_AUTH_TOKEN 없음.")
        prompt_token_refresh()
    elif not validate_token():
        prompt_token_refresh()
        if not validate_token():
            print("[ERROR] 새 토큰도 유효하지 않습니다. 다시 시도하세요.")
            sys.exit(1)
    print(f"토큰 확인 완료.")


# ─────────────────────────────────────────────
#  HTTP 헬퍼
# ─────────────────────────────────────────────

def get_json(url: str, params: dict = None) -> dict:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params, doseq=True)}"
    req = urllib.request.Request(url, headers=make_headers(get_token()))
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def post_json(url: str, body: dict, headers: dict = None) -> dict:
    h    = headers or make_headers(get_token())
    data = json.dumps(body).encode("utf-8")
    req  = urllib.request.Request(url, data=data, headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def post_binary(url: str, body: dict, headers: dict) -> bytes:
    data = json.dumps(body).encode("utf-8")
    req  = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


# ─────────────────────────────────────────────
#  공고 목록 자동 조회
# ─────────────────────────────────────────────

def fetch_all_job_postings(status_filter: str = "published") -> list:
    """
    활성 채용 공고 전체 목록 반환.
    status_filter: published(게시중) | closed(마감) | all(전체)
    """
    per_page = 50
    page     = 1
    result   = []

    while True:
        params = {
            "per":  per_page,
            "page": page,
            "sort": "starts_at:desc",
            "highend": "false",
        }
        if status_filter != "all":
            params["statuses[]"] = status_filter

        data  = get_json(f"{BASE_URL}/recruiters/me/job_postings", params=params)
        items = data.get("data", data) if isinstance(data.get("data"), list) else data
        if not isinstance(items, list):
            break
        result.extend(items)
        meta        = data.get("meta", {})
        total_pages = meta.get("total_pages", 1)
        if page >= total_pages or len(items) < per_page:
            break
        page += 1
        time.sleep(0.3)

    return result

def select_job_postings(postings: list, filter_kw: str = "", ids: list = None) -> list:
    """공고 목록에서 실행 대상 선택."""
    if ids:
        return [p for p in postings if str(p["id"]) in ids]
    if filter_kw:
        return [p for p in postings if filter_kw in p.get("title", "")]
    return postings


# ─────────────────────────────────────────────
#  지원자 목록
# ─────────────────────────────────────────────

def fetch_stage(position_id: str, stage: str, statuses: list) -> list:
    url      = f"{BASE_URL}/recruiters/me/job_postings/{position_id}/applicants/list"
    per_page = 50
    result   = []
    page     = 1
    while True:
        payload = {
            "page": page, "per": per_page, "sort": "id_asc",
            "filter_options": {"statuses": statuses},
            "options": {"stage": stage},
        }
        resp        = post_json(url, payload)
        items       = resp.get("data", [])
        meta        = resp.get("meta", {})
        result.extend(items)
        if page >= meta.get("total_pages", 1):
            break
        page += 1
        time.sleep(0.3)
    return result

def fetch_all_applicants(position_id: str) -> list:
    all_data = []
    for stage, statuses in STAGE_MAP.items():
        try:
            items = fetch_stage(position_id, stage, statuses)
            if items:
                print(f"    [{stage}] {len(items)}명")
            all_data.extend(items)
        except urllib.error.HTTPError as e:
            if e.code == 400:
                pass   # 해당 포지션에 없는 스테이지
            else:
                raise
    return all_data

def parse_applicant(raw: dict, position_name: str) -> dict:
    app = raw.get("application", {})
    jp  = app.get("job_posting", {})
    return {
        "포지션명": position_name or jp.get("title", ""),
        "이름":     raw.get("name", ""),
        "연락처":   app.get("phone", ""),
        "이메일":   app.get("email", ""),
        "지원일자": (app.get("applied_at") or "")[:10],
        "지원상태": app.get("status", ""),
        "지원ID":   str(app.get("id", "")),
        "_application_id": str(app.get("id", "")),
        "_position_id":    str(jp.get("id", "") or raw.get("application", {}).get("job_posting_id", "")),
        "_phone":          app.get("phone", ""),
        "_email":          app.get("email", ""),
    }


# ─────────────────────────────────────────────
#  이력서 PDF 다운로드
# ─────────────────────────────────────────────

def to_camel(s: str) -> str:
    parts = s.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])

def snake_to_camel(obj):
    if isinstance(obj, dict):
        return {to_camel(k): snake_to_camel(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [snake_to_camel(i) for i in obj]
    return obj

def fetch_applicant_detail(position_id: str, application_id: str) -> dict | None:
    url = f"{BASE_URL}/recruiters/me/job_postings/{position_id}/applicants/{application_id}/open_profile"
    try:
        data = get_json(url)
        return data.get("data", data)
    except urllib.error.HTTPError as e:
        print(f"    [ERROR] 상세 조회 실패 {e.code} (application_id={application_id})")
        return None

def download_applicant_files(ap: dict, files_dir: Path):
    name         = ap["이름"]
    contact      = ap["연락처"] or ap["이메일"]
    safe_contact = contact.replace("-", "")
    pos_id       = ap["_position_id"]
    app_id       = ap["_application_id"]

    detail = fetch_applicant_detail(pos_id, app_id)
    if not detail:
        return

    profile = snake_to_camel(detail)

    # 이력서 PDF
    pdf_name = f"이력서_{name}_{safe_contact}_resume.pdf"
    pdf_path = files_dir / pdf_name
    if pdf_path.exists():
        print(f"    [SKIP] {pdf_name}")
    else:
        try:
            body = {"profile": profile, "phone": ap["_phone"], "email": ap["_email"]}
            pdf  = post_binary(f"{UTILS_URL}/jsx/resume/download/career", body, UTILS_HEADERS)
            pdf_path.write_bytes(pdf)
            print(f"    [OK]   {pdf_name}")
        except Exception as e:
            print(f"    [FAIL] {pdf_name} -> {e}")

    # 첨부파일 (있는 경우)
    for att in detail.get("attachments", []):
        att_url = att.get("url", att.get("file_url", ""))
        if not att_url:
            continue
        orig     = att_url.split("?")[0].rsplit("/", 1)[-1]
        att_file = files_dir / f"첨부파일_{name}_{safe_contact}_{orig}"
        if att_file.exists():
            print(f"    [SKIP] {att_file.name}")
            continue
        try:
            req = urllib.request.Request(att_url, headers={k: v for k, v in make_headers(get_token()).items() if k != "Content-Type"})
            with urllib.request.urlopen(req, timeout=60) as r:
                att_file.write_bytes(r.read())
            print(f"    [OK]   {att_file.name}")
        except Exception as e:
            print(f"    [FAIL] {att_file.name} -> {e}")


# ─────────────────────────────────────────────
#  포지션별 실행
# ─────────────────────────────────────────────

def get_session_dir(position_title: str) -> Path:
    today = datetime.now().strftime("%Y%m%d")
    safe  = re.sub(r'[\\/:*?"<>|]', "_", position_title)[:50]
    d     = Path(OUTPUT_DIR) / f"{today}_{safe}"
    d.mkdir(parents=True, exist_ok=True)
    (d / "files").mkdir(exist_ok=True)
    return d

def run_position(posting: dict):
    pos_id    = str(posting["id"])
    pos_title = posting.get("title", pos_id)
    status    = posting.get("status", "")

    print(f"\n  [{pos_id}] {pos_title}  ({status})")

    raw_list   = fetch_all_applicants(pos_id)
    applicants = [parse_applicant(r, pos_title) for r in raw_list]

    if not applicants:
        print("    지원자 없음, 스킵")
        return 0

    print(f"    총 {len(applicants)}명")
    out_dir   = get_session_dir(pos_title)
    files_dir = out_dir / "files"

    # CSV
    csv_path = out_dir / "applicants.csv"
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore").writeheader()
        csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore").writerows(applicants)

    # 파일 다운로드
    for ap in applicants:
        download_applicant_files(ap, files_dir)

    return len(applicants)


# ─────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="리멤버 지원자 일괄 다운로드")
    parser.add_argument("--positions", help="포지션 ID (쉼표 구분): 301443,301444")
    parser.add_argument("--filter",    help="공고 제목 키워드 필터: 바이오던스")
    parser.add_argument("--status",    default="published", help="공고 상태: published|closed|all")
    args = parser.parse_args()

    # 1) 토큰 확인 (만료 시 갱신 안내)
    print("토큰 확인 중...")
    ensure_token()

    # 2) 공고 목록 조회
    print(f"\n공고 목록 조회 중... (상태: {args.status})")
    all_postings = fetch_all_job_postings(args.status)
    print(f"  → 전체 {len(all_postings)}개 공고 발견")

    # 3) 대상 선택
    ids = [p.strip() for p in args.positions.split(",")] if args.positions else None
    targets = select_job_postings(all_postings, filter_kw=args.filter or "", ids=ids)

    if not targets:
        print("조건에 맞는 공고 없음.")
        return

    print(f"\n실행 대상 {len(targets)}개:")
    for p in targets:
        print(f"  [{p['id']}] {p.get('title', '')}  ({p.get('status', '')})")

    # 4) 포지션별 순차 다운로드
    print(f"\n{'='*55}")
    total = 0
    for posting in targets:
        total += run_position(posting)
        time.sleep(0.5)

    print(f"\n{'='*55}")
    print(f"완료. 총 {total}명 / {len(targets)}개 공고")
    print(f"저장 위치: {Path(OUTPUT_DIR).resolve()}")

if __name__ == "__main__":
    import traceback
    log_path = Path("remember_run.log")
    # 기존 로그 초기화
    log_path.write_text("", encoding="utf-8")

    class Tee:
        """stdout을 터미널 + 로그 파일에 동시 출력."""
        def __init__(self, stream, path):
            self._stream = stream
            self._file   = open(path, "a", encoding="utf-8", buffering=1)
        def write(self, data):
            self._stream.write(data)
            self._file.write(data)
        def flush(self):
            self._stream.flush()
            self._file.flush()
        def fileno(self):
            return self._stream.fileno()

    sys.stdout = Tee(sys.stdout, log_path)
    sys.stderr = Tee(sys.stderr, log_path)

    try:
        main()
    except Exception:
        traceback.print_exc()
        print(f"\n[ERROR] 로그 저장 위치: {log_path.resolve()}")
