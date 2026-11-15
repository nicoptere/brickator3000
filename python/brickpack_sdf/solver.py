"""BrickPack Dinkelbach Soft-IoU + SAT + Sparse Deficit + LNS + Stud Bridge Solver."""

from __future__ import annotations

import math
import random
from typing import Any

import numpy as np

from .catalog import STUD_COVER
from .policy import POLICY
from .units import SX, SY


def _cells_of(T: dict[str, Any], w: np.ndarray, ox: int, oz: int) -> tuple[np.ndarray, np.ndarray]:
    """Per-cell sums of weight field `w` and surface-mixed flags for stud grid phase (ox, oz)."""
    X, Y, Z = T["X"], T["Y"], T["Z"]
    CX, CY, CZ = T["cells"]
    t3 = T["t"].reshape(Y, Z, X)[:, oz : oz + CZ * SX, ox : ox + CX * SX]
    w3 = w.reshape(Y, Z, X)[:, oz : oz + CZ * SX, ox : ox + CX * SX]
    t6 = t3.reshape(CY, SY, CZ, SX, CX, SX)
    w6 = w3.reshape(CY, SY, CZ, SX, CX, SX)
    C = w6.sum(axis=(1, 3, 5), dtype=np.float64)
    lo = t6.min(axis=(1, 3, 5))
    hi = t6.max(axis=(1, 3, 5))
    mixed = (hi > 0.02) & (lo < 0.98)
    return C, mixed


def _choose_phase(T: dict[str, Any], t: np.ndarray, lam: float = 3.0, theta: float = 0.5) -> list[int]:
    """Grid phase (ox, oz) whose unconstrained 1x1 plate cover earns highest upper-bound gain."""
    w = 2.0 * (t.astype(np.float64) - theta)
    X, Y, Z = T["X"], T["Y"], T["Z"]
    CX, CY, CZ = T["cells"]
    w3 = w.reshape(Y, Z, X)
    best_s = -math.inf
    best_ph = [0, 0]
    for ox in range(SX):
        for oz in range(SX):
            c = w3[:, oz : oz + CZ * SX, ox : ox + CX * SX].reshape(CY, SY, CZ, SX, CX, SX).sum(axis=(1, 3, 5))
            pos = c[c > lam]
            ub = float(np.sum(pos - lam)) if len(pos) else 0.0
            if ub > best_s:
                best_s = ub
                best_ph = [ox, oz]
    return best_ph


def _sat_3d_cells(A: np.ndarray) -> np.ndarray:
    """3D summed-area table over shape (CY, CZ, CX) -> padded shape (CY+1, CZ+1, CX+1)."""
    out = np.zeros((A.shape[0] + 1, A.shape[1] + 1, A.shape[2] + 1), dtype=np.float64)
    np.cumsum(A, axis=0, out=out[1:, 1:, 1:])
    np.cumsum(out[1:, 1:, 1:], axis=1, out=out[1:, 1:, 1:])
    np.cumsum(out[1:, 1:, 1:], axis=2, out=out[1:, 1:, 1:])
    return out


def _sat_window(S: np.ndarray, w: int, h: int, d: int) -> np.ndarray:
    """Box sums over all valid anchors for a (w, h, d) box on SAT of shape (CY+1, CZ+1, CX+1)."""
    return (
        S[h:, d:, w:] - S[:-h, d:, w:] - S[h:, :-d, w:] - S[h:, d:, :-w]
        + S[:-h, :-d, w:] + S[:-h, d:, :-w] + S[h:, :-d, :-w] - S[:-h, :-d, :-w]
    )


def _deficit_rel(v: dict, X: int, Z: int) -> np.ndarray:
    """Cached linear sub-voxel offsets relative to cell anchor base for shaped variant `v`."""
    cache = v.setdefault("_rel_cache", {})
    key = (X, Z)
    rel = cache.get(key)
    if rel is None:
        nx, nz = v["w"] * SX, v["d"] * SX
        per = nx * nz
        di = v["def_idx"]
        l = di // per
        r = di - l * per
        z = r // nx
        x = r - z * nx
        rel = ((l * Z + z) * X + x).astype(np.int64)
        cache[key] = rel
    return rel


