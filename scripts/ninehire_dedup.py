"""
나인하이어 중복 제거 스크립트

사용법:
  # 1. NineHire 기존 지원자 초기 임포트 (최초 1회)
  python3 scripts/ninehire_dedup.py --import data/ninehire_export.csv

  # 2. 리멤버 CSV에서 중복 제거 → 업로드용 CSV 생성
  python3 scripts/ninehire_dedup.py

  # 3. NineHire에 수동 업로드 완료 후 이력 업데이트
  python3 scripts/ninehire_dedup.py --mark-uploaded output/upload_ready/YYYYMMDD_upload_ready.csv

중복 판정 기준:
  - 연락처(전화번호) 또는 이메일이 일치 AND
  - 지원일자 차이가 7일 이내
"""

import os, csv, json, sys, argparse, re
from pathlib import Path
from datetime import datetime, timedelta


# ─────────────────────────────────────────────
#  경로 설정
# ─────────────────────────────────────────────

HISTORY_PATH   = Path("data/ninehire_uploaded.json")
REMEMBER_DIR   = Path("output/remember_applicants")
UPLOAD_OUT_DIR = Path("output/upload_ready")

DEDUP_DAYS = 7   # 지원일자 허용 오차 (일)


# ─────────────────────────────────────────────
#  이력 파일 로드/저장
# ─────────────────────────────────────────────

def load_history() -> list:
    if not HISTORY_PATH.exists():
        return []
    return json.loads(HISTORY_PATH.read_text(encoding="utf-8"))


def save_history(records: list):
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_PATH.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ─────────────────────────────────────────────
#  정규화 헬퍼
# ─────────────────────────────────────────────

def norm_phone(s: str) -> str:
    """전화번호 정규화: 숫자만 추출"""
    return re.sub(r"\D", "", s or "")


def norm_email(s: str) -> str:
    return (s or "").strip().lower()


def parse_date(s: str):
    """YYYY-MM-DD 파싱. 실패 시 None"""
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except Exception:
        return None


# ─────────────────────────────────────────────
#  중복 판정
# ─────────────────────────────────────────────

def is_duplicate(applicant: dict, history: list) -> tuple[bool, dict | None]:
    """
    history에 중복 항목이 있으면 (True, 매칭 항목) 반환.
    중복 기준: (전화번호 OR 이메일) 일치 + 지원일자 ±7일
    """
    phone  = norm_phone(applicant.get("연락처", ""))
    email  = norm_email(applicant.get("이메일", ""))
    app_dt = parse_date(applicant.get("지원일자", ""))

    for rec in history:
        rec_phone = norm_phone(rec.get("phone", ""))
        rec_email = norm_email(rec.get("email", ""))
        rec_dt    = parse_date(rec.get("applied_at", ""))

        # 연락처 또는 이메일 일치 여부
        contact_match = (
            (phone and rec_phone and phone == rec_phone) or
            (email and rec_email and email == rec_email)
        )
        if not contact_match:
            continue

        # 지원일자 ±7일 체크
        if app_dt and rec_dt:
            if abs((app_dt - rec_dt).days) <= DEDUP_DAYS:
                return True, rec
        else:
            # 날짜 없으면 연락처 일치만으로 중복 처리
            return True, rec

    return False, None


# ─────────────────────────────────────────────
#  리멤버 CSV 전체 로드
# ─────────────────────────────────────────────

def load_remember_applicants() -> list:
    """output/remember_applicants/ 하위 모든 applicants.csv 로드"""
    all_applicants = []
    if not REMEMBER_DIR.exists():
        print(f"[ERROR] {REMEMBER_DIR} 없음. 먼저 remember_applicant_download.py 실행하세요.")
        return []

    for csv_path in sorted(REMEMBER_DIR.rglob("applicants.csv")):
        try:
            with open(csv_path, encoding="utf-8-sig") as f:
                for row in csv.DictReader(f):
                    row["_csv_path"] = str(csv_path)
                    all_applicants.append(row)
        except Exception as e:
            print(f"  [WARN] {csv_path}: {e}")

    return all_applicants


