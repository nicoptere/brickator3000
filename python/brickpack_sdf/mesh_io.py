"""Unified 3D Mesh Adapter (OBJ, GLB, PLY) & BrickPack GLB / LDR Exporters."""

from __future__ import annotations

import io
import json
import math
import struct
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from .colors import lin_to_srgb, srgb_to_lin
from .units import PLATE, STUD


KIND_COL = {
    "slope": (37, 99, 235),
    "curved": (8, 145, 178),
    "cheese": (147, 51, 234),
    "inverted": (230, 77, 77),
    "tile": (204, 214, 224),
    "plate": (140, 153, 171),
    "brick": (89, 102, 122),
    "round": (242, 153, 25),
    "technic": (51, 178, 89),
    "shaped": (230, 199, 38),
    "snot": (191, 51, 191),
    "solid": (89, 102, 122),
    "shape": (153, 115, 77),
}


def _srgb_arr_to_lin(arr: np.ndarray) -> np.ndarray:
    a = np.clip(arr.astype(np.float32), 0.0, 1.0)
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def _sample_texture(tex: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    h, w, _ = tex.shape
    fu = np.mod(u, 1.0)
    fv = np.mod(v, 1.0)
    x = np.clip(np.floor(fu * w).astype(np.int32), 0, w - 1)
    y = np.clip(np.floor(fv * h).astype(np.int32), 0, h - 1)
    return _srgb_arr_to_lin(tex[y, x] / 255.0)


def parse_obj(text: str) -> dict[str, Any]:
    verts = []
    vcols_in = []
    uvs_in = []
    has_vc = False
    tris = []
    tcols = []
    tuvs = []
    for raw in text.splitlines():
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        if s.startswith("v "):
            p = s.split()
            verts.append((float(p[1]), float(p[2]), float(p[3])))
            if len(p) >= 7:
                has_vc = True
                r, g, b = float(p[4]), float(p[5]), float(p[6])
                if max(r, g, b) > 1.0:
                    r, g, b = r / 255.0, g / 255.0, b / 255.0
                vcols_in.append((srgb_to_lin(r), srgb_to_lin(g), srgb_to_lin(b)))
            else:
                vcols_in.append((0.45, 0.45, 0.45))
        elif s.startswith("vt "):
            p = s.split()
            uvs_in.append((float(p[1]), 1.0 - float(p[2])))
        elif s.startswith("f "):
            toks = s.split()[1:]
            idx = []
            uv_idx = []
            for tk in toks:
                parts = tk.split("/")
                vi = int(parts[0])
                vi = len(verts) + vi if vi < 0 else vi - 1
                idx.append(vi)
                if len(parts) > 1 and parts[1]:
                    ti = int(parts[1])
                    uv_idx.append(len(uvs_in) + ti if ti < 0 else ti - 1)
                else:
                    uv_idx.append(-1)
            for k in range(1, len(idx) - 1):
                for a, ua in ((idx[0], uv_idx[0]), (idx[k], uv_idx[k]), (idx[k + 1], uv_idx[k + 1])):
                    tris.append(verts[a])
                    tcols.append(vcols_in[a])
                    tuvs.append(uvs_in[ua] if 0 <= ua < len(uvs_in) else (0.0, 0.0))
    return {
        "tris": np.asarray(tris, dtype=np.float32).reshape(-1, 3, 3),
        "vcols": np.asarray(tcols, dtype=np.float32).reshape(-1, 3, 3),
        "uvs": np.asarray(tuvs, dtype=np.float32).reshape(-1, 3, 2) if uvs_in else None,
        "has_color": has_vc,
    }


_PLY_DT = {
    "char": ("b", 1), "int8": ("b", 1),
    "uchar": ("B", 1), "uint8": ("B", 1),
    "short": ("h", 2), "int16": ("h", 2),
    "ushort": ("H", 2), "uint16": ("H", 2),
    "int": ("i", 4), "int32": ("i", 4),
    "uint": ("I", 4), "uint32": ("I", 4),
    "float": ("f", 4), "float32": ("f", 4),
    "double": ("d", 8), "float64": ("d", 8),
}


def parse_ply(raw: bytes) -> dict[str, Any]:
    marker = b"end_header"
    end_idx = raw.find(marker)
    if end_idx < 0:
        raise ValueError("PLY missing end_header")
    nl = raw.find(b"\n", end_idx)
    hdr_end = nl + 1 if nl >= 0 else len(raw)
    hdr_lines = raw[:hdr_end].decode("latin1").splitlines()

    fmt = "ascii"
    elements: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    for line in hdr_lines:
        tok = line.strip().split()
        if not tok:
            continue
        if tok[0] == "format":
            fmt = tok[1]
        elif tok[0] == "element":
            cur = {"name": tok[1], "count": int(tok[2]), "props": []}
            elements.append(cur)
        elif tok[0] == "property" and cur is not None:
            if tok[1] == "list":
                cur["props"].append({"is_list": True, "len_type": tok[2], "val_type": tok[3], "name": tok[4]})
            else:
                cur["props"].append({"is_list": False, "type": tok[1], "name": tok[2]})

    v_el = next((e for e in elements if e["name"] == "vertex"), None)
    if not v_el:
        raise ValueError("PLY missing vertex element")
    pnames = [p["name"] for p in v_el["props"]]
    ix, iy, iz = pnames.index("x"), pnames.index("y"), pnames.index("z")
    ir = pnames.index("red") if "red" in pnames else (pnames.index("r") if "r" in pnames else -1)
    ig = pnames.index("green") if "green" in pnames else (pnames.index("g") if "g" in pnames else -1)
    ib = pnames.index("blue") if "blue" in pnames else (pnames.index("b") if "b" in pnames else -1)
    has_color = min(ir, ig, ib) >= 0
    col_float = has_color and v_el["props"][ir]["type"] in ("float", "float32", "double", "float64")

    V = np.zeros((v_el["count"], 3), dtype=np.float32)
    VC = np.full((v_el["count"], 3), 0.45, dtype=np.float32)
    tris = []
    tcols = []

    if fmt == "ascii":
        body_lines = [ln.strip().split() for ln in raw[hdr_end:].decode("utf-8", errors="ignore").splitlines() if ln.strip()]
        li = 0
        for el in elements:
            if el["name"] == "vertex":
                for i in range(el["count"]):
                    tok = body_lines[li]
                    li += 1
                    V[i] = (float(tok[ix]), float(tok[iy]), float(tok[iz]))
                    if has_color:
                        d = 1.0 if col_float else 255.0
                        VC[i] = (
                            srgb_to_lin(float(tok[ir]) / d),
                            srgb_to_lin(float(tok[ig]) / d),
                            srgb_to_lin(float(tok[ib]) / d),
                        )
            elif el["name"] == "face":
                for _ in range(el["count"]):
                    tok = body_lines[li]
                    li += 1
                    n = int(tok[0])
                    v_ids = [int(tok[1 + k]) for k in range(n)]
                    for k in range(1, n - 1):
                        for v in (v_ids[0], v_ids[k], v_ids[k + 1]):
                            tris.append(V[v])
                            tcols.append(VC[v])
            else:
                li += el["count"]
    else:
        endian = "<" if fmt == "binary_little_endian" else ">"
        off = hdr_end
        for el in elements:
            if el["name"] == "vertex" and all(not p["is_list"] for p in el["props"]):
                dt = np.dtype([(p["name"], endian + _PLY_DT[p["type"]][0]) for p in el["props"]])
                arr = np.frombuffer(raw, dtype=dt, count=el["count"], offset=off)
                off += el["count"] * dt.itemsize
                V[:, 0] = arr["x"]
                V[:, 1] = arr["y"]
                V[:, 2] = arr["z"]
                if has_color:
                    d = 1.0 if col_float else 255.0
                    VC[:, 0] = _srgb_arr_to_lin(arr[pnames[ir]] / d)
                    VC[:, 1] = _srgb_arr_to_lin(arr[pnames[ig]] / d)
                    VC[:, 2] = _srgb_arr_to_lin(arr[pnames[ib]] / d)
            elif el["name"] == "face":
                for _ in range(el["count"]):
                    for p in el["props"]:
                        if p["is_list"]:
                            lc, lsz = _PLY_DT[p["len_type"]]
                            vc, vsz = _PLY_DT[p["val_type"]]
                            n = struct.unpack_from(endian + lc, raw, off)[0]
                            off += lsz
                            vs = struct.unpack_from(endian + vc * n, raw, off)
                            off += n * vsz
                            if p["name"] in ("vertex_indices", "vertex_index"):
                                for k in range(1, n - 1):
                                    for v in (vs[0], vs[k], vs[k + 1]):
                                        tris.append(V[v])
                                        tcols.append(VC[v])
                        else:
                            _, sz = _PLY_DT[p["type"]]
                            off += sz
            else:
                for _ in range(el["count"]):
                    for p in el["props"]:
                        if p["is_list"]:
                            lc, lsz = _PLY_DT[p["len_type"]]
                            _, vsz = _PLY_DT[p["val_type"]]
                            n = struct.unpack_from(endian + lc, raw, off)[0]
                            off += lsz + n * vsz
                        else:
                            _, sz = _PLY_DT[p["type"]]
                            off += sz

    return {
        "tris": np.asarray(tris, dtype=np.float32).reshape(-1, 3, 3),
        "vcols": np.asarray(tcols, dtype=np.float32).reshape(-1, 3, 3),
        "has_color": has_color,
    }


_GLTF_CT = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
_GLTF_NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
_GLTF_NMAX = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}


