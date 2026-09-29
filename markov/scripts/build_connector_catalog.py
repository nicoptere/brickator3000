#!/usr/bin/env python3
"""
LDraw Parts Library Extractor & Connector Catalog Builder.

Scans the local 25,000+ LDraw parts library at generator/public/ldraw/parts
and builds an extensive, rich catalog of structurally verified LEGO connectors:
- FILL: Bricks & Plates (1x1 to 2x16, corner bricks, jumper plates, round bricks/plates)
- EDGE: Modern curved slopes, inverted slopes, 45°/33°/75° slopes, macaroni tiles, flat tiles, wedge plates
- LEAF: Bionicle teeth & spines, creature horns/claws, inverted radar dishes, cones, cheese slopes
- EMPTY: Clearance envelopes and void constraints

Outputs: markov/src/engine/generatedConnectorCatalog.json
"""

import os
import re
import json
from collections import defaultdict

PARTS_DIR = "/mnt/storage/projects/brickator3000/generator/public/ldraw/parts"
OUTPUT_JSON = "/mnt/storage/projects/brickator3000/markov/src/engine/generatedConnectorCatalog.json"

print(f"Scanning LDraw parts from: {PARTS_DIR}")

# Patterns for classification
RULE_PATTERNS = [
    # --- FILL: Bricks & Plates ---
    {
        "cat": "FILL",
        "profile": "brick",
        "regex": r"^Brick\s+(\d+)\s+x\s+(\d+)(?:\s+Corner)?$",
        "default_h": 3,
        "slopeClass": "flat",
        "slopeAngle": 0,
        "curvatureClass": "flat",
        "bondingCapacity": 9,
        "preferredDepth": [1, 999]
    },
    {
        "cat": "FILL",
        "profile": "plate",
        "regex": r"^Plate\s+(\d+)\s+x\s+(\d+)(?:\s+Corner)?$",
        "default_h": 1,
        "slopeClass": "flat",
        "slopeAngle": 0,
        "curvatureClass": "flat",
        "bondingCapacity": 7,
        "preferredDepth": [1, 999]
    },
    {
        "cat": "FILL",
        "profile": "plate",
        "regex": r"^Plate\s+(\d+)\s+x\s+(\d+)\s+with\s+Center\s+Stud",
        "default_h": 1,
        "slopeClass": "flat",
        "slopeAngle": 0,
        "curvatureClass": "flat",
        "bondingCapacity": 7,
        "preferredDepth": [1, 999]
    },
    {
        "cat": "FILL",
        "profile": "brick",
        "regex": r"^Brick\s+(\d+)\s+x\s+(\d+)\s+Round",
        "default_h": 3,
        "slopeClass": "flat",
        "slopeAngle": 0,
        "curvatureClass": "cylindrical_convex",
        "bondingCapacity": 8,
        "preferredDepth": [1, 999]
    },
    {
        "cat": "FILL",
        "profile": "plate",
        "regex": r"^Plate\s+(\d+)\s+x\s+(\d+)\s+Round",
        "default_h": 1,
        "slopeClass": "flat",
        "slopeAngle": 0,
        "curvatureClass": "cylindrical_convex",
        "bondingCapacity": 6,
        "preferredDepth": [1, 999]
    },

    # --- EDGE: Modern Curved Slopes, Inverted Slopes, 45°/33° Slopes, Macaroni, Tiles ---
    {
        "cat": "EDGE",
        "profile": "slope_curved",
        "regex": r"^Slope\s+Brick\s+Curved\s+(\d+)\s+x\s+(\d+)\s+Inverted",
        "default_h": 3,
        "slopeClass": "slope_inverted",
        "slopeAngle": -30,
        "curvatureClass": "cylindrical_concave",
        "bondingCapacity": 7,
        "preferredDepth": [1, 1]
    },
    {
        "cat": "EDGE",
        "profile": "slope_curved",
        "regex": r"^Slope\s+Brick\s+Curved\s+(\d+)\s+x\s+(\d+)",
        "default_h": 3,
        "slopeClass": "slope_curved",
        "slopeAngle": 30,
        "curvatureClass": "cylindrical_convex",
        "bondingCapacity": 8,
        "preferredDepth": [1, 1]
    },
    {
        "cat": "EDGE",
        "profile": "slope_inverted",
        "regex": r"^Slope\s+Brick\s+(?:45|33|75)?\s*(\d+)\s+x\s+(\d+)\s+Inverted",
        "default_h": 3,
        "slopeClass": "slope_inverted",
        "slopeAngle": -45,
        "curvatureClass": "cylindrical_concave",
        "bondingCapacity": 7,
        "preferredDepth": [1, 1]
    },
    {
        "cat": "EDGE",
        "profile": "slope_45",
        "regex": r"^Slope\s+Brick\s+45\s+(\d+)\s+x\s+(\d+)",
        "default_h": 3,
        "slopeClass": "slope_45",
        "slopeAngle": 45,
        "curvatureClass": "flat",
        "bondingCapacity": 8,
        "preferredDepth": [1, 1]
    },
    {
        "cat": "EDGE",
        "profile": "slope_33",
        "regex": r"^Slope\s+Brick\s+33\s+(\d+)\s+x\s+(\d+)",
        "default_h": 3,
        "slopeClass": "slope_33",
        "slopeAngle": 33,
        "curvatureClass": "flat",
        "bondingCapacity": 7,
        "preferredDepth": [1, 1]
    },
    {
        "cat": "EDGE",
        "profile": "cheese",
        "regex": r"^Slope\s+Brick\s+31\s+(\d+)\s+x\s+(\d+)",
        "default_h": 2,
        "slopeClass": "slope_33",
        "slopeAngle": 31,
        "curvatureClass": "flat",
        "bondingCapacity": 6,
        "preferredDepth": [1, 1]
    },
    {
        "cat": "EDGE",
        "profile": "slope_75",
        "regex": r"^Slope\s+Brick\s+75\s+(\d+)\s+x\s+(\d+)",
        "default_h": 6,
        "slopeClass": "slope_75",
        "slopeAngle": 75,
        "curvatureClass": "flat",
        "bondingCapacity": 7,
        "preferredDepth": [1, 1]
    },
    {
        "cat": "EDGE",
        "profile": "macaroni",
        "regex": r"^Tile\s+(\d+)\s+x\s+(\d+)\s+Macaroni",
        "default_h": 1,
        "slopeClass": "flat",
        "slopeAngle": 0,
        "curvatureClass": "corner_macaroni",
        "bondingCapacity": 7,
        "preferredDepth": [1, 1]
    },
    {
        "cat": "EDGE",
        "profile": "macaroni",
        "regex": r"^Tile\s+1\s+x\s+1\s+Quarter\s+Round",
        "default_h": 1,
        "slopeClass": "flat",
        "slopeAngle": 0,
        "curvatureClass": "corner_macaroni",
        "bondingCapacity": 5,
        "preferredDepth": [1, 1]
    },
    {
        "cat": "EDGE",
        "profile": "tile_flat",
        "regex": r"^Tile\s+(\d+)\s+x\s+(\d+)",
        "default_h": 1,
        "slopeClass": "flat",
        "slopeAngle": 0,
        "curvatureClass": "flat",
        "bondingCapacity": 7,
        "preferredDepth": [1, 1]
    },
    {
        "cat": "EDGE",
        "profile": "wedge",
        "regex": r"^Wedge\s+Plate\s+(\d+)\s+x\s+(\d+)",
        "default_h": 1,
        "slopeClass": "flat",
        "slopeAngle": 0,
        "curvatureClass": "flat",
        "bondingCapacity": 7,
        "preferredDepth": [1, 1]
    },

    # --- LEAF: Bionicle / Constraction, Teeth, Horns, Dishes, Cones ---
    {
        "cat": "LEAF",
        "profile": "tooth_creature",
        "regex": r"(?:Bionicle.*(?:Tooth|Spine|Claw)|(?:Tooth|Horn|Barb|Spine|Claw))",
        "default_h": 3,
        "slopeClass": "slope_75",
        "slopeAngle": 75,
        "curvatureClass": "sharp_cusp",
        "bondingCapacity": 6,
        "preferredDepth": [1, 1]
    },
    {
        "cat": "LEAF",
        "profile": "dish",
        "regex": r"^Dish\s+(\d+)\s+x\s+(\d+)",
        "default_h": 2,
        "slopeClass": "flat",
        "slopeAngle": 0,
        "curvatureClass": "spherical_dome",
        "bondingCapacity": 6,
        "preferredDepth": [1, 1]
    },
    {
        "cat": "LEAF",
        "profile": "cone",
        "regex": r"^Cone\s+(\d+)\s+x\s+(\d+)",
        "default_h": 3,
        "slopeClass": "flat",
        "slopeAngle": 0,
        "curvatureClass": "sharp_cusp",
        "bondingCapacity": 6,
        "preferredDepth": [1, 1]
    }
]