def _gain_at(v: dict, i: int, j: int, b: int, w_flat: np.ndarray, X: int, Z: int, ox: int, oz: int, sat_c: np.ndarray) -> float:
    b1, j1, i1 = b + v["h"], j + v["d"], i + v["w"]
    g = float(
        sat_c[b1, j1, i1] - sat_c[b, j1, i1] - sat_c[b1, j, i1] - sat_c[b1, j1, i]
        + sat_c[b, j, i1] + sat_c[b, j1, i] + sat_c[b1, j, i] - sat_c[b, j, i]
    )
    if not v["full"] and len(v["def_idx"]):
        base = ((b * SY) * Z + oz + j * SX) * X + ox + i * SX
        rel = _deficit_rel(v, X, Z)
        g -= float(np.dot(w_flat[base + rel], v["def_val"]))
    return g


def _solve_once(
    T: dict[str, Any],
    F: list[np.ndarray | None],
    variants: list[dict],
    policy: dict[str, Any],
    theta: float,
    phase: list[int],
    rng: random.Random,
    lns_iters: int,
    lns_passes: float,
) -> dict[str, Any]:
    X, Y, Z = T["X"], T["Y"], T["Z"]
    CX, CY, CZ = T["cells"]
    NC = CX * CY * CZ
    ox, oz = phase

    t_fine = F[0]
    w_flat = (2.0 * (t_fine.astype(np.float64) - theta)).reshape(-1)
    core_oct = min(len(F) - 1, max(0, int(policy.get("coreOctave", 1))))
    t_core = F[core_oct] if F[core_oct] is not None else t_fine
    w_core = w_flat if t_core is t_fine else (2.0 * (t_core.astype(np.float64) - theta)).reshape(-1)

    C, mixed = _cells_of(T, w_flat, ox, oz)
    sat_c = _sat_3d_cells(C)
    sat_mix = _sat_3d_cells(mixed.astype(np.float64))
    sat_core = sat_c if w_core is w_flat else _sat_3d_cells(_cells_of(T, w_core, ox, oz)[0])

    lam = float(policy.get("lambda", 8.5877))
    core_thresh = float(policy.get("core", 0.9377))
    core_cells = int(policy.get("coreCells", 12))
    noise = float(policy.get("noise", 0.5478))
    lns_radius = int(policy.get("lnsRadius", 1))
    connect = float(policy.get("connect", 154.7494))
    bridge_flag = float(policy.get("bridge", 1))
    bridge_max = float(policy.get("bridgeMax", 4000.0))
    enforce_single = policy.get("enforceSingleComponent", True)

    # ---- 1. Vectorized candidate generation
    cv_chunks, ca_chunks, cg_chunks, cs_chunks = [], [], [], []
    for vi, v in enumerate(variants):
        vw, vh, vd = v["w"], v["h"], v["d"]
        if vw > CX or vh > CY or vd > CZ:
            continue
        box_all = _sat_window(sat_c, vw, vh, vd)
        if v["full"]:
            net_all = box_all - lam
            mask = net_all > 0.0
            if not np.any(mask):
                continue
            bs, js, is_ = np.nonzero(mask)
            nets = net_all[bs, js, is_]
            if vw * vh * vd >= core_cells:
                core_all = box_all if sat_core is sat_c else _sat_window(sat_core, vw, vh, vd)
                c_mask = box_all[bs, js, is_] >= 2.0 * (core_thresh - theta) * v["vol"]
                c_scores = np.where(c_mask, core_all[bs, js, is_] - lam, -np.inf)
            else:
                c_scores = np.full(len(nets), -np.inf, dtype=np.float64)
        else:
            mix_all = _sat_window(sat_mix, vw, vh, vd)
            m_mask = mix_all >= 0.5
            if not np.any(m_mask):
                continue
            bs, js, is_ = np.nonzero(m_mask)
            g_arr = box_all[bs, js, is_].copy()
            rel = _deficit_rel(v, X, Z)
            if len(rel):
                dv = v["def_val"].astype(np.float64)
                bases = ((bs * SY) * Z + (oz + js * SX)) * X + (ox + is_ * SX)
                m = len(bases)
                chunk = max(1, 2_000_000 // max(1, len(rel)))
                for s0 in range(0, m, chunk):
                    s1 = min(m, s0 + chunk)
                    idx = bases[s0:s1, None] + rel[None, :]
                    g_arr[s0:s1] -= w_flat[idx] @ dv
            net_arr = g_arr - lam
            keep = net_arr > 0.0
            if not np.any(keep):
                continue
            bs, js, is_, nets = bs[keep], js[keep], is_[keep], net_arr[keep]
            c_scores = np.full(len(nets), -np.inf, dtype=np.float64)

        a_arr = (bs * CZ + js) * CX + is_
        cv_chunks.append(np.full(len(a_arr), vi, dtype=np.int32))
        ca_chunks.append(a_arr.astype(np.int32))
        cg_chunks.append(nets.astype(np.float64))
        cs_chunks.append(c_scores.astype(np.float64))

    if cv_chunks:
        cv_arr = np.concatenate(cv_chunks)
        ca_arr = np.concatenate(ca_chunks)
        cg_arr = np.concatenate(cg_chunks)
        cs_arr = np.concatenate(cs_chunks)
    else:
        cv_arr = np.zeros(0, dtype=np.int32)
        ca_arr = np.zeros(0, dtype=np.int32)
        cg_arr = np.zeros(0, dtype=np.float64)
        cs_arr = np.zeros(0, dtype=np.float64)

    cv = cv_arr.tolist()
    ca = ca_arr.tolist()
    cg = cg_arr.tolist()
    n_cand = len(cv)

    # Precompute variant lookup tables for tight inner loops
    vw_arr = [v["w"] for v in variants]
    vh_arr = [v["h"] for v in variants]
    vd_arr = [v["d"] for v in variants]
    vstuds_arr = [v["studs"] for v in variants]
    stud_masks = []
    for v in variants:
        sm = [False] * (v["w"] * v["d"])
        for si, sj in v["studs"]:
            sm[sj * v["w"] + si] = True
        stud_masks.append(sm)

    occ = [-1] * NC
    pieces: list[list[int | bool]] = []  # [cand_idx, alive]
    stud_cells_k: list[tuple[int, ...]] = []
    alive_set: set[int] = set()
    uf_par: list[int] = []
    uf_stamp: list[int] = []
    uf_epoch = 0
    objective = 0.0

    def cell_idx(i: int, b: int, j: int) -> int:
        return (b * CZ + j) * CX + i

    def is_free(c: int) -> bool:
        vi = cv[c]
        a = ca[c]
        i = a % CX
        j = (a // CX) % CZ
        b = a // (CX * CZ)
        w, h, d = vw_arr[vi], vh_arr[vi], vd_arr[vi]
        for bb in range(b, b + h):
            bo = bb * CZ * CX
            for jj in range(j, j + d):
                jo = bo + jj * CX + i
                for ii in range(w):
                    if occ[jo + ii] >= 0:
                        return False
        return True

    def place(c: int) -> int:
        nonlocal objective
        k = len(pieces)
        pieces.append([c, True])
        vi = cv[c]
        a = ca[c]
        i = a % CX
        j = (a // CX) % CZ
        b = a // (CX * CZ)
        w, h, d = vw_arr[vi], vh_arr[vi], vd_arr[vi]
        for bb in range(b, b + h):
            bo = bb * CZ * CX
            for jj in range(j, j + d):
                jo = bo + jj * CX + i
                for ii in range(w):
                    occ[jo + ii] = k
        top = b + h
        if top < CY and vstuds_arr[vi]:
            bo = top * CZ * CX
            stud_cells_k.append(tuple(bo + (j + sj) * CX + (i + si) for si, sj in vstuds_arr[vi]))
        else:
            stud_cells_k.append(())
        objective += cg[c]
        alive_set.add(k)
        return k

    def remove(k: int) -> None:
        nonlocal objective
        p = pieces[k]
        p[1] = False
        c = p[0]
        vi = cv[c]
        a = ca[c]
        i = a % CX
        j = (a // CX) % CZ
        b = a // (CX * CZ)
        w, h, d = vw_arr[vi], vh_arr[vi], vd_arr[vi]
        for bb in range(b, b + h):
            bo = bb * CZ * CX
            for jj in range(j, j + d):
                jo = bo + jj * CX + i
                for ii in range(w):
                    occ[jo + ii] = -1
        objective -= cg[c]
        alive_set.discard(k)

    def revive(k: int) -> None:
        nonlocal objective
        p = pieces[k]
        p[1] = True
        c = p[0]
        vi = cv[c]
        a = ca[c]
        i = a % CX
        j = (a // CX) % CZ
        b = a // (CX * CZ)
        w, h, d = vw_arr[vi], vh_arr[vi], vd_arr[vi]
        for bb in range(b, b + h):
            bo = bb * CZ * CX
            for jj in range(j, j + d):
                jo = bo + jj * CX + i
                for ii in range(w):
                    occ[jo + ii] = k
        objective += cg[c]
        alive_set.add(k)

    # ---- 2. Core + 3. Greedy
    if n_cand:
        core_valid = np.flatnonzero(np.isfinite(cs_arr))
        if len(core_valid):
            core_order = core_valid[np.argsort(-cs_arr[core_valid], kind="mergesort")].tolist()
            for c in core_order:
                if is_free(c):
                    place(c)
        by_gain = np.argsort(-cg_arr, kind="mergesort").tolist()
        for c in by_gain:
            if is_free(c):
                place(c)
    else:
        by_gain = []

    # ---- Stud-graph connectivity helpers
    def uf_build():
        nonlocal uf_epoch
        need = len(pieces) + 8
        if len(uf_par) < need:
            ext = need - len(uf_par)
            uf_par.extend([0] * ext)
            uf_stamp.extend([0] * ext)
        uf_epoch += 1
        ep = uf_epoch
        par = uf_par
        st = uf_stamp
        cnt = len(alive_set)

        def find(k: int) -> int:
            if st[k] != ep:
                st[k] = ep
                par[k] = k
                return k
            while par[k] != k:
                par[k] = par[par[k]]
                k = par[k]
            return k

        def add_node(k: int) -> None:
            nonlocal cnt
            if k >= len(par):
                ext = k + 16 - len(par)
                par.extend([0] * ext)
                st.extend([0] * ext)
            st[k] = ep
            par[k] = k
            cnt += 1

        def union(a: int, b: int) -> None:
            nonlocal cnt
            ra, rb = find(a), find(b)
            if ra != rb:
                par[ra] = rb
                cnt -= 1

        for k in alive_set:
            if st[k] != ep:
                st[k] = ep
                par[k] = k
            for q in stud_cells_k[k]:
                u = occ[q]
                if u >= 0:
                    if st[u] != ep:
                        st[u] = ep
                        par[u] = u
                    x, y = u, k
                    while par[x] != x:
                        par[x] = par[par[x]]
                        x = par[x]
                    while par[y] != y:
                        par[y] = par[par[y]]
                        y = par[y]
                    if x != y:
                        par[x] = y
                        cnt -= 1
        return par, find, union, add_node, lambda: cnt

    def count_comps() -> int:
        if not alive_set:
            return 0
        _, _, _, _, get_cnt = uf_build()
        return get_cnt()

    def touching_roots(vi: int, i: int, j: int, b: int, find_fn) -> set[int]:
        roots: set[int] = set()
        w, h, d = vw_arr[vi], vh_arr[vi], vd_arr[vi]
        if b > 0:
            bo = (b - 1) * CZ * CX
            for jj in range(j, j + d):
                row = bo + jj * CX
                for ii in range(i, i + w):
                    u = occ[row + ii]
                    if u >= 0:
                        uc = pieces[u][0]
                        uvi = cv[uc]
                        ua = ca[uc]
                        ui = ua % CX
                        uj = (ua // CX) % CZ
                        if stud_masks[uvi][(jj - uj) * vw_arr[uvi] + (ii - ui)]:
                            roots.add(find_fn(u))
        top = b + h
        if top < CY:
            bo = top * CZ * CX
            for si, sj in vstuds_arr[vi]:
                u = occ[bo + (j + sj) * CX + (i + si)]
                if u >= 0:
                    roots.add(find_fn(u))
        return roots

    # ---- 4. Large-Neighborhood Search around surface cells
    surf = np.flatnonzero(mixed.reshape(-1)).tolist()
    # CSR candidates by anchor sorted descending by gain, deduplicating strictly dominated
    # (same anchor, same (w,h,d) footprint, same stud signature -> only highest cg can ever win)
    by_a_bins: list[list[tuple[int, int, int, int, int, float]]] = [[] for _ in range(NC)]
    seen_sig = [set() for _ in range(NC)]
    v_stud_sig = [tuple(sorted(v["studs"])) for v in variants]
    for c in by_gain:
        a = ca[c]
        vi = cv[c]
        sig = (vw_arr[vi], vh_arr[vi], vd_arr[vi], v_stud_sig[vi])
        if sig not in seen_sig[a]:
            seen_sig[a].add(sig)
            by_a_bins[a].append((c, vi, vw_arr[vi], vh_arr[vi], vd_arr[vi], cg[c]))
    del seen_sig

    # Pre-group per-anchor candidates by (w, h, d) so box occupancy runs once per shape
    by_a_groups: list[list[tuple[int, int, int, list[tuple[int, int, float]]]]] = [[] for _ in range(NC)]
    for a in range(NC):
        cands = by_a_bins[a]
        if not cands:
            continue
        grp_map: dict[tuple[int, int, int], list[tuple[int, int, float]]] = {}
        for c, vi, w, h, d, g in cands:
            grp_map.setdefault((w, h, d), []).append((c, vi, g))
        by_a_groups[a] = [(w, h, d, lst) for (w, h, d), lst in grp_map.items()]
    del by_a_bins

    max_w = max(vw_arr, default=1)
    max_d = max(vd_arr, default=1)
    max_h = max(vh_arr, default=1)
    max_span = max(max_w, max_d)

    n_lns = max(int(lns_iters), int(round(lns_passes * len(surf)))) if lns_passes > 0 else int(lns_iters)
    n_comp = count_comps() if connect > 0 else 0
    accepted = 0
    improved = 0
    rnd_fn = rng.random

    for it in range(n_lns):
        if not surf:
            break
        temp = noise * (1.0 - it / n_lns)
        q0 = surf[rng.randrange(len(surf))]
        i0 = q0 % CX
        j0 = (q0 // CX) % CZ
        b0 = q0 // (CX * CZ)

        gone: set[int] = set()
        r = lns_radius
        for bb in range(max(0, b0 - r), min(CY, b0 + r + 1)):
            bo = bb * CZ * CX
            for jj in range(max(0, j0 - r), min(CZ, j0 + r + 1)):
                ro = bo + jj * CX
                for ii in range(max(0, i0 - r), min(CX, i0 + r + 1)):
                    k = occ[ro + ii]
                    if k >= 0:
                        gone.add(k)
        if not gone:
            continue

        before = objective
        removed = list(gone)
        lo_i, lo_b, lo_j = i0 - r, b0 - r, j0 - r
        hi_i, hi_b, hi_j = i0 + r, b0 + r, j0 + r
        for k in removed:
            c = pieces[k][0]
            vi = cv[c]
            a = ca[c]
            ii = a % CX
            jj = (a // CX) % CZ
            bb = a // (CX * CZ)
            if ii < lo_i: lo_i = ii
            if bb < lo_b: lo_b = bb
            if jj < lo_j: lo_j = jj
            if ii + vw_arr[vi] - 1 > hi_i: hi_i = ii + vw_arr[vi] - 1
            if bb + vh_arr[vi] - 1 > hi_b: hi_b = bb + vh_arr[vi] - 1
            if jj + vd_arr[vi] - 1 > hi_j: hi_j = jj + vd_arr[vi] - 1
            remove(k)

        ia0, ia1 = max(0, lo_i - max_span + 1), min(CX - 1, hi_i)
        ba0, ba1 = max(0, lo_b - max_h + 1), min(CY - 1, hi_b)
        ja0, ja1 = max(0, lo_j - max_span + 1), min(CZ - 1, hi_j)

        opts = []
        cz_stride = CX * CZ
        for bb in range(ba0, ba1 + 1):
            for jj in range(ja0, ja1 + 1):
                ro = (bb * CZ + jj) * CX
                for ii in range(ia0, ia1 + 1):
                    a = ro + ii
                    groups = by_a_groups[a]
                    if not groups or occ[a] >= 0:
                        continue
                    rx = 1
                    while ii + rx < CX and rx < max_span and occ[a + rx] < 0:
                        rx += 1
                    rz = 1
                    while jj + rz < CZ and rz < max_span and occ[a + rz * CX] < 0:
                        rz += 1
                    ry = 1
                    while bb + ry < CY and ry < max_h and occ[a + ry * cz_stride] < 0:
                        ry += 1
                    for w, h, d, lst in groups:
                        if w > rx or h > ry or d > rz:
                            continue
                        if (w > 1) + (h > 1) + (d > 1) >= 2:
                            blocked = False
                            for b2 in range(bb, bb + h):
                                bo2 = b2 * cz_stride
                                for j2 in range(jj, jj + d):
                                    ro2 = bo2 + j2 * CX + ii
                                    for i2 in range(w):
                                        if occ[ro2 + i2] >= 0:
                                            blocked = True
                                            break
                                    if blocked:
                                        break
                                if blocked:
                                    break
                            if blocked:
                                continue
                        i1, b1, j1 = ii + w, bb + h, jj + d
                        if temp > 0.0:
                            for c, vi, g in lst:
                                opts.append((-g * (1.0 + temp * (rnd_fn() * 2.0 - 1.0)), c, vi, ii, bb, jj, i1, b1, j1))
                        else:
                            for c, vi, g in lst:
                                opts.append((-g, c, vi, ii, bb, jj, i1, b1, j1))

        opts.sort()
        added_k: list[int] = []
        add_boxes: list[tuple[int, int, int, int, int, int]] = []

        if connect > 0:
            par, find_uf, union_uf, add_node, get_nc = uf_build()
            for _, c, vi, ii, bb, jj, i1, b1, j1 in opts:
                conflict = False
                for ai, ab, aj, ai1, ab1, aj1 in add_boxes:
                    if ii < ai1 and ai < i1 and bb < ab1 and ab < b1 and jj < aj1 and aj < j1:
                        conflict = True
                        break
                if conflict:
                    continue
                roots = touching_roots(vi, ii, jj, bb, find_uf)
                if not roots and cg[c] <= connect and alive_set:
                    continue
                k = place(c)
                added_k.append(k)
                add_boxes.append((ii, bb, jj, i1, b1, j1))
                add_node(k)
                for r_id in roots:
                    union_uf(r_id, k)
            nc = get_nc()
        else:
            for _, c, _, ii, bb, jj, i1, b1, j1 in opts:
                conflict = False
                for ai, ab, aj, ai1, ab1, aj1 in add_boxes:
                    if ii < ai1 and ai < i1 and bb < ab1 and ab < b1 and jj < aj1 and aj < j1:
                        conflict = True
                        break
                if not conflict:
                    added_k.append(place(c))
                    add_boxes.append((ii, bb, jj, i1, b1, j1))
            nc = n_comp

        delta = objective - before
        if connect > 0:
            delta -= connect * (max(0, nc - 1) - max(0, n_comp - 1))
        if delta >= -1e-9:
            accepted += 1
            if delta > 1e-6:
                improved += 1
            n_comp = nc
        else:
            for k in added_k:
                remove(k)
            for k in removed:
                revive(k)

    # ---- 5. Bridges between disconnected stud components
    bridges = 0
    bridge_cost = 0.0
    pruned = 0
    pruned_gain = 0.0
    if bridge_flag > 0 and alive_set:
        for _ in range(400):
            _, find_uf, _, _, _ = uf_build()
            val: dict[int, float] = {}
            members: dict[int, list[int]] = {}
            for k in alive_set:
                r_id = find_uf(k)
                val[r_id] = val.get(r_id, 0.0) + cg[pieces[k][0]]
                members.setdefault(r_id, []).append(k)
            if len(val) <= 1:
                break
            main = max(val.items(), key=lambda kv: kv[1])[0]
            seen: set[int] = set()
            best = None

            def try_at(vi: int, ii: int, jj: int, bb: int) -> None:
                nonlocal best
                w, h, d = vw_arr[vi], vh_arr[vi], vd_arr[vi]
                if ii < 0 or jj < 0 or bb < 0 or ii + w > CX or jj + d > CZ or bb + h > CY:
                    return
                key = vi * NC + cell_idx(ii, bb, jj)
                if key in seen:
                    return
                seen.add(key)
                for b2 in range(bb, bb + h):
                    bo = b2 * CZ * CX
                    for j2 in range(jj, jj + d):
                        ro = bo + j2 * CX + ii
                        for i2 in range(w):
                            if occ[ro + i2] >= 0:
                                return
                roots = touching_roots(vi, ii, jj, bb, find_uf)
                if len(roots) < 2:
                    return
                g = _gain_at(variants[vi], ii, jj, bb, w_flat, X, Z, ox, oz, sat_c) - lam
                cost = -g / (len(roots) - 1)
                if -g > bridge_max:
                    return
                if best is None or cost < best[0]:
                    best = (cost, vi, ii, jj, bb, g)

            for r_id, ks in members.items():
                if r_id == main:
                    continue
                for k in ks:
                    c = pieces[k][0]
                    vi = cv[c]
                    a = ca[c]
                    ii = a % CX
                    jj = (a // CX) % CZ
                    bb = a // (CX * CZ)
                    top = bb + vh_arr[vi]
                    for u_vi, _ in enumerate(variants):
                        uw, uh, ud = vw_arr[u_vi], vh_arr[u_vi], vd_arr[u_vi]
                        for si, sj in vstuds_arr[vi]:
                            for dj in range(ud):
                                for di in range(uw):
                                    try_at(u_vi, ii + si - di, jj + sj - dj, top)
                        for si, sj in vstuds_arr[u_vi]:
                            for dj in range(vd_arr[vi]):
                                for di in range(vw_arr[vi]):
                                    try_at(u_vi, ii + di - si, jj + dj - sj, bb - uh)

            drop = None
            for r_id, x in val.items():
                if r_id != main and x < connect and (drop is None or x < drop[1]):
                    drop = (r_id, x)
            if drop is not None and (best is None or drop[1] < best[0]):
                for k in members[drop[0]]:
                    remove(k)
                pruned += len(members[drop[0]])
                pruned_gain += drop[1]
                continue
            if best is None:
                break
            _, b_vi, bi, bj, bb, bg = best
            cv.append(b_vi)
            ca.append(cell_idx(bi, bb, bj))
            cg.append(bg)
            place(len(cv) - 1)
            bridges += 1
            bridge_cost += -bg

    # ---- 6. Guarantee zero floating pieces / single stud-connected component
    if connect > 0 and enforce_single and alive_set:
        _, find_uf, _, _, _ = uf_build()
        val = {}
        members = {}
        min_b: dict[int, int] = {}
        for k in alive_set:
            r_id = find_uf(k)
            b = ca[pieces[k][0]] // (CX * CZ)
            val[r_id] = val.get(r_id, 0.0) + cg[pieces[k][0]]
            min_b[r_id] = min(min_b.get(r_id, 1 << 30), b)
            members.setdefault(r_id, []).append(k)
        if len(val) > 1:
            global_min_b = min(min_b.values())
            main = max(
                val.keys(),
                key=lambda r_id: (1 if min_b[r_id] == global_min_b else 0, val[r_id]),
            )
            for r_id, ks in members.items():
                if r_id != main:
                    for k in ks:
                        remove(k)
                    pruned += len(ks)
                    pruned_gain += val[r_id]

    out = []
    for k in sorted(alive_set):
        c = pieces[k][0]
        vi = cv[c]
        v = variants[vi]
        a = ca[c]
        out.append({
            "id": v["id"],
            "kind": v["kind"],
            "rot": v["rot"],
            "w": v["w"],
            "d": v["d"],
            "h": v["h"],
            "i": a % CX,
            "j": (a // CX) % CZ,
            "b": a // (CX * CZ),
            "studs": v["studs"],
            "gain": round(cg[c] + lam, 2),
        })

    return {
        "pieces": out,
        "phase": phase,
        "stats": {
            "candidates": n_cand,
            "surfaceCells": len(surf),
            "lnsIters": n_lns,
            "lnsAccepted": accepted,
            "lnsImproved": improved,
            "components": count_comps(),
            "bridges": bridges,
            "bridgeCost": round(bridge_cost, 1),
            "pruned": pruned,
            "prunedGain": round(pruned_gain, 1),
        },
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
    seed: int = 1,
) -> dict[str, Any]:
    """Dinkelbach Soft-IoU outer loop + full-budget refinement matching JS solver."""
    rng = random.Random(seed)
    lam = float(policy.get("lambda", 8.5877))
    full_iters = int(policy.get("lnsIters", 3000))
    full_passes = float(policy.get("lnsPasses", 6))
    short_iters = min(full_iters, int(theta_lns))
    short_passes = full_passes / 8.0 if full_passes > 0 else 0.0

    theta = 0.5
    best_theta = theta
    best_iou = -1.0
    best_r = None
    trace = []

    for it in range(theta_iters):
        ph = list(phase) if phase is not None else _choose_phase(T, F[0], lam, theta)
        r = _solve_once(T, F, variants, policy, theta, ph, rng, short_iters, short_passes)
        m = fidelity(r["pieces"], by_key, T, ph)
        iou = float(m["softIoU"])
        trace.append({"it": it, "theta": round(theta, 4), "iou": round(iou, 4), "pieces": m["pieces"], "components": m["components"]})
        if best_r is None or iou > best_iou:
            best_iou = iou
            best_theta = theta
            best_r = r
        next_theta = iou / (1.0 + iou) if iou > 0 else 0.5
        if abs(next_theta - theta) < 0.005:
            break
        theta = next_theta

    ph_fin = list(phase) if phase is not None else _choose_phase(T, F[0], lam, best_theta)
    r_fin = _solve_once(T, F, variants, policy, best_theta, ph_fin, rng, full_iters, full_passes)
    m_fin = fidelity(r_fin["pieces"], by_key, T, ph_fin)
    iou_fin = float(m_fin["softIoU"])
    trace.append({"it": "final", "theta": round(best_theta, 4), "iou": round(iou_fin, 4), "pieces": m_fin["pieces"], "components": m_fin["components"]})
    if best_r is None or iou_fin >= best_iou:
        best_r = r_fin
        best_iou = iou_fin

    return {"r": best_r, "theta": best_iou, "trace": trace}
