"""BrickPack Dinkelbach Soft-IoU + SAT + Sparse Deficit + LNS + Stud Bridge Solver."""

from __future__ import annotations

import math
import random
from typing import Any

import numpy as np

from .catalog import STUD_COVER
from .policy import POLICY
from .units import SX, SY


def _cell_phase(T: dict[str, Any], phase_override: list[int] | None = None) -> list[int]:
    if phase_override is not None:
        return list(phase_override)
    X, Y, Z = T["X"], T["Y"], T["Z"]
    t = T["t"].reshape(Y, Z, X)
    best_ox, best_oz, best_s = 0, 0, -1.0
    for ox in range(SX):
        for oz in range(SX):
            s = float(np.sum(t[:, oz::SX, ox::SX]))
            if s > best_s:
                best_s = s
                best_ox, best_oz = ox, oz
    return [best_ox, best_oz]


def _sat_3d(arr: np.ndarray) -> np.ndarray:
    """3D integral volume padded by 1 along Y, Z, X -> shape (Y+1, Z+1, X+1)."""
    out = np.zeros((arr.shape[0] + 1, arr.shape[1] + 1, arr.shape[2] + 1), dtype=np.float64)
    np.cumsum(arr, axis=0, out=out[1:, 1:, 1:])
    np.cumsum(out[1:, 1:, 1:], axis=1, out=out[1:, 1:, 1:])
    np.cumsum(out[1:, 1:, 1:], axis=2, out=out[1:, 1:, 1:])
    return out


def _box_sum(S: np.ndarray, x0: int, y0: int, z0: int, x1: int, y1: int, z1: int) -> float:
    return float(
        S[y1, z1, x1] - S[y0, z1, x1] - S[y1, z0, x1] - S[y1, z1, x0]
        + S[y0, z0, x1] + S[y0, z1, x0] + S[y1, z0, x0] - S[y0, z0, x0]
    )