def _accessor(gl: dict, bin_bytes: bytes, idx: int) -> np.ndarray:
    a = gl["accessors"][idx]
    bv = gl["bufferViews"][a["bufferView"]]
    fmt = _GLTF_CT[a["componentType"]]
    ncomp = _GLTF_NC[a["type"]]
    sz = struct.calcsize("<" + fmt)
    stride = bv.get("byteStride") or sz * ncomp
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    cnt = a["count"]
    out = np.empty((cnt, ncomp), dtype=np.float64)
    if stride == sz * ncomp:
        arr = np.frombuffer(bin_bytes, dtype="<" + fmt, count=cnt * ncomp, offset=off).reshape(cnt, ncomp)
        out[:] = arr
    else:
        for k in range(cnt):
            out[k] = struct.unpack_from("<" + fmt * ncomp, bin_bytes, off + k * stride)
    if a.get("normalized") and a["componentType"] in _GLTF_NMAX:
        out /= _GLTF_NMAX[a["componentType"]]
    return out


def _node_matrix(nd: dict) -> np.ndarray:
    if "matrix" in nd:
        return np.asarray(nd["matrix"], dtype=np.float64).reshape(4, 4).T
    t = nd.get("translation", [0.0, 0.0, 0.0])
    x, y, z, w = nd.get("rotation", [0.0, 0.0, 0.0, 1.0])
    s = nd.get("scale", [1.0, 1.0, 1.0])
    R = np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ],
        dtype=np.float64,
    )
    M = np.eye(4, dtype=np.float64)
    M[:3, :3] = R * np.asarray(s)[None, :]
    M[:3, 3] = t
    return M


