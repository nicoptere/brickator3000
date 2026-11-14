"""Target SDF Volume Encoder/Decoder, Barnes-Hut GWN, Closest-Point Field & Thin Opening."""

from __future__ import annotations

import json
import math
import time
from pathlib import Path
from typing import Any

import numpy as np
from scipy.ndimage import gaussian_filter

from .units import H, PLATE, STUD, SX, SY


def bounds(tris: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    pts = tris.reshape(-1, 3)
    return pts.min(axis=0).astype(np.float64), pts.max(axis=0).astype(np.float64)


def lattice_fit(
    tris: np.ndarray,
    s0: float,
    lo: np.ndarray,
    tol: float = 0.05,
    steps: int = 100,
    min_gain: float = 0.1,
) -> dict[str, Any]:
    """Snap scale and X/Z shifts onto LEGO stud/plate boundaries for planar faces."""
    A, B, C = tris[:, 0].astype(np.float64), tris[:, 1].astype(np.float64), tris[:, 2].astype(np.float64)
    n = np.cross(B - A, C - A)
    area2 = np.linalg.norm(n, axis=1)
    cent = (A + B + C) / 3.0 - lo[None, :]
    valid = area2 > 0
    n, area2, cent = n[valid], area2[valid], cent[valid]

    faces = []
    for ax in range(3):
        mask = np.abs(n[:, ax]) / area2 >= 0.9
        faces.append((cent[mask, ax], area2[mask]))

    periods = (float(STUD), float(PLATE), float(STUD))

    def resultant(ax: int, s: float) -> tuple[float, float]:
        pos, wt = faces[ax]
        if len(pos) == 0:
            return 0.0, 0.0
        tot = float(np.sum(wt))
        ang = 2.0 * math.pi * s * pos / periods[ax]
        c_sum = float(np.sum(wt * np.cos(ang)))
        s_sum = float(np.sum(wt * np.sin(ang)))
        return math.hypot(c_sum, s_sum) / tot, (math.atan2(s_sum, c_sum) / (2.0 * math.pi)) * periods[ax]

    def score_at(s: float):
        rx, px = resultant(0, s)
        rz, pz = resultant(2, s)
        pos_y, wt_y = faces[1]
        if len(pos_y):
            cy = float(np.sum(wt_y * np.cos(2.0 * math.pi * s * pos_y / float(PLATE)))) / float(np.sum(wt_y))
        else:
            cy = 0.0
        return s, rx + rz + cy, px, pz

    base = score_at(s0)
    best = base
    for k in range(steps + 1):
        cand = score_at(s0 * (1.0 - tol + 2.0 * tol * k / steps))
        if cand[1] > best[1]:
            best = cand
    if best[1] - base[1] < min_gain:
        best = base

    def shift_of(ph: float) -> float:
        p = ph % float(STUD)
        return -p if p < STUD * 0.5 else float(STUD) - p

    return {"s": float(best[0]), "s0": float(s0), "shift": [shift_of(best[2]), shift_of(best[3])]}


def frame_for(model: dict[str, Any], studs: int, ref: str = "min3", grid_align: bool = True, margin: float = 1.0) -> dict[str, Any]:
    lo, hi = bounds(model["tris"])
    ext = hi - lo
    denom = float(min(ext)) if ref == "min3" else float(max(ext[0], ext[2]))
    denom = max(1e-6, denom)
    s0 = (studs * STUD) / denom
    fit = lattice_fit(model["tris"], s0, lo, 0.05, 100, 0.15) if grid_align else {"s": s0, "shift": [0.0, 0.0]}
    s = fit["s"]
    t = [
        float(-lo[0] * s + margin * STUD + fit["shift"][0]),
        float(-lo[1] * s),
        float(-lo[2] * s + margin * STUD + fit["shift"][1]),
    ]
    return {"k": s, "t": t, "s0": float(s0), "studs": studs, "lo": lo.tolist(), "hi": hi.tolist()}


def _point_tris_d2_chunked(pts: np.ndarray, tris: np.ndarray) -> np.ndarray:
    """Vectorized exact point-to-triangle squared distance for M points against K triangles -> (M,)."""
    A = tris[:, 0][None, :, :]  # (1, K, 3)
    B = tris[:, 1][None, :, :]
    C = tris[:, 2][None, :, :]
    P = pts[:, None, :]         # (M, 1, 3)

    AB = B - A
    AC = C - A
    AP = P - A
    d1 = np.einsum("mkj,mkj->mk", AB, AP)
    d2 = np.einsum("mkj,mkj->mk", AC, AP)
    BP = P - B
    d3 = np.einsum("mkj,mkj->mk", AB, BP)
    d4 = np.einsum("mkj,mkj->mk", AC, BP)
    CP = P - C
    d5 = np.einsum("mkj,mkj->mk", AB, CP)
    d6 = np.einsum("mkj,mkj->mk", AC, CP)

    vc = d1 * d4 - d3 * d2
    vb = d5 * d2 - d1 * d6
    va = d3 * d6 - d5 * d4

    # General interior projection + 3 edge + 3 vertex regions
    den = np.where((va + vb + vc) != 0, 1.0 / (va + vb + vc), 0.0)
    v = vb * den
    w = vc * den
    u = 1.0 - v - w

    m1 = (d1 <= 0) & (d2 <= 0)
    u = np.where(m1, 1.0, u); v = np.where(m1, 0.0, v); w = np.where(m1, 0.0, w)

    m2 = (~m1) & (d3 >= 0) & (d4 <= d3)
    u = np.where(m2, 0.0, u); v = np.where(m2, 1.0, v); w = np.where(m2, 0.0, w)

    m3 = (~m1) & (~m2) & (vc <= 0) & (d1 >= 0) & (d3 <= 0)
    vv3 = np.where((d1 - d3) != 0, d1 / (d1 - d3), 0.0)
    u = np.where(m3, 1.0 - vv3, u); v = np.where(m3, vv3, v); w = np.where(m3, 0.0, w)

    m4 = (~m1) & (~m2) & (~m3) & (d6 >= 0) & (d5 <= d6)
    u = np.where(m4, 0.0, u); v = np.where(m4, 0.0, v); w = np.where(m4, 1.0, w)

    m5 = (~m1) & (~m2) & (~m3) & (~m4) & (vb <= 0) & (d2 >= 0) & (d6 <= 0)
    ww5 = np.where((d2 - d6) != 0, d2 / (d2 - d6), 0.0)
    u = np.where(m5, 1.0 - ww5, u); v = np.where(m5, 0.0, v); w = np.where(m5, ww5, w)

    m6 = (~m1) & (~m2) & (~m3) & (~m4) & (~m5) & (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
    ww6 = np.where(((d4 - d3) + (d5 - d6)) != 0, (d4 - d3) / ((d4 - d3) + (d5 - d6)), 0.0)
    u = np.where(m6, 0.0, u); v = np.where(m6, 1.0 - ww6, v); w = np.where(m6, ww6, w)

    closest = u[:, :, None] * A + v[:, :, None] * B + w[:, :, None] * C
    diff = closest - P
    d2_all = np.einsum("mkj,mkj->mk", diff, diff)
    return np.min(d2_all, axis=1)


def _solid_angle_chunked(pts: np.ndarray, tris: np.ndarray) -> np.ndarray:
    """Exact Van Oosterom & Strackee winding number per query point across `tris`."""
    # Shape: (M, K, 3)
    a = tris[:, 0][None, :, :] - pts[:, None, :]
    b = tris[:, 1][None, :, :] - pts[:, None, :]
    c = tris[:, 2][None, :, :] - pts[:, None, :]
    la = np.linalg.norm(a, axis=2)
    lb = np.linalg.norm(b, axis=2)
    lc = np.linalg.norm(c, axis=2)
    det = np.einsum("mkj,mkj->mk", a, np.cross(b, c))
    den = (
        la * lb * lc
        + np.einsum("mkj,mkj->mk", a, b) * lc
        + np.einsum("mkj,mkj->mk", b, c) * la
        + np.einsum("mkj,mkj->mk", c, a) * lb
    )
    omega = 2.0 * np.arctan2(det, den)
    return np.sum(omega, axis=1) / (4.0 * math.pi)


class SpatialMeshQuery:
    """
    Fast vectorized spatial bin + Barnes-Hut cluster accelerator for winding numbers
    and exact closest-triangle unsigned distances in pure NumPy.
    """

    def __init__(self, tris: np.ndarray, g_bins: int = 16):
        self.tris = np.ascontiguousarray(tris, dtype=np.float64)
        self.nt = len(self.tris)
        pts = self.tris.reshape(-1, 3)
        self.lo = pts.min(axis=0)
        self.hi = pts.max(axis=0)
        self.ext = np.maximum(1e-6, self.hi - self.lo)

        # Build spatial clusters for Barnes-Hut winding evaluation
        centroids = self.tris.mean(axis=1)
        bx = np.clip(((centroids[:, 0] - self.lo[0]) / self.ext[0] * g_bins).astype(np.int32), 0, g_bins - 1)
        by = np.clip(((centroids[:, 1] - self.lo[1]) / self.ext[1] * g_bins).astype(np.int32), 0, g_bins - 1)
        bz = np.clip(((centroids[:, 2] - self.lo[2]) / self.ext[2] * g_bins).astype(np.int32), 0, g_bins - 1)
        cell_id = (by * g_bins + bz) * g_bins + bx

        order = np.argsort(cell_id)
        sorted_cells = cell_id[order]
        uniq, starts, counts = np.unique(sorted_cells, return_index=True, return_counts=True)

        A, B, C = self.tris[:, 0], self.tris[:, 1], self.tris[:, 2]
        area_vec = 0.5 * np.cross(B - A, C - A)  # signed outward area vector

        self.clusters = []
        for s, cnt in zip(starts, counts):
            ids = order[s : s + cnt]
            ctris = self.tris[ids]
            cpts = ctris.reshape(-1, 3)
            clo = cpts.min(axis=0)
            chi = cpts.max(axis=0)
            center = 0.5 * (clo + chi)
            radius = float(0.5 * np.linalg.norm(chi - clo))
            n_sum = np.sum(area_vec[ids], axis=0)
            self.clusters.append({
                "tris": ctris,
                "lo": clo,
                "hi": chi,
                "center": center,
                "radius": radius,
                "area_vec": n_sum,
            })

        self.c_centers = np.asarray([c["center"] for c in self.clusters], dtype=np.float64)
        self.c_radii = np.asarray([c["radius"] for c in self.clusters], dtype=np.float64)
        self.c_nvec = np.asarray([c["area_vec"] for c in self.clusters], dtype=np.float64)
        self.c_lo = np.asarray([c["lo"] for c in self.clusters], dtype=np.float64)
        self.c_hi = np.asarray([c["hi"] for c in self.clusters], dtype=np.float64)

    def winding(self, pts: np.ndarray, beta: float = 1.6, batch_size: int = 512) -> np.ndarray:
        """Barnes-Hut Generalized Winding Number at N x 3 points."""
        pts = np.asarray(pts, dtype=np.float64)
        n = len(pts)
        out = np.zeros(n, dtype=np.float64)
        if n == 0 or not self.clusters:
            return out

        for s in range(0, n, batch_size):
            q = pts[s : s + batch_size]
            diff = self.c_centers[None, :, :] - q[:, None, :]  # (B, M, 3)
            dist = np.linalg.norm(diff, axis=2) + 1e-12
            near_mask = dist < beta * self.c_radii[None, :]
            far_mask = ~near_mask
            # Multipole approximation for well-separated clusters
            dot_n = np.einsum("bmj,mj->bm", diff, self.c_nvec)
            dip = np.where(far_mask, dot_n / (4.0 * math.pi * (dist**3)), 0.0)
            w_batch = np.sum(dip, axis=1)

            # Exact Van Oosterom & Strackee solid angle for near clusters
            for m, cl in enumerate(self.clusters):
                rows = np.flatnonzero(near_mask[:, m])
                if len(rows):
                    ct = cl["tris"]
                    # Sub-chunk triangles if large cluster
                    for ts in range(0, len(ct), 128):
                        w_batch[rows] += _solid_angle_chunked(q[rows], ct[ts : ts + 128])
            out[s : s + batch_size] = w_batch
        return out

    def nearest_d2(self, pts: np.ndarray, bound2: float = float("inf"), batch_size: int = 256) -> np.ndarray:
        """Exact closest squared distance from N x 3 points using cluster AABB culling."""
        pts = np.asarray(pts, dtype=np.float64)
        n = len(pts)
        out = np.full(n, bound2, dtype=np.float64)
        if n == 0 or not self.clusters:
            return out

        for s in range(0, n, batch_size):
            q = pts[s : s + batch_size]
            # Point-to-cluster-AABB squared distance (B, M)
            dx = np.maximum(np.maximum(self.c_lo[None, :, 0] - q[:, None, 0], 0.0), q[:, None, 0] - self.c_hi[None, :, 0])
            dy = np.maximum(np.maximum(self.c_lo[None, :, 1] - q[:, None, 1], 0.0), q[:, None, 1] - self.c_hi[None, :, 1])
            dz = np.maximum(np.maximum(self.c_lo[None, :, 2] - q[:, None, 2], 0.0), q[:, None, 2] - self.c_hi[None, :, 2])
            box_d2 = dx * dx + dy * dy + dz * dz
            best = np.full(len(q), bound2, dtype=np.float64)

            # Visit clusters roughly sorted by minimum box distance across batch
            order_m = np.argsort(np.min(box_d2, axis=0))
            for m in order_m:
                active = np.flatnonzero(box_d2[:, m] < best)
                if len(active) == 0:
                    continue
                ct = self.clusters[m]["tris"]
                sub_pts = q[active]
                d2_min = best[active]
                for ts in range(0, len(ct), 128):
                    d2_c = _point_tris_d2_chunked(sub_pts, ct[ts : ts + 128])
                    d2_min = np.minimum(d2_min, d2_c)
                best[active] = d2_min
            out[s : s + batch_size] = best
        return out


def target_field(model: dict[str, Any], frame: dict[str, Any]) -> dict[str, Any]:
    """Evaluate exact 4-LDU sub-voxel coverage field and surface band from a mesh."""
    t0 = time.perf_counter()
    tris = model["tris"].astype(np.float64) * frame["k"] + np.asarray(frame["t"], dtype=np.float64)[None, None, :]
    pts = tris.reshape(-1, 3)
    hx, hy, hz = float(np.max(pts[:, 0])), float(np.max(pts[:, 1])), float(np.max(pts[:, 2]))
    CX, CY, CZ = int(math.ceil(hx / STUD)) + 2, int(math.ceil(hy / PLATE)) + 2, int(math.ceil(hz / STUD)) + 2
    X, Y, Z = CX * SX + SX - 1, CY * SY, CZ * SX + SX - 1

    near = np.zeros((Y, Z, X), dtype=bool)
    tlo = np.min(tris, axis=1)
    thi = np.max(tris, axis=1)
    x0 = np.clip(np.floor(tlo[:, 0] / H).astype(np.int32) - 1, 0, X - 1)
    x1 = np.clip(np.floor(thi[:, 0] / H).astype(np.int32) + 1, 0, X - 1)
    y0 = np.clip(np.floor(tlo[:, 1] / H).astype(np.int32) - 1, 0, Y - 1)
    y1 = np.clip(np.floor(thi[:, 1] / H).astype(np.int32) + 1, 0, Y - 1)
    z0 = np.clip(np.floor(tlo[:, 2] / H).astype(np.int32) - 1, 0, Z - 1)
    z1 = np.clip(np.floor(thi[:, 2] / H).astype(np.int32) + 1, 0, Z - 1)
    for f in range(len(tris)):
        near[y0[f] : y1[f] + 1, z0[f] : z1[f] + 1, x0[f] : x1[f] + 1] = True

    smq = SpatialMeshQuery(tris)

    # Interior GWN on 3x coarse lattice + trilinear expansion
    gx = np.arange(0, X, 3)
    gy = np.arange(0, Y, 3)
    gz = np.arange(0, Z, 3)
    # Include right edge to guarantee coverage
    if gx[-1] != X - 1:
        gx = np.append(gx, X - 1)
    if gy[-1] != Y - 1:
        gy = np.append(gy, Y - 1)
    if gz[-1] != Z - 1:
        gz = np.append(gz, Z - 1)

    grid_coords = np.stack(np.meshgrid((gy + 0.5) * H, (gz + 0.5) * H, (gx + 0.5) * H, indexing="ij"), axis=-1)
    # Switch ordering to (x, y, z)
    q_lat = np.stack([grid_coords[..., 2], grid_coords[..., 0], grid_coords[..., 1]], axis=-1).reshape(-1, 3)
    w_lat = smq.winding(q_lat, beta=1.5).reshape(len(gy), len(gz), len(gx))

    # Trilinearly interpolate lattice winding onto full grid
    from scipy.interpolate import RegularGridInterpolator
    interp = RegularGridInterpolator(((gy + 0.5) * H, (gz + 0.5) * H, (gx + 0.5) * H), w_lat, bounds_error=False, fill_value=0.0)
    ys_f, zs_f, xs_f = np.meshgrid((np.arange(Y) + 0.5) * H, (np.arange(Z) + 0.5) * H, (np.arange(X) + 0.5) * H, indexing="ij")

    far_mask = ~near
    t_vol = np.zeros((Y, Z, X), dtype=np.float32)
    if np.any(far_mask):
        far_pts = np.stack([ys_f[far_mask], zs_f[far_mask], xs_f[far_mask]], axis=-1)
        t_vol[far_mask] = (interp(far_pts) > 0.5).astype(np.float32)

    # Exact closest distance + exact GWN inside narrow surface band
    ny_i, nz_i, nx_i = np.nonzero(near)
    band = np.zeros((Y, Z, X), dtype=np.uint8)
    if len(nx_i):
        npts = np.stack([(nx_i + 0.5) * H, (ny_i + 0.5) * H, (nz_i + 0.5) * H], axis=-1)
        d2 = smq.nearest_d2(npts, bound2=4.0 * H * H)
        wn = smq.winding(npts, beta=2.0)
        d = np.sqrt(np.maximum(0.0, d2))
        phi = np.where(wn > 0.5, -d, d)
        t_vol[ny_i, nz_i, nx_i] = np.clip(0.5 - phi / H, 0.0, 1.0).astype(np.float32)
        touch2 = 3.0 * (H * 0.5) ** 2
        touch = d2 <= touch2
        band[ny_i[touch], nz_i[touch], nx_i[touch]] = 1

    ms = int(round((time.perf_counter() - t0) * 1000))
    return {
        "t": t_vol.reshape(-1),
        "band": band.reshape(-1),
        "X": X, "Y": Y, "Z": Z,
        "cells": [CX, CY, CZ],
        "frame": frame,
        "ms": ms,
    }


def thicken_thin(T: dict[str, Any]) -> dict[str, Any]:
    """Morphologically thicken surface sheets < 1 sub-voxel thick and select optimal stud grid phase."""
    X, Y, Z = T["X"], T["Y"], T["Z"]
    t = T["t"].reshape(Y, Z, X).copy()
    band = T["band"].reshape(Y, Z, X)
    # Count phase support over sub-voxel mod SX
    xs = np.arange(X - (SX - 1))
    zs = np.arange(Z - (SX - 1))
    best_ox, best_oz, best_score = 0, 0, -1.0
    sub_mask = (t > 0.0) | (band > 0)
    for ox in range(SX):
        for oz in range(SX):
            # Columns aligned at multiples of SX starting at ox, oz
            gx = np.arange(ox, X, SX)
            gz = np.arange(oz, Z, SX)
            sc = float(np.sum(t[:, :, gx][:, gz, :]))
            if sc > best_score:
                best_score = sc
                best_ox, best_oz = ox, oz

    thin_mask = (band > 0) & (t < 0.5) & (t > 0.01)
    added = int(np.sum(thin_mask))
    if added:
        t[thin_mask] = 0.55
    return {
        "t": t.reshape(-1),
        "phase": [best_ox, best_oz],
        "features": int(np.sum(band > 0)),
        "thin": added,
        "added": added,
    }


def gaussian_octaves(T: dict[str, Any], sigmas: tuple[float, ...] = (0.0, 1.5, 3.0, 6.0), core_octave: int = 1) -> list[np.ndarray | None]:
    X, Y, Z = T["X"], T["Y"], T["Z"]
    vol = T["t"].reshape(Y, Z, X)
    out: list[np.ndarray | None] = []
    for idx, sig in enumerate(sigmas):
        if idx == 0:
            out.append(T["t"])
        elif idx == core_octave:
            out.append(gaussian_filter(vol, sigma=float(sig), mode="constant", cval=0.0).reshape(-1).astype(np.float32))
        else:
            out.append(None)
    return out


def encode_sdf_volume(
    model: dict[str, Any],
    res: int = 64,
    pad_voxels: int = 3,
    method: str = "exact",
    siren_steps: int = 1200,
) -> tuple[dict[str, Any], np.ndarray]:
    """Encode a mesh into a continuous 3D SDF grid (`.sdf.json` + `.sdf.bin`)."""
    t0 = time.perf_counter()
    tris = model["tris"].astype(np.float64)
    lo, hi = bounds(tris)
    ext = np.maximum(1e-6, hi - lo)
    step = float(np.max(ext)) / max(4, res - 2 * pad_voxels)
    origin = (lo - pad_voxels * step).tolist()
    nx = int(math.ceil((ext[0] + 2 * pad_voxels * step) / step)) + 1
    ny = int(math.ceil((ext[1] + 2 * pad_voxels * step) / step)) + 1
    nz = int(math.ceil((ext[2] + 2 * pad_voxels * step) / step)) + 1

    xs = origin[0] + np.arange(nx) * step
    ys = origin[1] + np.arange(ny) * step
    zs = origin[2] + np.arange(nz) * step
    # Layout data[(k * ny + j) * nx + i] -> meshgrid(zs, ys, xs, indexing="ij")
    gz, gy, gx = np.meshgrid(zs, ys, xs, indexing="ij")
    pts = np.stack([gx, gy, gz], axis=-1).reshape(-1, 3)

    smq = SpatialMeshQuery(tris)
    d2 = smq.nearest_d2(pts)
    wn = smq.winding(pts, beta=2.0)
    d = np.sqrt(np.maximum(0.0, d2))
    exact_sdf = np.where(wn > 0.5, -d, d).astype(np.float32)

    sdf_out = exact_sdf
    backend_used = "NumPy-BH"

    if method == "siren":
        try:
            import torch
            import torch.nn as nn
            device = "cuda" if torch.cuda.is_available() else "cpu"
            center = 0.5 * (lo + hi)
            half = max(1e-6, 0.5 * float(np.max(ext)))
            p_norm = ((pts - center) / half).astype(np.float32)
            y_norm = (exact_sdf / half).astype(np.float32)

            class SineLayer(nn.Module):
                def __init__(self, inf: int, outf: int, w0: float = 30.0, is_first: bool = False):
                    super().__init__()
                    self.w0 = w0
                    self.lin = nn.Linear(inf, outf)
                    with torch.no_grad():
                        bound = 1.0 / inf if is_first else math.sqrt(6.0 / inf) / w0
                        self.lin.weight.uniform_(-bound, bound)

                def forward(self, x):
                    return torch.sin(self.w0 * self.lin(x))

            net = nn.Sequential(
                SineLayer(3, 64, 18.0, True),
                SineLayer(64, 64, 18.0, False),
                SineLayer(64, 64, 18.0, False),
                nn.Linear(64, 1),
            ).to(device)
            opt = torch.optim.Adam(net.parameters(), lr=1e-3)
            xt = torch.from_numpy(p_norm).to(device)
            yt = torch.from_numpy(y_norm[:, None]).to(device)
            bs = min(4096, len(p_norm))
            for _ in range(siren_steps):
                idx = torch.randint(0, len(p_norm), (bs,), device=device)
                pred = net(xt[idx])
                loss = torch.mean((pred - yt[idx]) ** 2)
                opt.zero_grad()
                loss.backward()
                opt.step()
            with torch.no_grad():
                preds = []
                for s in range(0, len(p_norm), 16384):
                    preds.append(net(xt[s : s + 16384]).cpu().numpy().reshape(-1))
                sdf_out = (np.concatenate(preds) * half).astype(np.float32)
            backend_used = f"PyTorch-SIREN ({device})"
        except ImportError as exc:
            raise RuntimeError("SIREN encoding requested (`--method siren`) requires PyTorch (`pip install torch`).") from exc

    hdr = {
        "format": "brickpack-sdf-v1",
        "nx": nx,
        "ny": ny,
        "nz": nz,
        "origin": origin,
        "step": step,
        "bounds": {"lo": lo.tolist(), "hi": hi.tolist()},
        "hasColor": bool(model.get("has_color", False)),
        "ms": int(round((time.perf_counter() - t0) * 1000)),
        "compute": backend_used,
    }
    return hdr, sdf_out


def save_sdf(hdr: dict[str, Any], data: np.ndarray, out_json: str | Path) -> tuple[Path, Path]:
    jp = Path(out_json)
    jp.parent.mkdir(parents=True, exist_ok=True)
    bp = Path(str(jp).removesuffix(".sdf.json").removesuffix(".json") + ".sdf.bin")
    hdr_copy = {**hdr, "binFile": bp.name}
    jp.write_text(json.dumps(hdr_copy, indent=2), encoding="utf-8")
    bp.write_bytes(np.ascontiguousarray(data, dtype=np.float32).tobytes())
    return jp, bp


def load_sdf(json_path: str | Path) -> tuple[dict[str, Any], np.ndarray]:
    jp = Path(json_path)
    hdr = json.loads(jp.read_text(encoding="utf-8"))
    bp = jp.parent / hdr.get("binFile", jp.name.replace(".sdf.json", ".sdf.bin"))
    data = np.frombuffer(bp.read_bytes(), dtype=np.float32).copy()
    return hdr, data


def target_from_sdf_volume(hdr: dict[str, Any], data: np.ndarray, studs: int = 16, ref: str = "min3", margin: float = 1.0) -> dict[str, Any]:
    nx, ny, nz = int(hdr["nx"]), int(hdr["ny"]), int(hdr["nz"])
    origin = np.asarray(hdr["origin"], dtype=np.float64)
    step = float(hdr["step"])
    b = hdr.get("bounds", {})
    lo = np.asarray(b.get("lo", origin), dtype=np.float64)
    hi = np.asarray(b.get("hi", origin + np.array([nx - 1, ny - 1, nz - 1]) * step), dtype=np.float64)
    ext = hi - lo
    denom = max(1e-6, float(min(ext)) if ref == "min3" else float(max(ext[0], ext[2])))
    s = (studs * STUD) / denom
    frame = {
        "k": s,
        "t": [float(-lo[0] * s + margin * STUD), float(-lo[1] * s), float(-lo[2] * s + margin * STUD)],
        "s0": s,
        "studs": studs,
        "lo": lo.tolist(),
        "hi": hi.tolist(),
    }
    hx, hy, hz = ext[0] * s + 2 * margin * STUD, ext[1] * s, ext[2] * s + 2 * margin * STUD
    CX, CY, CZ = int(math.ceil(hx / STUD)) + 2, int(math.ceil(hy / PLATE)) + 2, int(math.ceil(hz / STUD)) + 2
    X, Y, Z = CX * SX + SX - 1, CY * SY, CZ * SX + SX - 1

    from scipy.interpolate import RegularGridInterpolator
    vol = data.reshape(nz, ny, nx)
    zs = origin[2] + np.arange(nz) * step
    ys = origin[1] + np.arange(ny) * step
    xs = origin[0] + np.arange(nx) * step
    interp = RegularGridInterpolator((zs, ys, xs), vol, bounds_error=False, fill_value=step * 4.0)

    tt = frame["t"]
    mx = ((np.arange(X) + 0.5) * H - tt[0]) / s
    my = ((np.arange(Y) + 0.5) * H - tt[1]) / s
    mz = ((np.arange(Z) + 0.5) * H - tt[2]) / s
    gy, gz, gx = np.meshgrid(my, mz, mx, indexing="ij")
    phi_ldu = interp(np.stack([gz, gy, gx], axis=-1).reshape(-1, 3)).reshape(Y, Z, X) * s

    t_vol = np.clip(0.5 - phi_ldu / H, 0.0, 1.0).astype(np.float32)
    band = (np.abs(phi_ldu) <= 0.87 * H).astype(np.uint8)
    return {"t": t_vol.reshape(-1), "band": band.reshape(-1), "X": X, "Y": Y, "Z": Z, "cells": [CX, CY, CZ], "frame": frame, "ms": 0}