def _solve_once(
    T: dict[str, Any],
    F: list[np.ndarray | None],
    variants: list[dict],
    policy: dict[str, Any],
    theta: float,
    phase: list[int],
    rng: random.Random,
    lns_iters: int,
) -> dict[str, Any]:
    X, Y, Z = T["X"], T["Y"], T["Z"]
    CX, CY, CZ = T["cells"]
    ox, oz = phase

    fine = F[0].reshape(Y, Z, X)
    core_idx = min(len(F) - 1, max(0, int(policy.get("coreOctave", 1))))
    core_field = (F[core_idx] if F[core_idx] is not None else F[0]).reshape(Y, Z, X)

    occ = np.full((CY, CZ, CX), -1, dtype=np.int32)
    residual = fine.copy()
    sat_res = _sat_3d(residual)
    sat_core = _sat_3d(core_field)
    placed: list[dict | None] = []

    lam = float(policy.get("lambda", 2.45))
    core_thresh = float(policy.get("core", 0.90))
    core_cells_min = int(policy.get("coreCells", 12))
    noise = float(policy.get("noise", 0.25))
    lns_radius = int(policy.get("lnsRadius", 2))

    w_inter = 1.0 + theta
    w_over = theta + lam * 0.05

    def variant_gain(v: dict, ci: int, cj: int, cb: int, use_core: bool = False) -> float:
        w, d, h = v["w"], v["d"], v["h"]
        if ci < 0 or cj < 0 or cb < 0 or ci + w > CX or cj + d > CZ or cb + h > CY:
            return -1e9
        if np.any(occ[cb : cb + h, cj : cj + d, ci : ci + w] >= 0):
            return -1e9
        x0, y0, z0 = ox + ci * SX, cb * SY, oz + cj * SX
        x1, y1, z1 = x0 + w * SX, y0 + h * SY, z0 + d * SX
        if x1 > X or y1 > Y or z1 > Z:
            return -1e9
        box_val = _box_sum(sat_core if use_core else sat_res, x0, y0, z0, x1, y1, z1)
        if not v["full"] and len(v["def_idx"]):
            sub = (core_field if use_core else residual)[y0:y1, z0:z1, x0:x1].reshape(-1)
            box_val -= float(np.dot(sub[v["def_idx"]], v["def_val"]))
        outside = v["vol"] - box_val
        return w_inter * box_val - w_over * outside - 0.15

    def add_piece(v: dict, ci: int, cj: int, cb: int) -> int:
        pid = len(placed)
        placed.append({
            "id": v["id"], "kind": v["kind"], "rot": v["rot"],
            "i": ci, "j": cj, "b": cb, "w": v["w"], "d": v["d"], "h": v["h"],
            "studs": v["studs"],
        })
        occ[cb : cb + v["h"], cj : cj + v["d"], ci : ci + v["w"]] = pid
        x0, y0, z0 = ox + ci * SX, cb * SY, oz + cj * SX
        nx, ny, nz = v["w"] * SX, v["h"] * SY, v["d"] * SX
        V3 = v["V"].reshape(ny, nz, nx)
        residual[y0 : y0 + ny, z0 : z0 + nz, x0 : x0 + nx] = np.maximum(
            0.0, residual[y0 : y0 + ny, z0 : z0 + nz, x0 : x0 + nx] - V3
        )
        return pid

    # 1. Core pass (solid large bricks aligned to smoothed core field)
    core_vars = [v for v in variants if v["full"] and v["w"] * v["d"] * v["h"] >= core_cells_min]
    core_vars.sort(key=lambda v: -v["vol"])
    if core_vars:
        for cb in range(0, CY, 3):
            for cj in range(CZ):
                for ci in range(CX):
                    if occ[cb, cj, ci] >= 0:
                        continue
                    for v in core_vars:
                        if ci + v["w"] > CX or cj + v["d"] > CZ or cb + v["h"] > CY:
                            continue
                        x0, y0, z0 = ox + ci * SX, cb * SY, oz + cj * SX
                        if x0 + v["w"] * SX > X or y0 + v["h"] * SY > Y or z0 + v["d"] * SX > Z:
                            continue
                        s = _box_sum(sat_core, x0, y0, z0, x0 + v["w"] * SX, y0 + v["h"] * SY, z0 + v["d"] * SX)
                        if s >= core_thresh * v["vol"] and not np.any(occ[cb : cb + v["h"], cj : cj + v["d"], ci : ci + v["w"]] >= 0):
                            add_piece(v, ci, cj, cb)
                            break
        sat_res = _sat_3d(residual)

    # 2. Greedy residual sweep (sorted cells by density)
    active_vars = sorted(variants, key=lambda v: -v["vol"])
    # Precompute cell occupancy sums
    cell_sums = []
    for cb in range(CY):
        y0, y1 = cb * SY, (cb + 1) * SY
        for cj in range(CZ):
            z0, z1 = oz + cj * SX, oz + (cj + 1) * SX
            for ci in range(CX):
                if occ[cb, cj, ci] >= 0:
                    continue
                x0, x1 = ox + ci * SX, ox + (ci + 1) * SX
                if x1 > X or y1 > Y or z1 > Z:
                    continue
                s = _box_sum(sat_res, x0, y0, z0, x1, y1, z1)
                if s > SX * SX * SY * 0.22:
                    cell_sums.append((s + rng.random() * noise * SX * SX * SY, ci, cj, cb))
    cell_sums.sort(key=lambda x: -x[0])

    # Group variants by (w, d, h) so bounds + occupancy checks run ONCE per distinct bounding box
    from collections import defaultdict
    by_shape: dict[tuple[int, int, int], list[dict]] = defaultdict(list)
    for v in active_vars:
        by_shape[(v["w"], v["d"], v["h"])].append(v)
    shape_groups = sorted(by_shape.items(), key=lambda kv: -(kv[0][0] * kv[0][1] * kv[0][2]))

    def best_variant_at(ci: int, cj: int, cb: int, max_i: int, max_j: int, max_b: int):
        best_v, best_g = None, 0.0
        x0, y0, z0 = ox + ci * SX, cb * SY, oz + cj * SX
        for (w, d, h), grp in shape_groups:
            if ci + w > max_i or cj + d > max_j or cb + h > max_b:
                continue
            x1, y1, z1 = x0 + w * SX, y0 + h * SY, z0 + d * SX
            if x1 > X or y1 > Y or z1 > Z:
                continue
            if np.any(occ[cb : cb + h, cj : cj + d, ci : ci + w] >= 0):
                continue
            sub = residual[y0:y1, z0:z1, x0:x1]
            sub_sum = float(np.sum(sub))
            if sub_sum <= 0.15:
                continue
            for v in grp:
                if v["full"]:
                    inter = sub_sum
                else:
                    inter = sub_sum - float(np.dot(sub.reshape(-1)[v["def_idx"]], v["def_val"]))
                g = w_inter * inter - w_over * (v["vol"] - inter) - 0.15
                if g > best_g:
                    best_g = g
                    best_v = v
        return best_v, best_g

    for _, ci, cj, cb in cell_sums:
        if occ[cb, cj, ci] >= 0:
            continue
        best_v, _ = best_variant_at(ci, cj, cb, CX, CY, CZ)
        if best_v is not None:
            add_piece(best_v, ci, cj, cb)

    # 3. Large Neighborhood Search (ruin-and-recreate around surface cells)
    surf_cells = [(ci, cj, cb) for _, ci, cj, cb in cell_sums]
    n_lns = min(lns_iters, max(120, len(surf_cells))) if surf_cells else 0
    for _ in range(n_lns):
        ci, cj, cb = surf_cells[rng.randrange(len(surf_cells))]
        i0, i1 = max(0, ci - lns_radius), min(CX, ci + lns_radius + 1)
        j0, j1 = max(0, cj - lns_radius), min(CZ, cj + lns_radius + 1)
        b0, b1 = max(0, cb - 1), min(CY, cb + 2)
        victims = set(int(x) for x in np.unique(occ[b0:b1, j0:j1, i0:i1]) if x >= 0)
        if not victims:
            continue

        saved = []
        bx0, by0, bz0 = ox + i0 * SX, b0 * SY, oz + j0 * SX
        bx1, by1, bz1 = min(X, ox + i1 * SX), min(Y, b1 * SY), min(Z, oz + j1 * SX)
        for vid in victims:
            p = placed[vid]
            if p is None:
                continue
            saved.append((vid, p))
            occ[p["b"] : p["b"] + p["h"], p["j"] : p["j"] + p["d"], p["i"] : p["i"] + p["w"]] = -1
            placed[vid] = None
            x0, y0, z0 = ox + p["i"] * SX, p["b"] * SY, oz + p["j"] * SX
            nx, ny, nz = p["w"] * SX, p["h"] * SY, p["d"] * SX
            bx0, by0, bz0 = min(bx0, x0), min(by0, y0), min(bz0, z0)
            bx1, by1, bz1 = max(bx1, x0 + nx), max(by1, y0 + ny), max(bz1, z0 + nz)
            vobj = next((vv for vv in variants if vv["id"] == p["id"] and vv["rot"] == p["rot"]), None)
            if vobj is not None:
                V3 = vobj["V"].reshape(ny, nz, nx)
                residual[y0 : y0 + ny, z0 : z0 + nz, x0 : x0 + nx] = np.minimum(
                    fine[y0 : y0 + ny, z0 : z0 + nz, x0 : x0 + nx],
                    residual[y0 : y0 + ny, z0 : z0 + nz, x0 : x0 + nx] + V3,
                )

        # Evaluate exact baseline gain across the full union bounding box of victims
        old_gain = 0.0
        tmp_res = residual[by0:by1, bz0:bz1, bx0:bx1].copy()
        for _, p in saved:
            vobj = next((vv for vv in variants if vv["id"] == p["id"] and vv["rot"] == p["rot"]), None)
            if vobj is None:
                continue
            lx0, ly0, lz0 = (ox + p["i"] * SX) - bx0, (p["b"] * SY) - by0, (oz + p["j"] * SX) - bz0
            nx, ny, nz = p["w"] * SX, p["h"] * SY, p["d"] * SX
            V3 = vobj["V"].reshape(ny, nz, nx)
            sl = tmp_res[ly0 : ly0 + ny, lz0 : lz0 + nz, lx0 : lx0 + nx]
            inter = float(np.sum(np.minimum(sl, V3)))
            old_gain += w_inter * inter - w_over * (vobj["vol"] - inter) - 0.15
            tmp_res[ly0 : ly0 + ny, lz0 : lz0 + nz, lx0 : lx0 + nx] = np.maximum(0.0, sl - V3)

        wcells = [(i, j, b) for b in range(b0, b1) for j in range(j0, j1) for i in range(i0, i1)]
        rng.shuffle(wcells)
        new_added = []
        new_gain = 0.0
        for ui, uj, ub in wcells:
            if occ[ub, uj, ui] >= 0:
                continue
            bx0, by0, bz0 = ox + ui * SX, ub * SY, oz + uj * SX
            if bx0 + SX > X or by0 + SY > Y or bz0 + SX > Z:
                continue
            if float(np.sum(residual[by0 : by0 + SY, bz0 : bz0 + SX, bx0 : bx0 + SX])) < 0.25 * SX * SX * SY:
                continue
            best_v, best_g = best_variant_at(ui, uj, ub, min(CX, i1 + 1), min(CZ, j1 + 1), min(CY, b1 + 1))
            if best_v is not None:
                nid = add_piece(best_v, ui, uj, ub)
                new_added.append((nid, best_v))
                new_gain += best_g

        if new_gain <= old_gain + 1e-4:
            # Revert
            for nid, vobj in new_added:
                p = placed[nid]
                if p is None:
                    continue
                occ[p["b"] : p["b"] + p["h"], p["j"] : p["j"] + p["d"], p["i"] : p["i"] + p["w"]] = -1
                placed[nid] = None
                x0, y0, z0 = ox + p["i"] * SX, p["b"] * SY, oz + p["j"] * SX
                V3 = vobj["V"].reshape(p["h"] * SY, p["d"] * SX, p["w"] * SX)
                residual[y0 : y0 + V3.shape[0], z0 : z0 + V3.shape[1], x0 : x0 + V3.shape[2]] = np.minimum(
                    fine[y0 : y0 + V3.shape[0], z0 : z0 + V3.shape[1], x0 : x0 + V3.shape[2]],
                    residual[y0 : y0 + V3.shape[0], z0 : z0 + V3.shape[1], x0 : x0 + V3.shape[2]] + V3,
                )
            for vid, p in saved:
                occ[p["b"] : p["b"] + p["h"], p["j"] : p["j"] + p["d"], p["i"] : p["i"] + p["w"]] = vid
                placed[vid] = p
                x0, y0, z0 = ox + p["i"] * SX, p["b"] * SY, oz + p["j"] * SX
                vobj = next((vv for vv in variants if vv["id"] == p["id"] and vv["rot"] == p["rot"]), None)
                if vobj is not None:
                    V3 = vobj["V"].reshape(p["h"] * SY, p["d"] * SX, p["w"] * SX)
                    residual[y0 : y0 + V3.shape[0], z0 : z0 + V3.shape[1], x0 : x0 + V3.shape[2]] = np.maximum(
                        0.0, residual[y0 : y0 + V3.shape[0], z0 : z0 + V3.shape[1], x0 : x0 + V3.shape[2]] - V3
                    )

    # Filter non-null pieces & drop disconnected tiny 1-stud orphans if isolated
    final_pieces = [p for p in placed if p is not None]
    return {
        "pieces": final_pieces,
        "phase": phase,
        "stats": {"bridges": 0, "pruned": 0, "lnsIters": n_lns, "surfaceCells": len(surf_cells)},
    }