def parse_glb(raw: bytes) -> dict[str, Any]:
    magic, _ver, _tot = struct.unpack_from("<III", raw, 0)
    if magic != 0x46546C67:
        raise ValueError("Not a valid binary GLB file")
    off = 12
    gl = None
    bin_bytes = b""
    while off < len(raw):
        clen, ctype = struct.unpack_from("<II", raw, off)
        chunk = raw[off + 8 : off + 8 + clen]
        if ctype == 0x4E4F534A:
            gl = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            bin_bytes = chunk
        off += 8 + clen
    if gl is None:
        raise ValueError("GLB missing JSON chunk")

    textures_img: list[np.ndarray | None] = []
    for img in gl.get("images", []):
        if "bufferView" in img:
            bv = gl["bufferViews"][img["bufferView"]]
            bo = bv.get("byteOffset", 0)
            sl = bin_bytes[bo : bo + bv["byteLength"]]
            pil_img = Image.open(io.BytesIO(sl)).convert("RGB")
            textures_img.append(np.asarray(pil_img, dtype=np.uint8))
        else:
            textures_img.append(None)

    all_tris = []
    all_cols = []
    all_uvs = []
    tri_tex_idx = []
    has_color = False

    def visit(ni: int, parent: np.ndarray) -> None:
        nonlocal has_color
        nd = gl["nodes"][ni]
        M = parent @ _node_matrix(nd)
        if "mesh" in nd:
            for pr in gl["meshes"][nd["mesh"]]["primitives"]:
                if pr.get("mode", 4) != 4:
                    continue
                pos = _accessor(gl, bin_bytes, pr["attributes"]["POSITION"])
                nv = len(pos)
                if "indices" in pr:
                    idx = _accessor(gl, bin_bytes, pr["indices"]).reshape(-1).astype(np.int64)
                else:
                    idx = np.arange(nv, dtype=np.int64)

                vcol = None
                if "COLOR_0" in pr["attributes"]:
                    vcol = _accessor(gl, bin_bytes, pr["attributes"]["COLOR_0"])[:, :3]
                    has_color = True
                uv = (
                    _accessor(gl, bin_bytes, pr["attributes"]["TEXCOORD_0"])[:, :2]
                    if "TEXCOORD_0" in pr["attributes"]
                    else None
                )
                mat = gl["materials"][pr["material"]] if ("material" in pr and "materials" in gl) else {}
                pbr = mat.get("pbrMetallicRoughness", {})
                bcf = np.asarray(pbr.get("baseColorFactor", [1.0, 1.0, 1.0, 1.0])[:3], dtype=np.float32)
                tex_info = pbr.get("baseColorTexture")
                img_idx = -1
                tex = None
                if tex_info is not None:
                    tex_obj = gl.get("textures", [])[tex_info["index"]]
                    img_idx = tex_obj.get("source", -1)
                    if 0 <= img_idx < len(textures_img):
                        tex = textures_img[img_idx]
                if tex is not None or np.any(np.abs(bcf - 1.0) > 1e-3):
                    has_color = True

                wp = (pos @ M[:3, :3].T) + M[:3, 3]
                tris = wp[idx].reshape(-1, 3, 3).astype(np.float32)
                all_tris.append(tris)
                nt = len(tris)

                if tex is not None and uv is not None:
                    tuv = uv[idx].reshape(-1, 3, 2)
                    c = _sample_texture(tex, tuv[:, :, 0], tuv[:, :, 1]) * bcf[None, None, :]
                    all_cols.append(c.astype(np.float32))
                    all_uvs.append(tuv.astype(np.float32))
                    tri_tex_idx.append(np.full(nt, img_idx, dtype=np.int32))
                elif vcol is not None:
                    c = vcol[idx].reshape(-1, 3, 3) * bcf[None, None, :]
                    all_cols.append(c.astype(np.float32))
                    all_uvs.append(np.zeros((nt, 3, 2), dtype=np.float32))
                    tri_tex_idx.append(np.full(nt, -1, dtype=np.int32))
                else:
                    c = np.broadcast_to(bcf if "baseColorFactor" in pbr else np.array([0.55, 0.55, 0.55], dtype=np.float32), (nt, 3, 3)).copy()
                    all_cols.append(c)
                    all_uvs.append(np.zeros((nt, 3, 2), dtype=np.float32))
                    tri_tex_idx.append(np.full(nt, -1, dtype=np.int32))

        for ch in nd.get("children", []):
            visit(ch, M)

    sc = gl["scenes"][gl.get("scene", 0)]
    I = np.eye(4, dtype=np.float64)
    for root in sc["nodes"]:
        visit(root, I)

    return {
        "tris": np.concatenate(all_tris, axis=0) if all_tris else np.zeros((0, 3, 3), dtype=np.float32),
        "vcols": np.concatenate(all_cols, axis=0) if all_cols else np.zeros((0, 3, 3), dtype=np.float32),
        "uvs": np.concatenate(all_uvs, axis=0) if all_uvs else None,
        "tri_tex_idx": np.concatenate(tri_tex_idx, axis=0) if tri_tex_idx else None,
        "textures": textures_img,
        "has_color": has_color,
    }


