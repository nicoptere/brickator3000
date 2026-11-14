#!/usr/bin/env python3
"""Train BrickPack policy hyperparameters using the Genetic Algorithm over a directory of 3D models."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from brickpack_sdf.catalog import PACK_KINDS, build_variants, load_catalog
from brickpack_sdf.ga import train_ga
from brickpack_sdf.mesh_io import load_model
from brickpack_sdf.policy import POLICY
from brickpack_sdf.solver import fidelity, pack_iou
from brickpack_sdf.target import frame_for, gaussian_octaves, target_field, thicken_thin


DATASET_DIR = Path(__file__).resolve().parents[2] / "dataset"


def main() -> None:
    p = argparse.ArgumentParser(description="Train BrickPack policy hyperparameters via GA.")
    p.add_argument("--models", type=Path, default=DATASET_DIR / "models", help="Folder of .obj/.glb/.ply training models")
    p.add_argument("--catalog", type=Path, default=DATASET_DIR / "catalog_99.json", help="Trained catalog JSON (default: catalog_99.json)")
    p.add_argument("--studs", type=int, default=10, help="Training scale in studs")
    p.add_argument("--pop", type=int, default=6, help="GA population size")
    p.add_argument("--gens", type=int, default=3, help="GA generations")
    p.add_argument("-o", "--out", type=Path, default=Path("./out/policy_py.json"), help="Output policy JSON")
    args = p.parse_args()

    catalog = load_catalog(args.catalog)
    by_key, variants = build_variants(catalog, kinds=PACK_KINDS)

    files = sorted([f for f in args.models.iterdir() if f.suffix.lower() in (".obj", ".glb", ".ply")])[:4]
    cache = {}
    batch = []
    for f in files:
        m = load_model(f)
        T = target_field(m, frame_for(m, args.studs))
        thin = thicken_thin(T)
        TP = {**T, "t": thin["t"]} if thin["added"] else T
        F = gaussian_octaves(TP, core_octave=1)
        cache[f.name] = (T, TP, F, thin["phase"] if thin["added"] else None)
        batch.append({"name": f.name, "studs": args.studs})

    def evaluate(genes: dict, item: dict) -> dict:
        T, TP, F, ph = cache[item["name"]]
        pol = {**POLICY, **genes, "lnsIters": 450, "lnsPasses": 2}
        # Recompute core octave if genome changed coreOctave
        F_cur = gaussian_octaves(TP, core_octave=int(pol.get("coreOctave", 1)))
        best = pack_iou(TP, F_cur, variants, by_key, policy=pol, theta_iters=3, theta_lns=100, phase=ph)
        return fidelity(best["r"]["pieces"], by_key, T, best["r"]["phase"])

    state = train_ga(args.out, batch, evaluate, pop=args.pop, gens=args.gens, seed_genomes=[POLICY])
    print(f"Best fitness {state['best']['fitness']} -> {args.out}")
    print(json.dumps(state["best"]["genes"], indent=2))


if __name__ == "__main__":
    main()