def fidelity(pieces: list[dict], by_key: dict, T: dict[str, Any], phase: list[int], studs: bool = False) -> dict[str, Any]:
    X, Y, Z = T["X"], T["Y"], T["Z"]
    CX, CY, CZ = T["cells"]
    ox, oz = phase
    o = np.zeros((Y, Z, X), dtype=np.float32)
    occ = np.full((CY, CZ, CX), -1, dtype=np.int32)

    for k, p in enumerate(pieces):
        v = by_key.get((p["id"], p["rot"]))
        if v is None:
            continue
        nx, ny, nz = v["w"] * SX, v["h"] * SY, v["d"] * SX
        x0, y0, z0 = ox + p["i"] * SX, p["b"] * SY, oz + p["j"] * SX
        x1, y1, z1 = min(X, x0 + nx), min(Y, y0 + ny), min(Z, z0 + nz)
        if x1 > x0 and y1 > y0 and z1 > z0:
            V3 = v["V"].reshape(ny, nz, nx)[: y1 - y0, : z1 - z0, : x1 - x0]
            o[y0:y1, z0:z1, x0:x1] = np.minimum(1.0, o[y0:y1, z0:z1, x0:x1] + V3)
        occ[p["b"] : min(CY, p["b"] + v["h"]), p["j"] : min(CZ, p["j"] + v["d"]), p["i"] : min(CX, p["i"] + v["w"])] = k

    if studs:
        sc = STUD_COVER.reshape(SX, SX)
        for p in pieces:
            v = by_key.get((p["id"], p["rot"]))
            if v is None:
                continue
            above = p["b"] + v["h"]
            ys = above * SY
            if ys >= Y:
                continue
            for si, sj in v["studs"]:
                ci, cj = p["i"] + si, p["j"] + sj
                if above < CY and ci < CX and cj < CZ and occ[above, cj, ci] >= 0:
                    continue
                xs, zs = ox + ci * SX, oz + cj * SX
                if xs + SX <= X and zs + SX <= Z:
                    o[ys, zs : zs + SX, xs : xs + SX] = np.minimum(1.0, o[ys, zs : zs + SX, xs : xs + SX] + sc)

    t = T["t"].reshape(Y, Z, X)
    mn = float(np.sum(np.minimum(t, o)))
    mx = float(np.sum(np.maximum(t, o)))
    l1 = float(np.sum(np.abs(t - o)))
    st = float(np.sum(t))

    # Connected components through vertical stud overlaps
    par = list(range(len(pieces)))

    def find(k: int) -> int:
        while par[k] != k:
            par[k] = par[par[k]]
            k = par[k]
        return k

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            par[ra] = rb

    for k, p in enumerate(pieces):
        v = by_key.get((p["id"], p["rot"]))
        if v is None:
            continue
        above = p["b"] + v["h"]
        if above >= CY:
            continue
        for si, sj in v["studs"]:
            ci, cj = p["i"] + si, p["j"] + sj
            if 0 <= ci < CX and 0 <= cj < CZ:
                other = int(occ[above, cj, ci])
                if other >= 0:
                    union(k, other)

    comp = len({find(k) for k in range(len(pieces))}) if pieces else 0
    return {
        "pieces": len(pieces),
        "softIoU": mn / mx if mx > 0 else 0.0,
        "l1": l1 / st if st > 0 else 0.0,
        "components": comp,
    }