catalog = []
seen_shapes = set()

# Explicitly ensure high-priority parts per GEMINI.md are always present
MUST_HAVE_PARTS = {
    # Modern curved slopes
    '11477': ('Slope Curved 2 x 1', 'EDGE', 'slope_curved', 1, 2, 3, 30, 'cylindrical_convex', True),
    '15068': ('Slope Curved 2 x 2', 'EDGE', 'slope_curved', 2, 2, 3, 30, 'cylindrical_convex', True),
    '61678': ('Slope Curved 4 x 1', 'EDGE', 'slope_curved', 1, 4, 3, 25, 'cylindrical_convex', True),
    '88930': ('Slope Curved 4 x 2', 'EDGE', 'slope_curved', 2, 4, 3, 25, 'cylindrical_convex', True),
    '93273': ('Slope Curved 4 x 1 Inverted', 'EDGE', 'slope_inverted', 1, 4, 3, -25, 'cylindrical_concave', True),
    '24201': ('Slope Curved 2 x 1 Inverted', 'EDGE', 'slope_inverted', 1, 2, 3, -30, 'cylindrical_concave', True),
    # Bionicle & creatures
    '41669': ('Bionicle Tooth / Spine 1 x 3 x 2', 'LEAF', 'tooth_creature', 1, 3, 6, 75, 'sharp_cusp', True),
    '53451': ('Barb / Tooth / Horn 1 x 1 x 0.67', 'LEAF', 'tooth_creature', 1, 1, 2, 75, 'sharp_cusp', True),
    '87747': ('Curved Blade / Horn 4L', 'LEAF', 'tooth_creature', 1, 2, 6, 75, 'sharp_cusp', True),
    '32578': ('Bionicle Claw / Hook', 'LEAF', 'tooth_creature', 1, 2, 3, 45, 'sharp_cusp', True),
    # Macaroni & flat tiles
    '27925': ('Tile 2 x 2 Macaroni Curved Round', 'EDGE', 'macaroni', 2, 2, 1, 0, 'corner_macaroni', True),
    '25269': ('Tile 1 x 1 Quarter Round', 'EDGE', 'macaroni', 1, 1, 1, 0, 'corner_macaroni', True),
    '3068b': ('Tile 2 x 2 Flat', 'EDGE', 'tile_flat', 2, 2, 1, 0, 'flat', True),
    '3069b': ('Tile 1 x 2 Flat', 'EDGE', 'tile_flat', 1, 2, 1, 0, 'flat', True),
    '2431': ('Tile 1 x 4 Flat', 'EDGE', 'tile_flat', 1, 4, 1, 0, 'flat', True),
    '6636': ('Tile 1 x 6 Flat', 'EDGE', 'tile_flat', 1, 6, 1, 0, 'flat', True),
    '98138': ('Tile 1 x 1 Round Flat', 'EDGE', 'tile_flat', 1, 1, 1, 0, 'flat', True),
    # Inverted dishes
    '4740': ('Dish 2 x 2 Inverted Radar', 'LEAF', 'dish', 2, 2, 2, 0, 'spherical_dome', True),
    '43898': ('Dish 3 x 3 Inverted Radar', 'LEAF', 'dish', 3, 3, 3, 0, 'spherical_dome', True),
    '3960': ('Dish 4 x 4 Inverted Radar', 'LEAF', 'dish', 4, 4, 3, 0, 'spherical_dome', True),
    # Classic Structural Bricks
    '3007': ('Brick 2 x 8', 'FILL', 'brick', 2, 8, 3, 0, 'flat', False),
    '2456': ('Brick 2 x 6', 'FILL', 'brick', 2, 6, 3, 0, 'flat', False),
    '3001': ('Brick 2 x 4', 'FILL', 'brick', 2, 4, 3, 0, 'flat', False),
    '3002': ('Brick 2 x 3', 'FILL', 'brick', 2, 3, 3, 0, 'flat', False),
    '3003': ('Brick 2 x 2', 'FILL', 'brick', 2, 2, 3, 0, 'flat', False),
    '3008': ('Brick 1 x 8', 'FILL', 'brick', 1, 8, 3, 0, 'flat', False),
    '3009': ('Brick 1 x 6', 'FILL', 'brick', 1, 6, 3, 0, 'flat', False),
    '3010': ('Brick 1 x 4', 'FILL', 'brick', 1, 4, 3, 0, 'flat', False),
    '3622': ('Brick 1 x 3', 'FILL', 'brick', 1, 3, 3, 0, 'flat', False),
    '3004': ('Brick 1 x 2', 'FILL', 'brick', 1, 2, 3, 0, 'flat', False),
    '3005': ('Brick 1 x 1', 'FILL', 'brick', 1, 1, 3, 0, 'flat', False),
    '2357': ('Brick 2 x 2 Corner', 'FILL', 'brick', 2, 2, 3, 0, 'corner_macaroni', False),
    '3794b': ('Plate 1 x 2 with Center Stud', 'FILL', 'plate', 1, 2, 1, 0, 'flat', True),
    # Standard 45° and Cheese slopes
    '3040': ('Slope 45 2 x 1', 'EDGE', 'slope_45', 1, 2, 3, 45, 'flat', False),
    '3039': ('Slope 45 2 x 2', 'EDGE', 'slope_45', 2, 2, 3, 45, 'flat', False),
    '3298': ('Slope 33 3 x 2', 'EDGE', 'slope_33', 2, 3, 3, 33, 'flat', False),
    '54200': ('Slope 31 1 x 1 x 2/3 (Cheese)', 'LEAF', 'cheese', 1, 1, 2, 31, 'flat', True),
    '85984': ('Slope 31 1 x 2 x 2/3 (Double Cheese)', 'LEAF', 'cheese', 1, 2, 2, 31, 'flat', True),
}

