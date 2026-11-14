"""End-to-End BrickPack Python Engine (mesh or SDF -> official-color LEGO bricks)."""

from __future__ import annotations

import time
from typing import Any

from .catalog import PACK_KINDS, build_variants
from .colors import FALLBACK_COLORS, Palette
from .mesh_io import nearest_triangle_color
from .policy import POLICY
from .solver import fidelity, pack_iou
from .target import frame_for, gaussian_octaves, target_field, target_from_sdf_volume, thicken_thin
from .units import H, PLATE, STUD


EFFORT = {
    "quick": {"lnsPasses": 2, "lnsIters": 600, "thetaIters": 3, "thetaLns": 120},
    "normal": {"lnsPasses": 6, "lnsIters": 2000, "thetaIters": 4, "thetaLns": 250},
    "thorough": {"lnsPasses": 12, "lnsIters": 4500, "thetaIters": 5, "thetaLns": 450},
}


def _colorize_pieces(
    pieces: list[dict],
    by_key: dict,
    model: dict[str, Any] | None,
    frame: dict[str, Any],
    phase: list[int],
    palette: Palette,
    default_rgb: tuple[int, int, int] = (160, 165, 169),
) -> list[dict]:
    ox = phase[0] * H if phase else 0.0
    oz = phase[1] * H if phase else 0.0
    fallback = palette.snap(default_rgb)
    if model is None or not model.get("has_color") or len(model.get("tris", [])) == 0:
        return [
            {
                **p,
                "code": fallback["code"],
                "colorName": fallback["name"],
                "hex": fallback["hex"],
                "rgb": tuple(fallback["rgb"]),
            }
            for p in pieces
        ]

    k, t = frame["k"], frame["t"]
    out = []
    for p in pieces:
        bx = (p["i"] + p["w"] * 0.5) * STUD + ox
        by = (p["b"] + p["h"] * 0.5) * PLATE
        bz = (p["j"] + p["d"] * 0.5) * STUD + oz
        query = ((bx - t[0]) / k, (by - t[1]) / k, (bz - t[2]) / k)
        srgb = nearest_triangle_color(query, model)
        col = palette.snap(srgb)
        out.append({
            **p,
            "code": col["code"],
            "colorName": col["name"],
            "hex": col["hex"],
            "rgb": tuple(col["rgb"]),
        })
    return out


def pack_model(
    input_data: dict[str, Any] | tuple[dict[str, Any], Any],
    catalog: list[dict],
    studs: int = 16,
    effort: str = "normal",
    colors: list[dict] | None = None,
    policy_override: dict[str, Any] | None = None,
    keep_thin: bool = True,
    ref: str = "min3",
) -> dict[str, Any]:
    if not catalog:
        raise ValueError("pack_model requires a non-empty catalog")
    t0 = time.perf_counter()
    eff = EFFORT.get(effort, EFFORT["normal"])
    policy = {**POLICY, "lnsIters": eff["lnsIters"], "lnsPasses": eff["lnsPasses"], **(policy_override or {})}

    model = None
    if isinstance(input_data, tuple) and len(input_data) == 2:
        hdr, data = input_data
        T = target_from_sdf_volume(hdr, data, studs=studs, ref=ref)
    elif isinstance(input_data, dict) and "header" in input_data and "data" in input_data:
        T = target_from_sdf_volume(input_data["header"], input_data["data"], studs=studs, ref=ref)
    else:
        model = input_data
        frame = frame_for(model, studs=studs, ref=ref)
        T = target_field(model, frame)

    thin = thicken_thin(T) if keep_thin else None
    TP = {**T, "t": thin["t"]} if (thin and thin["added"]) else T
    F = gaussian_octaves(TP, core_octave=int(policy.get("coreOctave", 1)))
    t1 = time.perf_counter()

    by_key, variants = build_variants(catalog, kinds=PACK_KINDS)
    best = pack_iou(
        TP, F, variants, by_key,
        policy=policy,
        theta_iters=eff["thetaIters"],
        theta_lns=eff["thetaLns"],
        phase=thin["phase"] if (thin and thin["added"]) else None,
    )
    lay = best["r"]
    metrics = fidelity(lay["pieces"], by_key, T, lay["phase"])
    t2 = time.perf_counter()

    pal = Palette(colors or FALLBACK_COLORS)
    colored = _colorize_pieces(lay["pieces"], by_key, model, T["frame"], lay["phase"], pal)
    t3 = time.perf_counter()

    return {
        "pieces": colored,
        "frame": T["frame"],
        "phase": lay["phase"],
        "target": T,
        "pack": {
            "theta": round(float(best["theta"]), 4),
            "trace": best["trace"],
            "pieces": metrics["pieces"],
            "softIoU": round(float(metrics["softIoU"]), 4),
            "l1": round(float(metrics["l1"]), 4),
            "components": metrics["components"],
            "ms": {
                "target": int(round((t1 - t0) * 1000)),
                "search": int(round((t2 - t1) * 1000)),
                "finish": int(round((t3 - t2) * 1000)),
                "total": int(round((t3 - t0) * 1000)),
            },
        },
    }
