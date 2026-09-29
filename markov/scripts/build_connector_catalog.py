#!/usr/bin/env python3
"""
LDraw LEGO SYSTEM Parts Library Extractor & Connector Catalog Builder.

Scans the 25,000+ LDraw parts library at generator/public/ldraw/parts
and builds an extensive, rich catalog of authentic LEGO SYSTEM pieces:
- FILL: Classic & Modern Bricks & Plates (1x1 to 2x16, corner bricks, jumper plates, round bricks/plates)
- EDGE: Modern curved slopes, inverted slopes, 45°/33°/75° slopes, macaroni tiles, flat tiles, wedge plates
- LEAF: Authentic SYSTEM inverted radar dishes, domes, cheese slopes, cones, round caps
- ZERO BIONICLE / CONSTRACTION / CREATURE PARTS

Outputs: markov/src/engine/generatedConnectorCatalog.json
"""

import os
import re
import json
from collections import defaultdict

PARTS_DIR = "/mnt/storage/projects/brickator3000/generator/public/ldraw/parts"
OUTPUT_JSON = "/mnt/storage/projects/brickator3000/markov/src/engine/generatedConnectorCatalog.json"

print(f"Scanning LDraw LEGO SYSTEM parts from: {PARTS_DIR}")

# Strict ban list: zero bionicle / constraction / creature / weapon / minifig body parts
BANNED_KEYWORDS = [
    'bionicle', 'hero factory', 'constraction', 'ccbs', 'kanohi', 'mask', 'kraata', 
    'toad', 'claw', 'fang', 'horn', 'barb', 'tooth', 'spine', 'blade', 'weapon', 
    'sword', 'gun', 'blaster', 'minifig', 'figure', 'torso', 'arm', 'leg', 'head',
    'helmet', 'hair', 'cloth', 'cape', 'sail', 'technic gear', 'shock absorber'
]

# Explicit must-have core LEGO SYSTEM pieces
MUST_HAVE_PARTS = {
    # Modern curved slopes
    '11477': ('Slope Brick Curved 2 x 1', 'EDGE', 'slope_curved', 1, 2, 3, 30, 'cylindrical_convex', True),
    '15068': ('Slope Brick Curved 2 x 2', 'EDGE', 'slope_curved', 2, 2, 3, 30, 'cylindrical_convex', True),
    '61678': ('Slope Brick Curved 4 x 1', 'EDGE', 'slope_curved', 1, 4, 3, 25, 'cylindrical_convex', True),
    '88930': ('Slope Brick Curved 4 x 2', 'EDGE', 'slope_curved', 2, 4, 3, 25, 'cylindrical_convex', True),
    '93273': ('Slope Brick Curved 4 x 1 Inverted', 'EDGE', 'slope_inverted', 1, 4, 3, -25, 'cylindrical_concave', True),
    '24201': ('Slope Brick Curved 2 x 1 Inverted', 'EDGE', 'slope_inverted', 1, 2, 3, -30, 'cylindrical_concave', True),
    # Macaroni & round corner tiles
    '27925': ('Tile 2 x 2 Macaroni Curved Round', 'EDGE', 'macaroni', 2, 2, 1, 0, 'corner_macaroni', True),
    '25269': ('Tile 1 x 1 Quarter Round', 'EDGE', 'macaroni', 1, 1, 1, 0, 'corner_macaroni', True),
    '3068b': ('Tile 2 x 2 Flat', 'EDGE', 'tile_flat', 2, 2, 1, 0, 'flat', True),
    '3069b': ('Tile 1 x 2 Flat', 'EDGE', 'tile_flat', 1, 2, 1, 0, 'flat', True),
    '2431': ('Tile 1 x 4 Flat', 'EDGE', 'tile_flat', 1, 4, 1, 0, 'flat', True),
    '6636': ('Tile 1 x 6 Flat', 'EDGE', 'tile_flat', 1, 6, 1, 0, 'flat', True),
    '98138': ('Tile 1 x 1 Round Flat', 'EDGE', 'tile_flat', 1, 1, 1, 0, 'flat', True),
    # Authentic System Radar dishes & domes
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
    # Classic Plates
    '3034': ('Plate 2 x 8', 'FILL', 'plate', 2, 8, 1, 0, 'flat', False),
    '3795': ('Plate 2 x 6', 'FILL', 'plate', 2, 6, 1, 0, 'flat', False),
    '3020': ('Plate 2 x 4', 'FILL', 'plate', 2, 4, 1, 0, 'flat', False),
    '3021': ('Plate 2 x 3', 'FILL', 'plate', 2, 3, 1, 0, 'flat', False),
    '3022': ('Plate 2 x 2', 'FILL', 'plate', 2, 2, 1, 0, 'flat', False),
    '3460': ('Plate 1 x 8', 'FILL', 'plate', 1, 8, 1, 0, 'flat', False),
    '3666': ('Plate 1 x 6', 'FILL', 'plate', 1, 6, 1, 0, 'flat', False),
    '3710': ('Plate 1 x 4', 'FILL', 'plate', 1, 4, 1, 0, 'flat', False),
    '3623': ('Plate 1 x 3', 'FILL', 'plate', 1, 3, 1, 0, 'flat', False),
    '3023': ('Plate 1 x 2', 'FILL', 'plate', 1, 2, 1, 0, 'flat', False),
    '3024': ('Plate 1 x 1', 'FILL', 'plate', 1, 1, 1, 0, 'flat', False),
    # Standard Slopes & Cheese
    '3040': ('Slope Brick 45 2 x 1', 'EDGE', 'slope_45', 1, 2, 3, 45, 'flat', False),
    '3039': ('Slope Brick 45 2 x 2', 'EDGE', 'slope_45', 2, 2, 3, 45, 'flat', False),
    '3038': ('Slope Brick 45 2 x 3', 'EDGE', 'slope_45', 2, 3, 3, 45, 'flat', False),
    '3298': ('Slope Brick 33 3 x 2', 'EDGE', 'slope_33', 2, 3, 3, 33, 'flat', False),
    '54200': ('Slope Brick 31 1 x 1 x 0.667 (Cheese)', 'LEAF', 'cheese', 1, 1, 2, 31, 'flat', True),
    '85984': ('Slope Brick 31 1 x 2 x 0.667 (Double Cheese)', 'LEAF', 'cheese', 1, 2, 2, 31, 'flat', True),
}

