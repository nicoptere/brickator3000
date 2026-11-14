#!/usr/bin/env python3
"""Train a BrickPack part catalog from LDraw `.dat` files or a folder of OBJ/GLB/PLY meshes."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from brickpack_sdf.catalog import (
    part_sdf,
    save_catalog,
    train_catalog_ldraw,
    train_catalog_models,
)


def main() -> None:
    p = argparse.ArgumentParser(description="Train a BrickPack 4-LDU + 1-LDU SDF part catalog.")
    p.add_argument("--ldraw", type=Path, help="LDraw library root (with parts/ and p/)")
    p.add_argument("--rank", type=Path, help="Optional OMR ranking JSON (e.g. dataset/omr_top99.json)")
    p.add_argument("--models", type=Path, help="Directory of .obj / .glb / .ply files to convert into custom parts")
    p.add_argument("--out", type=Path, default=Path("../dataset/catalog_99_py.json"), help="Output catalog JSON")
    p.add_argument("--no-sdf-check", action="store_true", help="Skip 1-LDU EDT^2 SDF validation per part")
    args = p.parse_args()

    if args.ldraw:
        catalog = train_catalog_ldraw(args.ldraw, args.rank)
        src = "ldraw"
    elif args.models:
        catalog = train_catalog_models(args.models)
        src = "meshes"
    else:
        p.error("Provide --ldraw <dir> or --models <dir>")
        return

    if not args.no_sdf_check:
        for part in catalog:
            part["sdf_voxels"] = int(part_sdf(part, pad=2)["sdf"].size)

    out_p = save_catalog(catalog, args.out, source=src)
    print(f"Saved {len(catalog)} parts -> {out_p} ({out_p.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