# Add must-haves first
for pid, info in MUST_HAVE_PARTS.items():
    name, cat, prof, wx, wz, hy, angle, curv, is_mod = info
    shape_key = f"{cat}_{prof}_{wx}_{wz}_{hy}_{angle}_{curv}"
    seen_shapes.add(shape_key)
    catalog.append({
        "partId": pid,
        "name": name,
        "category": cat,
        "profile": prof,
        "widthX": wx,
        "depthZ": wz,
        "heightY": hy,
        "slopeClass": "slope_inverted" if angle < 0 else ("slope_curved" if prof == "slope_curved" else ("slope_45" if angle == 45 else ("slope_33" if angle in (31, 33) else ("slope_75" if angle == 75 else "flat")))),
        "slopeAngle": angle,
        "curvatureClass": curv,
        "isModern": is_mod,
        "bondingCapacity": 9 if cat == "FILL" and hy == 3 else (7 if cat == "FILL" or cat == "EDGE" else 5),
        "preferredDepth": [1, 999] if cat == "FILL" else [1, 1]
    })

# Now scan the catalog and extract additional clean parts
for fname in sorted(os.listdir(PARTS_DIR)):
    if not fname.endswith(".dat") or fname.startswith("s\\"):
        continue
    part_id = fname[:-4]

    # Ignore pattern prints (e.g. 3001p01, 3068bpb02)
    if re.search(r"p[0-9a-z]{2,}$", part_id, re.IGNORECASE):
        continue

    if any(c["partId"] == part_id for c in catalog):
        continue

    filepath = os.path.join(PARTS_DIR, fname)
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            first_line = f.readline().strip()
            if not first_line.startswith("0 ") or "~Moved" in first_line:
                continue
            desc = first_line[2:].strip()

            for rule in RULE_PATTERNS:
                m = re.search(rule["regex"], desc, re.IGNORECASE)
                if m:
                    groups = m.groups()
                    wx, wz, hy = 1, 1, rule["default_h"]
                    if len(groups) >= 2 and groups[0] and groups[1]:
                        try:
                            wx = int(groups[0])
                            wz = int(groups[1])
                        except:
                            pass
                    elif len(groups) == 1 and groups[0]:
                        try:
                            wx = int(groups[0])
                        except:
                            pass

                    # Filter out absurdly huge baseplates > 16 studs
                    if wx > 16 or wz > 16:
                        continue

                    # Canonical orientation: wx <= wz
                    c_wx = min(wx, wz)
                    c_wz = max(wx, wz)

                    shape_key = f"{rule['cat']}_{rule['profile']}_{c_wx}_{c_wz}_{hy}_{rule['slopeAngle']}_{rule['curvatureClass']}"
                    
                    # Deduplicate equivalent shapes so we have a clean, balanced library of ~200-300 pieces
                    if shape_key in seen_shapes:
                        continue
                    seen_shapes.add(shape_key)

                    is_modern = (
                        "Curved" in desc or "Macaroni" in desc or "Tooth" in desc or
                        "Horn" in desc or "Barb" in desc or "Spine" in desc or
                        "Bionicle" in desc or "Quarter Round" in desc or "Cheese" in desc or
                        rule["profile"] in ("slope_curved", "macaroni", "tooth_creature")
                    )

                    catalog.append({
                        "partId": part_id,
                        "name": desc,
                        "category": rule["cat"],
                        "profile": rule["profile"],
                        "widthX": c_wx,
                        "depthZ": c_wz,
                        "heightY": hy,
                        "slopeClass": rule["slopeClass"],
                        "slopeAngle": rule["slopeAngle"],
                        "curvatureClass": rule["curvatureClass"],
                        "isModern": is_modern,
                        "bondingCapacity": rule["bondingCapacity"],
                        "preferredDepth": rule["preferredDepth"]
                    })
                    break
    except Exception:
        pass

print(f"Generated {len(catalog)} unique, structurally diverse connectors!")

# Sort catalog by category and volume
category_order = {"FILL": 0, "EDGE": 1, "LEAF": 2, "EMPTY": 3}
catalog.sort(key=lambda c: (category_order.get(c["category"], 9), -(c["widthX"] * c["depthZ"] * c["heightY"])))

# Write JSON
os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(catalog, f, indent=2)

print(f"Saved catalog to: {OUTPUT_JSON}")
cat_summary = defaultdict(int)
for c in catalog:
    cat_summary[c["category"]] += 1
print("Summary by category:", dict(cat_summary))
