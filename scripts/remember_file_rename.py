"""
리멤버 다운로드 파일 일괄 이름 변경 (stdlib only — 패키지 설치 불필요)
- 형식: {컬럼명}_{이름}_{연락처 또는 이메일}_{원본파일명}
- 예:   포트폴리오_최태오_01012345678_portfolio.pdf

사용법:
  python3 scripts/remember_file_rename.py               # 최신 세션 자동 탐지
  python3 scripts/remember_file_rename.py --dry-run     # 미리 보기
  python3 scripts/remember_file_rename.py --dir output/remember_applicants/20240319_마케터
"""

import os
import re
import csv
import sys
import argparse
from pathlib import Path


def load_env(env_path: str = ".env") -> dict:
    env = {}
    try:
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, _, val = line.partition("=")
                    env[key.strip()] = val.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return env


_env = load_env()
OUTPUT_DIR = os.environ.get("OUTPUT_DIR") or _env.get("OUTPUT_DIR", "output/remember_applicants")

LABEL_RULES = [
    (r"(portfolio|포트폴리오|port)",   "포트폴리오"),
    (r"(resume|이력서|cv)",            "이력서"),
    (r"(cover.?letter|자기소개서)",    "자기소개서"),
    (r"(certificate|자격증)",          "자격증"),
]


def guess_label(filename: str) -> str:
    lower = filename.lower()
    for pattern, label in LABEL_RULES:
        if re.search(pattern, lower):
            return label
    return "첨부파일"


def already_renamed(name: str) -> bool:
    return bool(re.match(r"^[가-힣a-zA-Z]+_[가-힣a-zA-Z]+_", name))


def pick_contact(row: dict) -> str:
    return row.get("연락처", "").strip() or row.get("이메일", "").strip()


def load_applicants(session_dir: Path) -> dict:
    csv_path = session_dir / "applicants.csv"
    if not csv_path.exists():
        return {}
    mapping = {}
    with open(csv_path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            mapping[row["이름"].strip()] = {
                "연락처": row.get("연락처", ""),
                "이메일": row.get("이메일", ""),
            }
    return mapping


def extract_meta(filename: str, applicants: dict) -> tuple:
    parts = filename.split("_", 2)
    if len(parts) >= 2 and parts[0] in applicants:
        return parts[0], parts[1]
    if len(applicants) == 1:
        name, info = next(iter(applicants.items()))
        return name, pick_contact(info)
    for name, info in applicants.items():
        if name in filename:
            return name, pick_contact(info)
    return "이름미상", "연락처미상"


def rename_files(session_dir: Path, dry_run: bool = False):
    files_dir = session_dir / "files"
    if not files_dir.exists():
        print(f"  [SKIP] files 폴더 없음: {files_dir}")
        return

    applicants = load_applicants(session_dir)
    renamed = skipped = failed = 0

    for file in sorted(files_dir.iterdir()):
        if not file.is_file():
            continue

        if already_renamed(file.name):
            print(f"  [SKIP] {file.name}")
            skipped += 1
            continue

        name, contact = extract_meta(file.name, applicants)
        label    = guess_label(file.name)
        new_name = f"{label}_{name}_{contact}_{file.stem}{file.suffix}"
        new_path = files_dir / new_name

        print(f"  {'[DRY] ' if dry_run else '[OK]  '} {file.name}")
        print(f"         → {new_name}")

        if not dry_run:
            try:
                file.rename(new_path)
                renamed += 1
            except Exception as e:
                print(f"  [FAIL] {e}")
                failed += 1
        else:
            renamed += 1

    print(f"\n  변경: {renamed} / 스킵: {skipped} / 실패: {failed}")


def get_latest_session(base: Path):
    dirs = sorted([d for d in base.iterdir() if d.is_dir()], key=lambda d: d.name, reverse=True)
    return dirs[0] if dirs else None


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir",     help="세션 폴더 경로")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.dir:
        target = Path(args.dir)
    else:
        base   = Path(OUTPUT_DIR)
        target = get_latest_session(base)
        if not target:
            print(f"[ERROR] 세션 폴더 없음: {base}")
            sys.exit(1)
        print(f"최신 세션 사용: {target}")

    print(f"\n{'='*50}")
    print(f"대상: {target}  |  모드: {'DRY RUN' if args.dry_run else '실제 변경'}")
    print("="*50)
    rename_files(target, dry_run=args.dry_run)