def load_model(path: str | Path) -> dict[str, Any]:
    p = Path(path)
    ext = p.suffix.lower()
    if ext == ".obj":
        m = parse_obj(p.read_text(encoding="utf-8", errors="ignore"))
    elif ext == ".ply":
        m = parse_ply(p.read_bytes())
    elif ext == ".glb":
        m = parse_glb(p.read_bytes())
    else:
        raise ValueError(f"Unsupported format {p.suffix}; expected .obj, .glb, or .ply")
    m["name"] = p.stem
    return m


def _rot_y(deg: float) -> np.ndarray:
    t = math.radians(deg)
    c, s = round(math.cos(t)), round(math.sin(t))
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float32)


def _index_tris(tris: list[tuple[float, float, float]]) -> tuple[np.ndarray, np.ndarray]:
    """Deduplicate vertices cleanly so closed surfaces share exact manifold half-edges."""
    vmap: dict[tuple[float, float, float], int] = {}
    verts: list[tuple[float, float, float]] = []
    idx: list[int] = []
    for p in tris:
        k = (round(float(p[0]), 3), round(float(p[1]), 3), round(float(p[2]), 3))
        vi = vmap.get(k)
        if vi is None:
            vi = len(verts)
            vmap[k] = vi
            verts.append((float(p[0]), float(p[1]), float(p[2])))
        idx.append(vi)
    return np.asarray(verts, dtype=np.float32), np.asarray(idx, dtype=np.uint32)


def _push_cyl(
    cx: float,
    cz: float,
    r0: float,
    y0: float,
    y1: float,
    seg: int,
    out: list[tuple[float, float, float]],
    r1: float | None = None,
) -> None:
    """Append a closed, outward-oriented cylinder/frustum segment."""
    if r1 is None:
        r1 = r0
    for i in range(seg):
        a0 = 2.0 * math.pi * i / seg
        a1 = 2.0 * math.pi * (i + 1) / seg
        c0, s0 = math.cos(a0), math.sin(a0)
        c1, s1 = math.cos(a1), math.sin(a1)
        p0 = (cx + r0 * c0, y0, cz + r0 * s0)
        p1 = (cx + r0 * c1, y0, cz + r0 * s1)
        q0 = (cx + r1 * c0, y1, cz + r1 * s0)
        q1 = (cx + r1 * c1, y1, cz + r1 * s1)
        if r0 > 1e-4 or r1 > 1e-4:
            out.extend((p0, q1, p1, p0, q0, q1))
        if r1 > 1e-4:
            out.extend(((cx, y1, cz), q1, q0))
        if r0 > 1e-4:
            out.extend(((cx, y0, cz), p0, p1))


