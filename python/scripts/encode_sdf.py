#!/usr/bin/env python3
"""Encode an OBJ, GLB, or PLY mesh into a `.sdf.json` + `.sdf.bin` continuous signed distance volume."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from brickpack_sdf.mesh_io import load_model
from brickpack_sdf.target import encode_sdf_volume, save_sdf


def main() -> None:
    p = argparse.ArgumentParser(description="Encode a 3D mesh into an interoperable BrickPack SDF volume.")
    p.add_argument("input", type=Path, help="Input mesh (.obj, .glb, .ply)")
    p.add_argument("--res", type=int, default=64, help="Max axis grid resolution (default: 64)")
    p.add_argument("--pad", type=int, default=3, help="Padding voxels around tight bounds")
    p.add_argument("--method", choices=("exact", "siren"), default="exact", help="Exact Barnes-Hut+BVH or PyTorch SIREN fit")
    p.add_argument("--siren-steps", type=int, default=1200, help="SIREN gradient steps if --method siren")
    p.add_argument("-o", "--out", type=Path, help="Output .sdf.json path")
    args = p.parse_args()

    model = load_model(args.input)
    print(f"Loaded {args.input.name}: {len(model['tris'])} tris, has_color={model['has_color']}")

    hdr, data = encode_sdf_volume(model, res=args.res, pad_voxels=args.pad, method=args.method, siren_steps=args.siren_steps)
    hdr["source"] = args.input.name

    out_json = args.out or args.input.with_suffix(".sdf.json")
    jp, bp = save_sdf(hdr, data, out_json)
    print(f"Encoded SDF ({hdr['nx']}x{hdr['ny']}x{hdr['nz']}, {hdr['compute']}) in {hdr['ms']} ms")
    print(f"Wrote {jp} + {bp} ({bp.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
