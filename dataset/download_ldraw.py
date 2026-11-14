#!/usr/bin/env python3
"""
Download official LDraw parts & LDConfig.ldr into `dataset/ldraw/` without bundling `.dat`
files in the repository. Uses standard library modules (`urllib`, `zipfile`, `json`).

Extracts the top-99 OMR parts listed in `dataset/omr_top99.json` along with all recursive
sub-part (`parts/s/...`) and primitive (`p/...`) dependencies, plus updates `dataset/colors.json`.

Usage:
  python3 dataset/download_ldraw.py [--all] [--cache /tmp/ldraw_complete.zip]
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OMR_JSON = HERE / "omr_top99.json"
OUT_LDRAW = HERE / "ldraw"
OUT_COLORS = HERE / "colors.json"

DEFAULT_URL = "https://library.ldraw.org/library/updates/complete.zip"
SUBFILE_RE = re.compile(r"^1\s+\S+(?:\s+\S+){12}\s+(.+)$")


def resolve_member(names_lower: dict[str, str], ref: str, is_sub: bool = False) -> str | None:
    clean = ref.strip().replace("\\", "/").lstrip("/").lower()
    candidates = [
        f"ldraw/parts/{clean}",
        f"ldraw/p/{clean}",
        f"ldraw/{clean}",
        f"parts/{clean}",
        f"p/{clean}",
    ]
    if is_sub and not clean.startswith("parts/") and not clean.startswith("p/"):
        candidates.insert(0, f"ldraw/parts/{clean}")
    for c in candidates:
        if c in names_lower:
            return names_lower[c]
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Download official LDraw parts needed for BrickPack SDF.")
    parser.add_argument("--url", default=DEFAULT_URL, help="Official LDraw complete.zip URL")
    parser.add_argument("--cache", type=Path, default=HERE / ".ldraw_complete.zip", help="Zip cache path")
    parser.add_argument("--all", action="store_true", help="Extract the entire LDraw library instead of only OMR top 99")
    parser.add_argument("--keep-zip", action="store_true", help="Keep downloaded zip after extraction")
    args = parser.parse_args()

    zip_path: Path = args.cache
    if not zip_path.is_file():
        print(f"Downloading {args.url} -> {zip_path} ...")
        req = urllib.request.Request(args.url, headers={"User-Agent": "BrickPack-SDF/1.0"})
        with urllib.request.urlopen(req, timeout=120) as resp, zip_path.open("wb") as out:
            total = int(resp.headers.get("Content-Length") or 0)
            read = 0
            while True:
                chunk = resp.read(1 << 18)
                if not chunk:
                    break
                out.write(chunk)
                read += len(chunk)
                if total:
                    pct = int(100 * read / total)
                    print(f"\r  {read / (1 << 20):.1f} / {total / (1 << 20):.1f} MB ({pct}%)", end="", flush=True)
            print()

    print(f"Inspecting {zip_path.name} ...")
    with zipfile.ZipFile(zip_path, "r") as zf:
        all_names = zf.namelist()
        names_lower = {n.lower(): n for n in all_names}

        if args.all:
            to_extract = {n for n in all_names if n.lower().endswith((".dat", ".ldr"))}
        else:
            omr = json.loads(OMR_JSON.read_text(encoding="utf-8"))
            parts = omr if isinstance(omr, list) else omr.get("parts", [])
            roots = [f"{str(p['id']).removesuffix('.dat')}.dat" for p in parts]

            queue: list[str] = []
            visited: set[str] = set()
            for r in roots:
                m = resolve_member(names_lower, r)
                if m and m not in visited:
                    visited.add(m)
                    queue.append(m)

            while queue:
                cur = queue.pop()
                txt = zf.read(cur).decode("utf-8", errors="ignore")
                for line in txt.splitlines():
                    s = line.strip()
                    if not s or not s.startswith("1 "):
                        continue
                    tok = s.split()
                    if len(tok) < 15:
                        continue
                    sub_ref = " ".join(tok[14:])
                    m = resolve_member(names_lower, sub_ref, is_sub=True)
                    if m and m not in visited:
                        visited.add(m)
                        queue.append(m)

            ldcfg = names_lower.get("ldraw/ldconfig.ldr") or names_lower.get("ldconfig.ldr")
            if ldcfg:
                visited.add(ldcfg)
            to_extract = visited

        OUT_LDRAW.mkdir(parents=True, exist_ok=True)
        extracted = 0
        for member in sorted(to_extract):
            low = member.lower()
            rel = member[len("ldraw/") :] if low.startswith("ldraw/") else member
            dest = OUT_LDRAW / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(zf.read(member))
            extracted += 1
        print(f"Extracted {extracted} LDraw files -> {OUT_LDRAW}")

    # Refresh colors.json from extracted LDConfig.ldr
    sys.path.insert(0, str(HERE.parent / "python"))
    from brickpack_sdf.colors import parse_ldconfig

    cfg_path = OUT_LDRAW / "LDConfig.ldr"
    if cfg_path.is_file():
        colors = parse_ldconfig(cfg_path.read_text(encoding="utf-8", errors="ignore"))
        OUT_COLORS.write_text(json.dumps({"source": "LDConfig.ldr", "count": len(colors), "colors": colors}, indent=2), encoding="utf-8")
        print(f"Parsed {len(colors)} official opaque colors -> {OUT_COLORS}")

    if not args.keep_zip and zip_path.is_file():
        zip_path.unlink()


if __name__ == "__main__":
    main()