def _stud_geo(r: float = 6.0, h: float = 4.0, seg: int = 12) -> tuple[np.ndarray, np.ndarray]:
    tris: list[tuple[float, float, float]] = []
    _push_cyl(0.0, 0.0, r, 0.0, h, seg, tris, r)
    return _index_tris(tris)


_STUD_VERTS, _STUD_IDX = _stud_geo()


def _cyl_part(c: dict, rot: int, ch: int) -> tuple[np.ndarray, np.ndarray, list[tuple[float, float, float]]]:
    w, d = int(c["w"]), int(c["d"])
    rads = [float(r) for r in (c.get("rad") or [w * STUD * 0.5] * max(1, int(ch)))]
    tris: list[tuple[float, float, float]] = []
    seg = 20
    n_lay = len(rads)
    # Build single continuous outer shell across plate layers (bottom at l=0, top at l=n_lay-1)
    for l in range(n_lay):
        r0 = rads[l]
        r1 = rads[l + 1] if l + 1 < n_lay else r0
        y0, y1 = l * PLATE, (l + 1) * PLATE
        for i in range(seg):
            a0 = 2.0 * math.pi * i / seg
            a1 = 2.0 * math.pi * (i + 1) / seg
            c0, s0 = math.cos(a0), math.sin(a0)
            c1, s1 = math.cos(a1), math.sin(a1)
            p0, p1 = (r0 * c0, y0, r0 * s0), (r0 * c1, y0, r0 * s1)
            q0, q1 = (r1 * c0, y1, r1 * s0), (r1 * c1, y1, r1 * s1)
            if r0 > 1e-4 or r1 > 1e-4:
                tris.extend((p0, q1, p1, p0, q0, q1))
            if l == 0 and r0 > 1e-4:
                tris.extend(((0.0, 0.0, 0.0), p0, p1))
            if l == n_lay - 1 and r1 > 1e-4:
                tris.extend(((0.0, y1, 0.0), q1, q0))
    V, I = _index_tris(tris)
    R = _rot_y(rot)
    V = V @ R.T
    cx, cz = w * 10.0, d * 10.0
    stud_y = len(rads) * PLATE
    studs_out = []
    for si, sj in c.get("stud_cells", []):
        p = R @ np.array([(si + 0.5) * STUD - cx, stud_y, (sj + 0.5) * STUD - cz], dtype=np.float32)
        studs_out.append((float(p[0]), float(p[1]), float(p[2])))
    return V, I, studs_out