catalog = []
seen_part_ids = set()

# 1. Insert Must-Haves
for pid, info in MUST_HAVE_PARTS.items():
    name, cat, prof, wx, wz, hy, angle, curv, is_mod = info
    seen_part_ids.add(pid)
    catalog.append({
        "partId": pid,
        "name": name,
        "category": cat,
        "profile": prof,
        "widthX": min(wx, wz),
        "depthZ": max(wx, wz),
        "heightY": hy,
        "slopeClass": "slope_inverted" if angle < 0 else ("slope_curved" if prof == "slope_curved" else ("slope_45" if angle == 45 else ("slope_33" if angle in (31, 33) else "flat"))),
        "slopeAngle": angle,
        "curvatureClass": curv,
        "isModern": is_mod,
        "bondingCapacity": 9 if cat == "FILL" and hy == 3 else (7 if cat == "FILL" or cat == "EDGE" else 5),
        "preferredDepth": [1, 999] if cat == "FILL" else [1, 1]
    })

# 2. Scan entire parts directory for authentic LEGO SYSTEM parts
for fname in sorted(os.listdir(PARTS_DIR)):
    if not fname.endswith(".dat") or fname.startswith("s\\"):
        continue
    part_id = fname[:-4]

    # Ignore pattern prints / stickers (e.g. 3001p01)
    if re.search(r"p[0-9a-z]{2,}$", part_id, re.IGNORECASE):
        continue
    # Require standard part ID format (numbers + optional 1 letter, e.g. 3068b)
    if not re.match(r"^\d{3,6}[a-z0-9]?$", part_id, re.I):
        continue

    if part_id in seen_part_ids:
        continue

    filepath = os.path.join(PARTS_DIR, fname)
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            first_line = f.readline().strip()
            if not first_line.startswith("0 ") or "~Moved" in first_line:
                continue
            desc = first_line[2:].strip()

            # Check banned keywords (Zero Bionicle / Constraction / Creature)
            desc_lower = desc.lower()
            if any(b in desc_lower for b in BANNED_KEYWORDS):
                continue

            cat = None
            prof = "brick"
            wx, wz, hy = 1, 1, 3
            slope_class = "flat"
            slope_angle = 0
            curv_class = "flat"
            bonding = 7
            is_modern = False

            # Match Bricks
            m_brick = re.search(r"^Brick\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*x\s*(\d+(?:\.\d+)?))?", desc, re.I)
            if m_brick:
                cat = "FILL"
                prof = "brick"
                wx = int(float(m_brick.group(1)))
                wz = int(float(m_brick.group(2)))
                if m_brick.group(3):
                    hy = max(1, round(float(m_brick.group(3)) * 3))
                else:
                    hy = 3
                if "Round" in desc:
                    curv_class = "cylindrical_convex"
                elif "Corner" in desc:
                    curv_class = "corner_macaroni"
                bonding = 9 if hy >= 3 else 7

            # Match Plates
            m_plate = re.search(r"^Plate\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*x\s*(\d+(?:\.\d+)?))?", desc, re.I)
            if not cat and m_plate:
                cat = "FILL"
                prof = "plate"
                wx = int(float(m_plate.group(1)))
                wz = int(float(m_plate.group(2)))
                hy = 1
                if "Round" in desc:
                    curv_class = "cylindrical_convex"
                bonding = 7

            # Match Slopes & Curved Slopes
            m_slope = re.search(r"^Slope(?:\s+Brick)?\s*(?:Curved\s+)?(\d+)?\s*x?\s*(\d+)?", desc, re.I)
            if not cat and (m_slope or desc.startswith("Slope")):
                cat = "EDGE"
                is_inv = "Inverted" in desc
                is_curved = "Curved" in desc

                # Dimensions
                nums = re.findall(r"\b(\d+)\s*x\s*(\d+)\b", desc)
                if nums:
                    wx = int(nums[0][0])
                    wz = int(nums[0][1])
                else:
                    wx, wz = 1, 2

                hy = 3
                if "0.667" in desc or "31" in desc or "Cheese" in desc:
                    hy = 2
                    prof = "cheese"
                    slope_class = "slope_33"
                    slope_angle = 31
                    cat = "LEAF"
                elif is_curved and is_inv:
                    prof = "slope_inverted"
                    slope_class = "slope_inverted"
                    slope_angle = -30
                    curv_class = "cylindrical_concave"
                    is_modern = True
                elif is_curved:
                    prof = "slope_curved"
                    slope_class = "slope_curved"
                    slope_angle = 30
                    curv_class = "cylindrical_convex"
                    is_modern = True
                elif is_inv:
                    prof = "slope_inverted"
                    slope_class = "slope_inverted"
                    slope_angle = -45
                    curv_class = "cylindrical_concave"
                elif "33" in desc:
                    prof = "slope_33"
                    slope_class = "slope_33"
                    slope_angle = 33
                elif "75" in desc:
                    prof = "slope_75"
                    slope_class = "slope_75"
                    slope_angle = 75
                    hy = 6
                else:
                    prof = "slope_45"
                    slope_class = "slope_45"
                    slope_angle = 45
                bonding = 8

            # Match Tiles & Macaroni
            m_tile = re.search(r"^Tile\s+(\d+)\s*x\s*(\d+)", desc, re.I)
            if not cat and (m_tile or desc.startswith("Tile")):
                cat = "EDGE"
                nums = re.findall(r"\b(\d+)\s*x\s*(\d+)\b", desc)
                if nums:
                    wx = int(nums[0][0])
                    wz = int(nums[0][1])
                else:
                    wx, wz = 1, 1
                hy = 1
                if "Macaroni" in desc or "Quarter Round" in desc:
                    prof = "macaroni"
                    curv_class = "corner_macaroni"
                    is_modern = True
                else:
                    prof = "tile_flat"
                    curv_class = "cylindrical_convex" if "Round" in desc else "flat"
                bonding = 7

            # Match Wedges
            if not cat and desc.startswith("Wedge"):
                cat = "EDGE"
                prof = "wedge"
                nums = re.findall(r"\b(\d+)\s*x\s*(\d+)\b", desc)
                if nums:
                    wx = int(nums[0][0])
                    wz = int(nums[0][1])
                else:
                    wx, wz = 2, 3
                hy = 1 if "Plate" in desc else 3
                bonding = 7

            # Match Dishes & Domes
            if not cat and (desc.startswith("Dish") or desc.startswith("Dome")):
                cat = "LEAF"
                prof = "dish"
                nums = re.findall(r"\b(\d+)\s*x\s*(\d+)\b", desc)
                if nums:
                    wx = int(nums[0][0])
                    wz = int(nums[0][1])
                else:
                    wx, wz = 2, 2
                hy = 2 if desc.startswith("Dish") else 3
                curv_class = "spherical_dome"
                bonding = 6
                is_modern = True

            # Match Cones & Cylinders
            if not cat and (desc.startswith("Cone") or desc.startswith("Cylinder")):
                cat = "LEAF"
                prof = "cone"
                nums = re.findall(r"\b(\d+)\s*x\s*(\d+)\b", desc)
                if nums:
                    wx = int(nums[0][0])
                    wz = int(nums[0][1])
                else:
                    wx, wz = 1, 1
                hy = 3
                curv_class = "sharp_cusp" if desc.startswith("Cone") else "cylindrical_convex"
                bonding = 6

            # If matched and reasonable dimensions
            if cat and 1 <= wx <= 16 and 1 <= wz <= 16 and 1 <= hy <= 15:
                c_wx = min(wx, wz)
                c_wz = max(wx, wz)
                seen_part_ids.add(part_id)
                catalog.append({
                    "partId": part_id,
                    "name": desc,
                    "category": cat,
                    "profile": prof,
                    "widthX": c_wx,
                    "depthZ": c_wz,
                    "heightY": hy,
                    "slopeClass": slope_class,
                    "slopeAngle": slope_angle,
                    "curvatureClass": curv_class,
                    "isModern": is_modern,
                    "bondingCapacity": bonding,
                    "preferredDepth": [1, 999] if cat == "FILL" else [1, 1]
                })

    except Exception:
        pass

# Sort catalog by category and volume
category_order = {"FILL": 0, "EDGE": 1, "LEAF": 2, "EMPTY": 3}
catalog.sort(key=lambda c: (category_order.get(c["category"], 9), -(c["widthX"] * c["depthZ"] * c["heightY"])))

print(f"Generated {len(catalog)} official LEGO SYSTEM connectors (Zero Bionicle)!")

cat_summary = defaultdict(int)
for c in catalog:
    cat_summary[c["category"]] += 1
print("Summary by category:", dict(cat_summary))

os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(catalog, f, indent=2)

print(f"Saved catalog to: {OUTPUT_JSON}")