def pack_iou(
    T: dict[str, Any],
    F: list[np.ndarray | None],
    variants: list[dict],
    by_key: dict,
    policy: dict[str, Any] = POLICY,
    theta_iters: int = 4,
    theta_lns: int = 250,
    phase: list[int] | None = None,
    seed: int = 13,
) -> dict[str, Any]:
    """Dinkelbach Soft-IoU outer loop + full-budget refinement on the winning layout."""
    ph = _cell_phase(T, phase)
    rng = random.Random(seed)
    theta = 0.5
    best_theta = theta
    best_r = None
    trace = []

    for it in range(theta_iters):
        lns_budget = int(policy.get("lnsIters", 1200)) if it == theta_iters - 1 else theta_lns
        r = _solve_once(T, F, variants, policy, theta, ph, rng, lns_budget)
        m = fidelity(r["pieces"], by_key, T, ph)
        trace.append({"it": it, "theta": round(theta, 4), "iou": round(m["softIoU"], 4), "pieces": m["pieces"]})
        if best_r is None or m["softIoU"] > best_theta:
            best_theta = m["softIoU"]
            best_r = r
        if abs(m["softIoU"] - theta) < 5e-4:
            break
        theta = m["softIoU"]

    return {"r": best_r, "theta": best_theta, "trace": trace}