# ─────────────────────────────────────────────
#  NineHire 내보내기 CSV 임포트
# ─────────────────────────────────────────────

# NineHire CSV 컬럼명 → 내부 키 매핑 (자동 탐지)
NINEHIRE_COLUMN_MAP = {
    # 이름
    "이름": "name", "성명": "name", "name": "name",
    # 전화
    "연락처": "phone", "전화번호": "phone", "휴대폰": "phone",
    "휴대전화": "phone", "phone": "phone", "mobile": "phone",
    # 이메일
    "이메일": "email", "email": "email", "e-mail": "email",
    # 지원일
    "지원일자": "applied_at", "접수일": "applied_at", "지원일": "applied_at",
    "신청일": "applied_at", "applied_at": "applied_at", "apply_date": "applied_at",
    # 포지션
    "포지션명": "position", "공고명": "position", "직무": "position",
    "포지션": "position", "job": "position", "position": "position",
    # 상태
    "지원상태": "status", "상태": "status", "status": "status",
}


def import_ninehire_csv(csv_path: str):
    """NineHire 내보내기 CSV → ninehire_uploaded.json 에 병합"""
    path = Path(csv_path)
    if not path.exists():
        print(f"[ERROR] 파일 없음: {csv_path}")
        sys.exit(1)

    # 인코딩 자동 감지 (utf-8-sig / euc-kr)
    for enc in ("utf-8-sig", "utf-8", "euc-kr", "cp949"):
        try:
            with open(path, encoding=enc) as f:
                sample = f.read(200)
            if sample:
                encoding = enc
                break
        except Exception:
            continue

    with open(path, encoding=encoding) as f:
        reader = csv.DictReader(f)
        headers = [h.strip() for h in (reader.fieldnames or [])]

    print(f"\n감지된 컬럼: {headers}")
    print(f"인코딩: {encoding}")

    # 컬럼 매핑
    col_map = {}
    for h in headers:
        mapped = NINEHIRE_COLUMN_MAP.get(h.lower(), NINEHIRE_COLUMN_MAP.get(h))
        if mapped:
            col_map[h] = mapped

    print(f"매핑된 컬럼: {col_map}")

    required = {"name", "phone", "email", "applied_at"}
    found = set(col_map.values())
    missing = required - found
    if missing:
        print(f"\n[WARN] 자동 매핑 실패 컬럼: {missing}")
        print("수동으로 매핑하려면 NINEHIRE_COLUMN_MAP에 컬럼명을 추가하세요.")

    # 기존 이력 로드
    history = load_history()
    existing_keys = {
        (norm_phone(r.get("phone", "")), norm_email(r.get("email", "")))
        for r in history
    }

    added = 0
    with open(path, encoding=encoding) as f:
        for row in csv.DictReader(f):
            record = {
                "source":     "ninehire_import",
                "imported_at": datetime.now().strftime("%Y-%m-%d"),
            }
            for orig_col, mapped_key in col_map.items():
                record[mapped_key] = row.get(orig_col, "").strip()

            phone = norm_phone(record.get("phone", ""))
            email = norm_email(record.get("email", ""))
            key   = (phone, email)

            if key in existing_keys:
                continue  # 이미 있음

            history.append(record)
            existing_keys.add(key)
            added += 1

    save_history(history)
    print(f"\n임포트 완료: {added}명 추가 (기존 포함 총 {len(history)}명)")
    print(f"이력 파일: {HISTORY_PATH.resolve()}")


# ─────────────────────────────────────────────
#  중복 제거 실행
# ─────────────────────────────────────────────