def _heightfield_part(c: dict, rot: int) -> tuple[np.ndarray, np.ndarray, list[tuple[float, float, float]]]:
    w, d = int(c["w"]), int(c["d"])
    nx, nz = w * 5, d * 5
    top = np.asarray(c["top"], dtype=np.float32).reshape(nz, nx)

    tris: list[tuple[float, float, float]] = []
    R = _rot_y(rot)
    cx, cz = w * 10.0, d * 10.0

    # Corner-averaged heights over the 5x5-per-stud columns
    pad = np.pad(top, ((1, 1), (1, 1)), mode="edge")
    hc = 0.25 * (pad[:-1, :-1] + pad[:-1, 1:] + pad[1:, :-1] + pad[1:, 1:])
    x0, z0 = -cx, -cz

    xs = x0 + 4.0 * np.arange(nx + 1)
    zs = z0 + 4.0 * np.arange(nz + 1)
    for j in range(nz):
        for i in range(nx):
            a = (xs[i], hc[j, i], zs[j])
            b = (xs[i], hc[j + 1, i], zs[j + 1])
            cc = (xs[i + 1], hc[j + 1, i + 1], zs[j + 1])
            dd = (xs[i + 1], hc[j, i + 1], zs[j])
            tris.extend((a, b, cc, a, cc, dd))
    # Perimeter skirts down to bottom
    for j in range(nz):
        tris.extend(((xs[0], 0, zs[j]), (xs[0], 0, zs[j + 1]), (xs[0], hc[j + 1, 0], zs[j + 1]),
                     (xs[0], 0, zs[j]), (xs[0], hc[j + 1, 0], zs[j + 1]), (xs[0], hc[j, 0], zs[j])))
        tris.extend(((xs[nx], 0, zs[j]), (xs[nx], hc[j, nx], zs[j]), (xs[nx], hc[j + 1, nx], zs[j + 1]),
                     (xs[nx], 0, zs[j]), (xs[nx], hc[j + 1, nx], zs[j + 1]), (xs[nx], 0, zs[j + 1])))
    for i in range(nx):
        tris.extend(((xs[i], 0, zs[0]), (xs[i], hc[0, i], zs[0]), (xs[i + 1], hc[0, i + 1], zs[0]),
                     (xs[i], 0, zs[0]), (xs[i + 1], hc[0, i + 1], zs[0]), (xs[i + 1], 0, zs[0])))
        tris.extend(((xs[i], 0, zs[nz]), (xs[i + 1], 0, zs[nz]), (xs[i + 1], hc[nz, i + 1], zs[nz]),
                     (xs[i], 0, zs[nz]), (xs[i + 1], hc[nz, i + 1], zs[nz]), (xs[i], hc[nz, i], zs[nz])))
    # Watertight bottom cap sharing exact perimeter border vertices (no T-junctions)
    bot_c = (0.0, 0.0, 0.0)
    for j in range(nz):
        tris.extend((bot_c, (xs[0], 0, zs[j + 1]), (xs[0], 0, zs[j])))
        tris.extend((bot_c, (xs[nx], 0, zs[j]), (xs[nx], 0, zs[j + 1])))
    for i in range(nx):
        tris.extend((bot_c, (xs[i], 0, zs[0]), (xs[i + 1], 0, zs[0])))
        tris.extend((bot_c, (xs[i + 1], 0, zs[nz]), (xs[i], 0, zs[nz])))
    V, I = _index_tris(tris)
    V = (V @ R.T)

    studs_out = []
    for si, sj in c.get("stud_cells", []):
        sx = (si + 0.5) * STUD - cx
        sz = (sj + 0.5) * STUD - cz
        col_x = min(nx - 1, max(0, int((si + 0.5) * 5)))
        col_z = min(nz - 1, max(0, int((sj + 0.5) * 5)))
        sy = float(top[col_z, col_x])
        p = R @ np.array([sx, sy, sz], dtype=np.float32)
        studs_out.append((float(p[0]), float(p[1]), float(p[2])))
    return V, I, studs_out


