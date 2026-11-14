"""Official LDraw color parser and CIE Lab / CIEDE2000 perceptual palette snapper."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Iterable


def srgb_to_lin(c: float) -> float:
    c = max(0.0, min(1.0, float(c)))
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin_to_srgb(c: float) -> float:
    c = max(0.0, min(1.0, float(c)))
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1.0 / 2.4)) - 0.055


def rgb_to_lab(rgb: Iterable[float]) -> list[float]:
    r0, g0, b0 = rgb
    r = srgb_to_lin(r0 / 255.0)
    g = srgb_to_lin(g0 / 255.0)
    b = srgb_to_lin(b0 / 255.0)
    x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883
    f = lambda t: t ** (1.0 / 3.0) if t > 0.008856 else 7.787 * t + 16.0 / 116.0
    fx, fy, fz = f(x), f(y), f(z)
    return [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]


def ciede2000(lab1: list[float], lab2: list[float]) -> float:
    L1, a1, b1 = lab1
    L2, a2, b2 = lab2
    C1 = math.hypot(a1, b1)
    C2 = math.hypot(a2, b2)
    Cb = 0.5 * (C1 + C2)
    Cb7 = Cb**7
    G = 0.5 * (1.0 - math.sqrt(Cb7 / (Cb7 + 25.0**7)))
    a1p = (1.0 + G) * a1
    a2p = (1.0 + G) * a2
    C1p = math.hypot(a1p, b1)
    C2p = math.hypot(a2p, b2)

    def _hp(b: float, a: float) -> float:
        return 0.0 if (b == 0.0 and a == 0.0) else (math.degrees(math.atan2(b, a)) + 360.0) % 360.0

    h1p, h2p = _hp(b1, a1p), _hp(b2, a2p)
    dLp = L2 - L1
    dCp = C2p - C1p
    if C1p * C2p == 0.0:
        dhp = 0.0
    elif abs(h2p - h1p) <= 180.0:
        dhp = h2p - h1p
    elif h2p - h1p > 180.0:
        dhp = h2p - h1p - 360.0
    else:
        dhp = h2p - h1p + 360.0

    dHp = 2.0 * math.sqrt(C1p * C2p) * math.sin(math.radians(0.5 * dhp))
    Lbp = 0.5 * (L1 + L2)
    Cbp = 0.5 * (C1p + C2p)
    if C1p * C2p == 0.0:
        hbp = h1p + h2p
    elif abs(h1p - h2p) <= 180.0:
        hbp = 0.5 * (h1p + h2p)
    elif h1p + h2p < 360.0:
        hbp = 0.5 * (h1p + h2p + 360.0)
    else:
        hbp = 0.5 * (h1p + h2p - 360.0)

    T = (
        1.0
        - 0.17 * math.cos(math.radians(hbp - 30.0))
        + 0.24 * math.cos(math.radians(2.0 * hbp))
        + 0.32 * math.cos(math.radians(3.0 * hbp + 6.0))
        - 0.20 * math.cos(math.radians(4.0 * hbp - 63.0))
    )
    dTheta = 30.0 * math.exp(-(((hbp - 275.0) / 25.0) ** 2))
    Cbp7 = Cbp**7
    RC = 2.0 * math.sqrt(Cbp7 / (Cbp7 + 25.0**7))
    Lm50_2 = (Lbp - 50.0) ** 2
    SL = 1.0 + (0.015 * Lm50_2) / math.sqrt(20.0 + Lm50_2)
    SC = 1.0 + 0.045 * Cbp
    SH = 1.0 + 0.015 * Cbp * T
    RT = -math.sin(math.radians(2.0 * dTheta)) * RC
    return math.sqrt(
        (dLp / SL) ** 2
        + (dCp / SC) ** 2
        + (dHp / SH) ** 2
        + RT * (dCp / SC) * (dHp / SH)
    )


def parse_ldconfig(text: str) -> list[dict]:
    """Parse opaque solid colors from LDraw `LDConfig.ldr`."""
    pat = re.compile(
        r"^0\s+!COLOUR\s+(\S+)\s+CODE\s+(\d+)\s+VALUE\s+(#[0-9A-Fa-f]{6})\s+EDGE\s+(#[0-9A-Fa-f]{6})(.*)$"
    )
    colors = []
    for raw in text.splitlines():
        line = raw.strip()
        m = pat.match(line)
        if not m:
            continue
        raw_name, code_s, hex_col, edge_col, rest = m.groups()
        code = int(code_s)
        if code in (16, 24) or re.search(
            r"\b(ALPHA|LUMINANCE|CHROME|PEARLESCENT|METAL|GLITTER|SPECKLE|RUBBER)\b", rest
        ):
            continue
        h = hex_col[1:]
        rgb = [int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)]
        colors.append(
            {
                "code": code,
                "name": raw_name.replace("_", " "),
                "ldraw_name": raw_name,
                "hex": hex_col.upper(),
                "edge": edge_col.upper(),
                "rgb": rgb,
                "lab": rgb_to_lab(rgb),
            }
        )
    return colors


FALLBACK_COLORS = [
    {"code": 0, "name": "Black", "hex": "#1B2A34", "rgb": [27, 42, 52]},
    {"code": 1, "name": "Blue", "hex": "#1E5AA8", "rgb": [30, 90, 168]},
    {"code": 2, "name": "Green", "hex": "#00852B", "rgb": [0, 133, 43]},
    {"code": 4, "name": "Red", "hex": "#B40000", "rgb": [180, 0, 0]},
    {"code": 14, "name": "Yellow", "hex": "#FAC80A", "rgb": [250, 200, 10]},
    {"code": 15, "name": "White", "hex": "#F4F4F4", "rgb": [244, 244, 244]},
    {"code": 19, "name": "Tan", "hex": "#DEC69C", "rgb": [222, 198, 156]},
    {"code": 25, "name": "Orange", "hex": "#FE8A18", "rgb": [254, 138, 24]},
    {"code": 28, "name": "Dark Tan", "hex": "#B89869", "rgb": [184, 152, 105]},
    {"code": 70, "name": "Reddish Brown", "hex": "#582A12", "rgb": [88, 42, 18]},
    {"code": 71, "name": "Light Bluish Gray", "hex": "#A0A5A9", "rgb": [160, 165, 169]},
    {"code": 72, "name": "Dark Bluish Gray", "hex": "#6C6E68", "rgb": [108, 110, 104]},
]
for _c in FALLBACK_COLORS:
    _c["lab"] = rgb_to_lab(_c["rgb"])


def load_colors(path: str | Path) -> list[dict]:
    p = Path(path)
    if p.suffix.lower() == ".ldr":
        return parse_ldconfig(p.read_text(encoding="utf-8", errors="ignore"))
    doc = json.loads(p.read_text(encoding="utf-8"))
    arr = doc if isinstance(doc, list) else doc.get("colors", FALLBACK_COLORS)
    for c in arr:
        if "lab" not in c:
            c["lab"] = rgb_to_lab(c["rgb"])
    return arr


class Palette:
    """Fast cached CIEDE2000 color matcher to official LDraw colors."""

    def __init__(self, colors: list[dict] | None = None):
        self.list = [
            {**c, "lab": c.get("lab") or rgb_to_lab(c["rgb"])}
            for c in (colors or FALLBACK_COLORS)
        ]
        self._cache: dict[tuple[int, int, int], dict] = {}

    def snap(self, rgb: Iterable[float]) -> dict:
        r = max(0, min(255, int(round(rgb[0]))))
        g = max(0, min(255, int(round(rgb[1]))))
        b = max(0, min(255, int(round(rgb[2]))))
        key = (r, g, b)
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        lab = rgb_to_lab(key)
        best = min(self.list, key=lambda c: ciede2000(lab, c["lab"]))
        self._cache[key] = best
        return best