def run_dedup():
    history     = load_history()
    applicants  = load_remember_applicants()

    if not applicants:
        print("리멤버 지원자 데이터 없음.")
        return

    print(f"\n리멤버 지원자 총 {len(applicants)}명 / NineHire 이력 {len(history)}명")
    print(f"중복 판정 기준: 연락처 or 이메일 일치 + 지원일자 ±{DEDUP_DAYS}일\n")

    new_list  = []
    dup_list  = []

    for ap in applicants:
        dup, matched = is_duplicate(ap, history)
        if dup:
            dup_list.append((ap, matched))
        else:
            new_list.append(ap)

    # 결과 출력
    print(f"신규 (업로드 대상): {len(new_list)}명")
    print(f"중복 (스킵):        {len(dup_list)}명")

    if dup_list:
        print("\n[중복 목록]")
        for ap, matched in dup_list[:20]:
            print(f"  {ap['이름']} | {ap['연락처']} | {ap['지원일자']} "
                  f"← 이력: {matched.get('applied_at','')} ({matched.get('source','')})")
        if len(dup_list) > 20:
            print(f"  ... 외 {len(dup_list)-20}명")

    if not new_list:
        print("\n업로드할 신규 지원자 없음.")
        return

    # 업로드용 CSV 저장
    UPLOAD_OUT_DIR.mkdir(parents=True, exist_ok=True)
    today     = datetime.now().strftime("%Y%m%d")
    out_path  = UPLOAD_OUT_DIR / f"{today}_upload_ready.csv"

    columns = ["포지션명", "이름", "연락처", "이메일", "지원일자", "지원상태", "지원ID"]
    with open(out_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        w.writeheader()
        w.writerows(new_list)

    print(f"\n업로드용 CSV 저장: {out_path.resolve()}")
    print("NineHire에 수동 업로드 후 아래 명령어로 이력을 업데이트하세요:")
    print(f"  python3 scripts/ninehire_dedup.py --mark-uploaded {out_path}")


# ─────────────────────────────────────────────
#  업로드 완료 후 이력 업데이트
# ─────────────────────────────────────────────

def mark_uploaded(csv_path: str):
    """업로드 완료된 CSV를 이력 파일에 기록"""
    path = Path(csv_path)
    if not path.exists():
        print(f"[ERROR] 파일 없음: {csv_path}")
        sys.exit(1)

    history = load_history()
    existing_keys = {
        (norm_phone(r.get("phone", "")), norm_email(r.get("email", "")))
        for r in history
    }

    added      = 0
    today      = datetime.now().strftime("%Y-%m-%d")

    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            record = {
                "name":        row.get("이름", "").strip(),
                "phone":       row.get("연락처", "").strip(),
                "email":       row.get("이메일", "").strip(),
                "applied_at":  row.get("지원일자", "").strip(),
                "position":    row.get("포지션명", "").strip(),
                "status":      row.get("지원상태", "").strip(),
                "source":      "remember",
                "uploaded_at": today,
            }
            phone = norm_phone(record["phone"])
            email = norm_email(record["email"])
            key   = (phone, email)

            if key in existing_keys:
                continue

            history.append(record)
            existing_keys.add(key)
            added += 1

    save_history(history)
    print(f"이력 업데이트 완료: {added}명 추가 (총 {len(history)}명)")
    print(f"이력 파일: {HISTORY_PATH.resolve()}")


# ─────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="나인하이어 업로드 중복 제거")
    parser.add_argument("--import",         dest="import_csv",     help="NineHire 내보내기 CSV 경로 (초기 임포트)")
    parser.add_argument("--mark-uploaded",  dest="mark_uploaded",  help="업로드 완료된 CSV 경로 (이력 업데이트)")
    parser.add_argument("--days",           type=int, default=DEDUP_DAYS, help=f"지원일자 허용 오차 (기본: {DEDUP_DAYS}일)")
    args = parser.parse_args()

    if args.days != DEDUP_DAYS:
        globals()["DEDUP_DAYS"] = args.days

    if args.import_csv:
        import_ninehire_csv(args.import_csv)
    elif args.mark_uploaded:
        mark_uploaded(args.mark_uploaded)
    else:
        run_dedup()


if __name__ == "__main__":
    main()