def _box_part(w: int, d: int, h: int, stud_cells: list) -> tuple[np.ndarray, np.ndarray, list[tuple[float, float, float]]]:
    hx, hy, hz = w * 10.0, h * PLATE, d * 10.0
    corners = np.array([
        [-hx, 0, -hz], [hx, 0, -hz], [hx, hy, -hz], [-hx, hy, -hz],
        [-hx, 0, hz], [hx, 0, hz], [hx, hy, hz], [-hx, hy, hz],
    ], dtype=np.float32)
    quads = [
        (0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (0, 4, 7, 3), (1, 2, 6, 5)
    ]
    idx = []
    for a, b, c, dd in quads:
        idx.extend([a, b, c, a, c, dd])
    studs = [((i + 0.5) * STUD - hx, float(hy), (j + 0.5) * STUD - hz) for i, j in stud_cells]
    return corners, np.asarray(idx, dtype=np.uint32), studs


def build_bricks_mesh(pieces: list[dict], catalog: list[dict], color_mode: str = "piece", hide_covered: bool = True) -> dict[str, np.ndarray]:
    by_id = {c["id"]: c for c in catalog}
    occ = set()
    if hide_covered:
        for p in pieces:
            for dz in range(p["d"]):
                for dx in range(p["w"]):
                    for dy in range(p["h"]):
                        occ.add((p["i"] + dx, p["j"] + dz, p["b"] + dy))

    tmpl_cache: dict[tuple[str, int], tuple[np.ndarray, np.ndarray, list]] = {}
    pos_parts = []
    col_parts = []
    idx_parts = []
    v_off = 0

    for p in pieces:
        pid = p["id"]
        rot = int(p.get("rot", 0))
        key = (pid, rot)
        if key not in tmpl_cache:
            c = by_id[pid]
            if c.get("kind") == "round":
                tmpl_cache[key] = _cyl_part(c, rot, p["h"])
            elif c.get("kind") in ("brick", "plate", "tile") and "top" not in c:
                pw, pd = (c["d"], c["w"]) if rot in (90, 270) else (c["w"], c["d"])
                tmpl_cache[key] = _box_part(pw, pd, p["h"], p.get("studs", []))
            elif c.get("kind") in ("brick", "plate") and np.allclose(c["top"], p["h"] * PLATE, atol=0.5):
                pw, pd = (c["d"], c["w"]) if rot in (90, 270) else (c["w"], c["d"])
                tmpl_cache[key] = _box_part(pw, pd, p["h"], p.get("studs", c.get("stud_cells", [])))
            else:
                tmpl_cache[key] = _heightfield_part(c, rot)
        tv, ti, tstuds = tmpl_cache[key]

        ox = (p["i"] + p["w"] * 0.5) * STUD
        oy = p["b"] * PLATE
        oz = (p["j"] + p["d"] * 0.5) * STUD
        rgb = KIND_COL.get(p.get("kind", "brick"), (160, 165, 169)) if color_mode == "kind" else tuple(p.get("rgb", (160, 165, 169)))
        col_u8 = np.asarray(rgb, dtype=np.uint8)

        pos_parts.append(tv + np.array([ox, oy, oz], dtype=np.float32))
        col_parts.append(np.broadcast_to(col_u8, (len(tv), 3)).copy())
        idx_parts.append(ti + v_off)
        v_off += len(tv)

        top_b = p["b"] + p["h"]
        for sx, sy, sz in tstuds:
            ci = int(math.floor((sx + ox) / STUD))
            cj = int(math.floor((sz + oz) / STUD))
            if (ci, cj, top_b) in occ:
                continue
            pos_parts.append(_STUD_VERTS + np.array([ox + sx, oy + sy, oz + sz], dtype=np.float32))
            col_parts.append(np.broadcast_to(col_u8, (len(_STUD_VERTS), 3)).copy())
            idx_parts.append(_STUD_IDX + v_off)
            v_off += len(_STUD_VERTS)

    return {
        "pos": np.concatenate(pos_parts, axis=0) if pos_parts else np.zeros((0, 3), dtype=np.float32),
        "col": np.concatenate(col_parts, axis=0) if col_parts else np.zeros((0, 3), dtype=np.uint8),
        "idx": np.concatenate(idx_parts, axis=0) if idx_parts else np.zeros((0,), dtype=np.uint32),
    }


def export_glb(mesh: dict[str, np.ndarray], out_path: str | Path, scale: float = 0.01) -> Path:
    pos = (mesh["pos"].astype(np.float32) * scale).copy()
    col_u8 = mesh["col"]
    idx = mesh["idx"].astype(np.uint32)
    n = len(pos)
    lo = pos.min(axis=0).tolist() if n else [0.0, 0.0, 0.0]
    hi = pos.max(axis=0).tolist() if n else [0.0, 0.0, 0.0]

    lut = np.array([round(srgb_to_lin(x / 255.0) * 255.0) for x in range(256)], dtype=np.uint8)
    rgba = np.empty((n, 4), dtype=np.uint8)
    rgba[:, :3] = lut[col_u8]
    rgba[:, 3] = 255

    parts = [pos.tobytes(), rgba.tobytes(), idx.tobytes()]
    offs = []
    cur = 0
    padded = []
    for p in parts:
        offs.append(cur)
        pad_len = ((len(p) + 3) // 4) * 4
        padded.append(p + b"\x00" * (pad_len - len(p)))
        cur += pad_len
    bin_bytes = b"".join(padded)

    gltf = {
        "asset": {"version": "2.0", "generator": "brickpack-sdf-py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "lego"}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "COLOR_0": 1}, "indices": 2, "material": 0, "mode": 4}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 0.55}}],
        "buffers": [{"byteLength": len(bin_bytes)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": offs[0], "byteLength": len(parts[0]), "target": 34962},
            {"buffer": 0, "byteOffset": offs[1], "byteLength": len(parts[1]), "target": 34962},
            {"buffer": 0, "byteOffset": offs[2], "byteLength": len(parts[2]), "target": 34963},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": n, "type": "VEC3", "min": lo, "max": hi},
            {"bufferView": 1, "componentType": 5121, "normalized": True, "count": n, "type": "VEC4"},
            {"bufferView": 2, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
        ],
    }
    js_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    js_pad = (4 - (len(js_bytes) % 4)) % 4
    json_chunk = js_bytes + b" " * js_pad
    total = 12 + 8 + len(json_chunk) + 8 + len(bin_bytes)

    out_p = Path(out_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    with out_p.open("wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(json_chunk), 0x4E4F534A))
        f.write(json_chunk)
        f.write(struct.pack("<II", len(bin_bytes), 0x004E4942))
        f.write(bin_bytes)
    return out_p


def export_ldr(pieces: list[dict], catalog: list[dict], out_path: str | Path, name: str = "brickpack_model") -> Path:
    by_id = {c["id"]: c for c in catalog}
    lines = [f"0 {name}", f"0 Name: {name}.ldr", "0 Author: BrickPack SDF Python"]
    for p in pieces:
        R = _rot_y(p.get("rot", 0))
        M = [R[0, 0], -R[0, 1], -R[0, 2], -R[1, 0], R[1, 1], R[1, 2], -R[2, 0], R[2, 1], R[2, 2]]
        cx = (p["i"] + p["w"] * 0.5) * STUD
        cy = p["b"] * PLATE
        cz = (p["j"] + p["d"] * 0.5) * STUD
        h_ldu = p["h"] * PLATE
        oy = -(cy + h_ldu)
        oz = -cz
        rgb = p.get("rgb", (160, 165, 169))
        code = p.get("code", 0x2000000 + (rgb[0] << 16) + (rgb[1] << 8) + rgb[2])
        mstr = " ".join(f"{float(x):.4f}".rstrip("0").rstrip(".") for x in M)
        lines.append(f"1 {code} {cx:.1f} {oy:.1f} {oz:.1f} {mstr} {p['id']}.dat")
    out_p = Path(out_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    out_p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out_p


def nearest_triangle_color(query: np.ndarray, model: dict[str, Any]) -> tuple[int, int, int]:
    """Sample closest point on source mesh triangles & return sRGB [0..255] triplet."""
    tris = model["tris"]
    if len(tris) == 0:
        return (160, 165, 169)
    centroids = tris.mean(axis=1)
    q = np.asarray(query, dtype=np.float32)
    # Pre-filter candidate triangles via centroid distance, then exact point-triangle barycentric
    d2_c = np.sum((centroids - q) ** 2, axis=1)
    k = min(32, len(tris))
    cand_ids = np.argpartition(d2_c, k - 1)[:k]
    sub = tris[cand_ids]

    A, B, C = sub[:, 0], sub[:, 1], sub[:, 2]
    AB = B - A
    AC = C - A
    AP = q[None, :] - A
    d1 = np.einsum("ij,ij->i", AB, AP)
    d2 = np.einsum("ij,ij->i", AC, AP)
    BP = q[None, :] - B
    d3 = np.einsum("ij,ij->i", AB, BP)
    d4 = np.einsum("ij,ij->i", AC, BP)
    CP = q[None, :] - C
    d5 = np.einsum("ij,ij->i", AB, CP)
    d6 = np.einsum("ij,ij->i", AC, CP)

    best_d2 = float("inf")
    best_idx = int(cand_ids[0])
    best_bary = (1.0, 0.0, 0.0)
    for m, tid in enumerate(cand_ids):
        vc = d1[m] * d4[m] - d3[m] * d2[m]
        vb = d5[m] * d2[m] - d1[m] * d6[m]
        va = d3[m] * d6[m] - d5[m] * d4[m]
        if d1[m] <= 0 and d2[m] <= 0:
            u, v, w = 1.0, 0.0, 0.0
        elif d3[m] >= 0 and d4[m] <= d3[m]:
            u, v, w = 0.0, 1.0, 0.0
        elif vc <= 0 and d1[m] >= 0 and d3[m] <= 0:
            v = float(d1[m] / (d1[m] - d3[m]))
            u, w = 1.0 - v, 0.0
        elif d6[m] >= 0 and d5[m] <= d6[m]:
            u, v, w = 0.0, 0.0, 1.0
        elif vb <= 0 and d2[m] >= 0 and d6[m] <= 0:
            w = float(d2[m] / (d2[m] - d6[m]))
            u, v = 1.0 - w, 0.0
        elif va <= 0 and (d4[m] - d3[m]) >= 0 and (d5[m] - d6[m]) >= 0:
            w = float((d4[m] - d3[m]) / ((d4[m] - d3[m]) + (d5[m] - d6[m])))
            u, v = 0.0, 1.0 - w
        else:
            den = 1.0 / (va + vb + vc)
            v, w = float(vb * den), float(vc * den)
            u = 1.0 - v - w
        pt = u * A[m] + v * B[m] + w * C[m] - q
        d2_val = float(np.dot(pt, pt))
        if d2_val < best_d2:
            best_d2 = d2_val
            best_idx = int(tid)
            best_bary = (u, v, w)

    u, v, w = best_bary
    vc = model["vcols"][best_idx]
    lin = u * vc[0] + v * vc[1] + w * vc[2]
    return (
        int(round(lin_to_srgb(float(lin[0])) * 255)),
        int(round(lin_to_srgb(float(lin[1])) * 255)),
        int(round(lin_to_srgb(float(lin[2])) * 255)),
    )
