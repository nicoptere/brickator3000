#!/usr/bin/env python3
"""Pack an OBJ/GLB/PLY mesh or `.sdf.json` volume into LEGO bricks & export `.glb` (+ optional `.ldr`)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from brickpack_sdf.catalog import load_catalog
from brickpack_sdf.colors import load_colors
from brickpack_sdf.engine import pack_model
from brickpack_sdf.mesh_io import build_bricks_mesh, export_glb, export_ldr, load_model
from brickpack_sdf.target import load_sdf


DATASET_DIR = Path(__file__).resolve().parents[2] / "dataset"


def main() -> None:
    p = argparse.ArgumentParser(description="Convert a mesh or encoded SDF into BrickPack LEGO bricks (.glb / .ldr).")
    p.add_argument("input", type=Path, help="Input mesh (.obj, .glb, .ply) or encoded .sdf.json")
    p.add_argument("--catalog", type=Path, default=DATASET_DIR / "catalog_99.json", help="Trained BrickPack catalog JSON (default: catalog_99.json)")
    p.add_argument("--colors", type=Path, default=DATASET_DIR / "colors.json", help="Official LDraw colors JSON/LDConfig.ldr")
    p.add_argument("--policy", type=Path, help="Optional GA-tuned policy JSON")
    p.add_argument("--studs", type=int, default=16, help="Shortest bounding side in LEGO studs (default: 16)")
    p.add_argument("--effort", choices=("quick", "normal", "thorough"), default="normal", help="Search budget")
    p.add_argument("-o", "--out", type=Path, help="Output binary .glb path")
    p.add_argument("--ldr", type=Path, help="Optional LDraw .ldr output path")
    args = p.parse_args()

    catalog = load_catalog(args.catalog)
    colors = load_colors(args.colors) if args.colors.exists() else None
    policy = None
    if args.policy and args.policy.exists():
        doc = json.loads(args.policy.read_text(encoding="utf-8"))
        policy = doc["best"]["genes"] if "best" in doc else doc.get("genes", doc)

    if str(args.input).endswith(".sdf.json"):
        inp = load_sdf(args.input)
        print(f"Loaded SDF {args.input.name}: {inp[0]['nx']}x{inp[0]['ny']}x{inp[0]['nz']}")
    else:
        inp = load_model(args.input)
        print(f"Loaded {args.input.name}: {len(inp['tris'])} tris, has_color={inp['has_color']}")

    res = pack_model(inp, catalog=catalog, studs=args.studs, effort=args.effort, colors=colors, policy_override=policy)
    pk = res["pack"]
    print(f"BrickPack: {pk['pieces']} bricks | softIoU={pk['softIoU']} | components={pk['components']} | {pk['ms']['total']} ms")

    out_glb = args.out or args.input.with_name(f"{args.input.stem}_bricks.glb")
    mesh = build_bricks_mesh(res["pieces"], catalog)
    export_glb(mesh, out_glb)
    print(f"Saved GLB -> {out_glb} ({out_glb.stat().st_size / 1024:.1f} KB, {len(mesh['idx']) // 3} tris)")

    if args.ldr:
        export_ldr(res["pieces"], catalog, args.ldr, name=args.input.stem)
        print(f"Saved LDraw -> {args.ldr}")


if __name__ == "__main__":
    main()
