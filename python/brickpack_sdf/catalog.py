"""BrickPack Part Catalog Trainer, 1-LDU EDT^2 SDF Evaluator & 4-LDU Yaw Variants."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Callable

import numpy as np
from scipy.ndimage import distance_transform_edt

from .mesh_io import load_model
from .units import H, PLATE, STUD, STUD_H, STUD_R, SX, SY

PACK_KINDS = {"brick", "plate", "slope", "inverted", "curved", "cheese", "round"}
SLOPED = {"slope", "inverted", "curved", "cheese"}


def _build_stud_cover() -> np.ndarray:
    n = 16
    out = np.zeros((SX, SX), dtype=np.float32)
    off = (np.arange(n) + 0.5) / n
    gx, gz = np.meshgrid(off, off, indexing="xy")
    for z in range(SX):
        for x in range(SX):
            X = (x + gx) * H - STUD * 0.5
            Z = (z + gz) * H - STUD * 0.5
            out[z, x] = float(np.mean(X * X + Z * Z <= STUD_R * STUD_R))
    return out.reshape(-1)


STUD_COVER = _build_stud_cover()


def rotate_volume(vol: np.ndarray, L: int, c: dict, rot: int) -> tuple[np.ndarray, list[tuple[int, int]], int, int]:
    w, d = int(c["w"]), int(c["d"])
    nz, nx = d * SX, w * SX
    th = math.radians(rot)
    co, si = round(math.cos(th)), round(math.sin(th))
    w2, d2 = (d, w) if rot in (90, 270) else (w, d)
    nx2, nz2 = w2 * SX, d2 * SX
    out = np.zeros((L, nz2, nx2), dtype=np.float32)
    src = vol.reshape(L, nz, nx)
    for z in range(nz):
        v = (z + 0.5) * H - d * STUD * 0.5
        for x in range(nx):
            u = (x + 0.5) * H - w * STUD * 0.5
            u2, v2 = co * u + si * v, -si * u + co * v
            ix = min(nx2 - 1, max(0, int(math.floor((u2 + w2 * STUD * 0.5) / H))))
            iz = min(nz2 - 1, max(0, int(math.floor((v2 + d2 * STUD * 0.5) / H))))
            out[:, iz, ix] = src[:, z, x]
    studs = []
    for i, j in c.get("stud_cells", []):
        u, v = (i + 0.5) * STUD - w * STUD * 0.5, (j + 0.5) * STUD - d * STUD * 0.5
        u2, v2 = co * u + si * v, -si * u + co * v
        studs.append((
            min(w2 - 1, max(0, int(math.floor((u2 + w2 * STUD * 0.5) / STUD)))),
            min(d2 - 1, max(0, int(math.floor((v2 + d2 * STUD * 0.5) / STUD)))),
        ))
    return out.reshape(-1), studs, w2, d2


def base_stencil(c: dict) -> tuple[np.ndarray, int, int]:
    nx, nz = int(c["w"]) * SX, int(c["d"]) * SX
    if "cover" in c and "coverH" in c:
        h = int(c["coverH"])
        L = h * SY
        cov = np.asarray(c["cover"], dtype=np.float32).reshape(h, nz * nx)
        V = np.repeat(cov, SY, axis=0).reshape(-1)
        return V, L, h
    top = np.asarray(c["top"], dtype=np.float32)
    bot = np.asarray(c["bot"], dtype=np.float32) if c.get("kind") == "inverted" and "bot" in c else np.zeros_like(top)
    tmax = max(1e-3, float(np.max(top)))
    h = int(math.ceil(tmax / PLATE - 1e-6))
    L = h * SY
    ls = np.arange(L, dtype=np.float32)[:, None]
    V = np.clip((np.minimum(top[None, :], (ls + 1.0) * H) - np.maximum(bot[None, :], ls * H)) / H, 0.0, 1.0)
    return V.reshape(-1), L, h


def build_variants(catalog: list[dict], kinds: set[str] | None = PACK_KINDS) -> tuple[dict, list[dict]]:
    by_key: dict[tuple[str, int], dict] = {}
    lst: list[dict] = []
    for c in catalog:
        if c.get("noSolo"):
            continue
        if kinds is not None and c.get("kind") not in kinds:
            continue
        V0, L, h = base_stencil(c)
        seen = set()
        for rot in (0, 90, 180, 270):
            rV, rstuds, rw, rd = rotate_volume(V0, L, c, rot)
            nx, nz = rw * SX, rd * SX
            vol = float(np.sum(rV))
            def_idx = np.flatnonzero(rV < 1.0).astype(np.int32)
            def_val = (1.0 - rV[def_idx]).astype(np.float32)
            full = len(def_idx) == 0
            v = {
                "c": c, "id": c["id"], "kind": c["kind"], "name": c.get("name", c["id"]),
                "rot": rot, "w": rw, "d": rd, "h": h, "L": L, "V": rV,
                "vol": vol, "full": full, "studs": rstuds,
                "def_idx": def_idx, "def_val": def_val, "per": nx * nz,
            }
            by_key[(c["id"], rot)] = v
            sig = (rw, rd, tuple(round(float(x), 3) for x in rV))
            if sig in seen:
                continue
            seen.add(sig)
            if vol / (SX * SX * SY) < 0.3:
                continue
            lst.append(v)
    return by_key, lst


def part_sdf(c: dict, pad: int = 4) -> dict:
    """Exact 1-LDU 3D signed distance field via SciPy EDT + analytic stud positions."""
    V, L, _ = base_stencil(c)
    nx0, nz0 = int(c["w"]) * SX, int(c["d"]) * SX
    V3 = V.reshape(L, nz0 * nx0)
    has = V3 > 0
    any_has = np.any(has, axis=0)
    hi = np.where(any_has, L - 1 - np.argmax(has[::-1], axis=0), -1)
    lo = np.where(any_has, np.argmax(has, axis=0), -1)
    top = np.where(lo >= 0, (hi + V3[np.maximum(0, hi), np.arange(nx0 * nz0)]) * H, -1.0)
    bot = np.where(lo >= 0, (lo + 1.0 - V3[np.maximum(0, lo), np.arange(nx0 * nz0)]) * H, 0.0)

    W, D, HT = int(c["w"]) * STUD, int(c["d"]) * STUD, L * H
    nx, ny, nz = W + 2 * pad, HT + STUD_H + 2 * pad, D + 2 * pad
    inside = np.zeros((ny, nz, nx), dtype=bool)
    ys = np.arange(ny, dtype=np.float32) + 0.5 - pad
    for z in range(nz):
        Z = z + 0.5 - pad
        if Z < 0 or Z > D:
            continue
        iz = min(nz0 - 1, int(math.floor(Z / H)))
        for x in range(nx):
            X = x + 0.5 - pad
            if X < 0 or X > W:
                continue
            ix = min(nx0 - 1, int(math.floor(X / H)))
            col = iz * nx0 + ix
            if top[col] < 0:
                continue
            inside[:, z, x] = (ys >= bot[col]) & (ys <= top[col])

    # EDT^2 positive outside, negative inside
    d_out = distance_transform_edt(~inside)
    d_in = distance_transform_edt(inside)
    sdf = np.where(inside, -np.maximum(0.0, d_in - 0.5), np.maximum(0.0, d_out - 0.5)).astype(np.float32)

    studs = []
    for si, sj in c.get("stud_cells", []):
        X, Z = (si + 0.5) * STUD, (sj + 0.5) * STUD
        col = min(nz0 - 1, int(math.floor(Z / H))) * nx0 + min(nx0 - 1, int(math.floor(X / H)))
        studs.append((X, max(0.0, float(top[col])), Z))
    return {"sdf": sdf, "nx": nx, "ny": ny, "nz": nz, "origin": (-pad, -pad, -pad), "step": 1, "studs": studs, "vol": int(np.sum(inside))}


def stud_sdf(studs: list[tuple[float, float, float]], x: float, y: float, z: float) -> float:
    best = float("inf")
    for cx, y0, cz in studs:
        r = math.hypot(x - cx, z - cz) - STUD_R
        hy = abs(y - (y0 + STUD_H * 0.5)) - STUD_H * 0.5
        best = min(best, math.hypot(max(r, 0.0), max(hy, 0.0)) + min(max(r, hy), 0.0))
    return best


def _xf(M: np.ndarray, x: float, y: float, z: float) -> tuple[float, float, float]:
    return (
        float(M[0, 0] * x + M[0, 1] * y + M[0, 2] * z + M[0, 3]),
        float(M[1, 0] * x + M[1, 1] * y + M[1, 2] * z + M[1, 3]),
        float(M[2, 0] * x + M[2, 1] * y + M[2, 2] * z + M[2, 3]),
    )


def parse_ldraw_dat(entry_name: str, resolver: Callable[[str], str | None]) -> dict:
    tris = []
    studs = []
    seen_studs = set()
    stack = set()

    def walk(name: str, M: np.ndarray, depth: int) -> None:
        if depth > 24 or name in stack:
            return
        txt = resolver(name)
        if txt is None:
            return
        stack.add(name)
        for raw in txt.splitlines():
            s = raw.strip()
            if not s:
                continue
            tok = s.split()
            t = tok[0]
            if t == "1" and len(tok) >= 15:
                sub = " ".join(tok[14:]).replace("\\", "/")
                msub = np.array([
                    [float(tok[5]), float(tok[6]), float(tok[7]), float(tok[2])],
                    [float(tok[8]), float(tok[9]), float(tok[10]), float(tok[3])],
                    [float(tok[11]), float(tok[12]), float(tok[13]), float(tok[4])],
                    [0.0, 0.0, 0.0, 1.0],
                ], dtype=np.float64)
                nm = M @ msub
                low = sub.lower()
                if "stud" in low:
                    p = _xf(nm, 0.0, 0.0, 0.0)
                    k = (round(p[0], 1), round(p[1], 1), round(p[2], 1))
                    if k not in seen_studs:
                        seen_studs.add(k)
                        studs.append(p)
                if resolver(sub) is not None:
                    walk(sub, nm, depth + 1)
                else:
                    base = low.split("/")[-1].split(".")[0]
                    if base.startswith("rect"):
                        pts = [_xf(nm, x, 0.0, z) for x, z in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
                        tris.extend([pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]])
                    elif "cyli" in base:
                        n = 16
                        for i in range(n):
                            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * ((i + 1) % n) / n
                            p00, p10 = _xf(nm, math.cos(a0), 0.0, math.sin(a0)), _xf(nm, math.cos(a1), 0.0, math.sin(a1))
                            p01, p11 = _xf(nm, math.cos(a0), 1.0, math.sin(a0)), _xf(nm, math.cos(a1), 1.0, math.sin(a1))
                            tris.extend([p00, p10, p11, p00, p11, p01])
            elif t == "3" and len(tok) >= 11:
                tris.extend([
                    _xf(M, float(tok[2]), float(tok[3]), float(tok[4])),
                    _xf(M, float(tok[5]), float(tok[6]), float(tok[7])),
                    _xf(M, float(tok[8]), float(tok[9]), float(tok[10])),
                ])
            elif t == "4" and len(tok) >= 14:
                p0 = _xf(M, float(tok[2]), float(tok[3]), float(tok[4]))
                p1 = _xf(M, float(tok[5]), float(tok[6]), float(tok[7]))
                p2 = _xf(M, float(tok[8]), float(tok[9]), float(tok[10]))
                p3 = _xf(M, float(tok[11]), float(tok[12]), float(tok[13]))
                tris.extend([p0, p1, p2, p0, p2, p3])
        stack.remove(name)

    walk(entry_name, np.eye(4, dtype=np.float64), 0)
    root_txt = resolver(entry_name) or ""
    title = next((ln.strip()[2:].strip() for ln in root_txt.splitlines() if ln.strip()), entry_name)
    return {"tris": np.asarray(tris, dtype=np.float32), "studs": studs, "title": title}


def _classify(title: str, h_plates: int) -> str:
    tl = title.lower()
    if "slope" in tl and "inverted" in tl:
        return "inverted"
    if "cheese" in tl or ("slope" in tl and "31" in tl and "1 x 1" in tl):
        return "cheese"
    if "curved" in tl and "slope" in tl:
        return "curved"
    if "slope" in tl:
        return "slope"
    if "tile" in tl:
        return "tile"
    if "plate" in tl:
        return "plate"
    if any(k in tl for k in ("round", "cylinder", "cone", "dome")):
        return "round"
    if "technic" in tl:
        return "technic"
    return "plate" if h_plates == 1 else "brick"


def train_part_from_ldraw(pid: str, title: str, raw_pts: np.ndarray, raw_studs: list, kind: str | None = None) -> dict | None:
    if len(raw_pts) == 0:
        return None
    x0, y0, z0 = raw_pts.min(axis=0)
    x1, y1, z1 = raw_pts.max(axis=0)
    stud_top_y = min((s[1] for s in raw_studs), default=float(y0))
    span_x = max(STUD, round((x1 - x0) / STUD) * STUD)
    span_z = max(STUD, round((z1 - z0) / STUD) * STUD)
    w, d = max(1, round(span_x / STUD)), max(1, round(span_z / STUD))
    off_x, off_z = w * STUD * 0.5 - 0.5 * (x0 + x1), d * STUD * 0.5 - 0.5 * (z0 + z1)

    pts = np.empty_like(raw_pts, dtype=np.float32)
    pts[:, 0] = raw_pts[:, 0] + off_x
    pts[:, 1] = y1 - raw_pts[:, 1]
    pts[:, 2] = -(raw_pts[:, 2] + off_z) + d * STUD
    raw_body_top = max(float(PLATE), float(y1 - stud_top_y)) if raw_studs else float(pts[:, 1].max())
    h_plates = max(1, round(raw_body_top / PLATE))
    target_h = float(h_plates * PLATE)

    nx, nz = w * SX, d * SX
    top = np.full((nz, nx), -1.0, dtype=np.float32)
    bot = np.full((nz, nx), float("inf"), dtype=np.float32)
    hits = np.zeros((nz, nx), dtype=np.int32)

    tri_pts = pts.reshape(-1, 3, 3)
    for t in tri_pts:
        (ax, ay, az), (bx, by, bz), (cx, cy, cz) = t
        den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
        if abs(den) < 1e-8:
            continue
        i0 = max(0, int(math.floor(min(ax, bx, cx) / H)))
        i1 = min(nx - 1, int(math.floor(max(ax, bx, cx) / H)))
        k0 = max(0, int(math.floor(min(az, bz, cz) / H)))
        k1 = min(nz - 1, int(math.floor(max(az, bz, cz) / H)))
        for k in range(k0, k1 + 1):
            Z = (k + 0.5) * H + 0.0029
            for i in range(i0, i1 + 1):
                X = (i + 0.5) * H + 0.0013
                l1 = ((bz - cz) * (X - cx) + (cx - bx) * (Z - cz)) / den
                if l1 < -1e-4:
                    continue
                l2 = ((cz - az) * (X - cx) + (ax - cx) * (Z - cz)) / den
                if l2 < -1e-4:
                    continue
                l3 = 1.0 - l1 - l2
                if l3 < -1e-4:
                    continue
                y = min(target_h, max(0.0, float(l1 * ay + l2 * by + l3 * cy)))
                hits[k, i] += 1
                if y > top[k, i]:
                    top[k, i] = y
                if y < bot[k, i]:
                    bot[k, i] = y

    top[hits == 0] = 0.0
    bot[hits == 0] = 0.0
    top[np.abs(top - target_h) < 1.2] = target_h
    bot[bot < 1.5] = 0.0

    stud_cells = set()
    for sx, sy, sz in raw_studs:
        ux, uz, uy = sx + off_x, -(sz + off_z) + d * STUD, y1 - sy
        if uy < target_h - 5.0:
            continue
        ci, cj = int(math.floor(ux / STUD)), int(math.floor(uz / STUD))
        if 0 <= ci < w and 0 <= cj < d:
            stud_cells.add((ci, cj))

    knd = kind or _classify(title, h_plates)
    if not stud_cells and knd in ("brick", "plate"):
        stud_cells = {(i, j) for j in range(d) for i in range(w)}

    return {
        "id": pid,
        "name": title or pid,
        "kind": knd,
        "w": w,
        "d": d,
        "top": [round(float(v), 2) for v in top.reshape(-1)],
        "bot": [round(float(v), 2) for v in bot.reshape(-1)],
        "stud_cells": sorted([list(c) for c in stud_cells]),
    }


def train_part_from_mesh(pid: str, tris: np.ndarray, w: int | None = None, d: int | None = None, h_plates: int | None = None, kind: str = "slope") -> dict | None:
    pts = tris.reshape(-1, 3)
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    ext = np.maximum(hi - lo, 1e-6)
    W = w or max(1, min(8, round((ext[0] / min(ext[0], ext[2])) * 2)))
    D = d or max(1, min(8, round((ext[2] / min(ext[0], ext[2])) * 2)))
    HPL = h_plates or max(1, round((ext[1] / (0.5 * (ext[0] / (W * STUD) + ext[2] / (D * STUD)))) / PLATE))
    sx, sy, sz = (W * STUD) / ext[0], (HPL * PLATE) / ext[1], (D * STUD) / ext[2]
    raw_pts = np.empty_like(pts, dtype=np.float32)
    raw_pts[:, 0] = (pts[:, 0] - lo[0]) * sx
    raw_pts[:, 1] = HPL * PLATE - (pts[:, 1] - lo[1]) * sy
    raw_pts[:, 2] = (pts[:, 2] - lo[2]) * sz
    stud_list = [((i + 0.5) * STUD, -STUD_H, (j + 0.5) * STUD) for j in range(D) for i in range(W)]
    return train_part_from_ldraw(pid, pid, raw_pts, stud_list, kind=kind)


def train_catalog_ldraw(ldraw_dir: str | Path, rank_file: str | Path | None = None) -> list[dict]:
    root = Path(ldraw_dir)
    roots = [root / "parts", root, root / "p"]
    cache: dict[str, str | None] = {}

    def resolver(sub: str) -> str | None:
        clean = sub.replace("\\", "/").lstrip("/")
        if clean in cache:
            return cache[clean]
        for r in roots:
            for c in (r / clean, r / clean.lower(), r / (clean + ".dat")):
                if c.is_file():
                    txt = c.read_text(encoding="utf-8", errors="ignore")
                    cache[clean] = txt
                    return txt
        cache[clean] = None
        return None

    if rank_file and Path(rank_file).is_file():
        doc = json.loads(Path(rank_file).read_text(encoding="utf-8"))
        arr = doc if isinstance(doc, list) else doc.get("parts", [])
        specs = [{"id": str(p["id"]).removesuffix(".dat"), "name": p.get("name", p["id"]), "omr_count": p.get("count")} for p in arr]
    else:
        pdir = root / "parts" if (root / "parts").is_dir() else root
        specs = [{"id": f.stem, "name": f.stem} for f in sorted(pdir.glob("*.dat"))]

    catalog = []
    for sp in specs:
        parsed = parse_ldraw_dat(sp["id"] + ".dat", resolver)
        entry = train_part_from_ldraw(sp["id"], parsed["title"] or sp["name"], parsed["tris"], parsed["studs"])
        if entry is None:
            continue
        if sp.get("omr_count") is not None:
            entry["omr_count"] = sp["omr_count"]
        catalog.append(entry)
    return catalog


def train_catalog_models(model_dir: str | Path) -> list[dict]:
    d = Path(model_dir)
    catalog = []
    for f in sorted(d.iterdir()):
        if f.suffix.lower() in (".obj", ".glb", ".ply"):
            m = load_model(f)
            entry = train_part_from_mesh(f.stem, m["tris"], kind="slope")
            if entry is not None:
                catalog.append(entry)
    return catalog


def save_catalog(catalog: list[dict], out_path: str | Path, source: str = "ldraw") -> Path:
    p = Path(out_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    doc = {"format": "brickpack-catalog-v1", "count": len(catalog), "source": source, "parts": catalog}
    p.write_text(json.dumps(doc), encoding="utf-8")
    return p


def load_catalog(path: str | Path) -> list[dict]:
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    return doc if isinstance(doc, list) else doc.get("parts", [])
