#!/usr/bin/env python3
"""
OMR Knowledge Miner: Statistical N-Gram Adjacency Tensor Extractor with Category Filtering.

Parses official LDraw models in docs/omr_gallery/ and mines 3D pairwise spatial adjacency
relationships across 6 cardinal directions:
- Top (+Y, stud-to-tube)
- Bottom (-Y, tube-to-stud)
- Lateral (+X, -X, +Z, -Z)

Supports specialized category subsets:
- vehicles: Creator Expert cars, Speed Champions, Technic (Mini Cooper, VW Beetle, Mustang, Porsche, etc.)
- architecture: Modular buildings, landmarks (Tower Bridge, Big Ben, Colosseum, Cafe Corner, etc.)
- space: Star Wars UCS, Space Shuttle (Discovery, Millennium Falcon, Blockade Runner, etc.)
- universal: Full combined dataset across all 1,420 models.

Outputs:
- markov/src/engine/omrAdjacencyTensor.json (Universal)
- markov/src/engine/tensors/{vehicles,architecture,space,universal}.json
"""

import os
import re
import sys
import json
import argparse
from collections import defaultdict

OMR_DIR = "/mnt/storage/projects/brickator3000/docs/omr_gallery"
OUTPUT_DIR = "/mnt/storage/projects/brickator3000/markov/src/engine/tensors"
DEFAULT_OUTPUT = "/mnt/storage/projects/brickator3000/markov/src/engine/omrAdjacencyTensor.json"

LDU_STUD = 20.0
LDU_PLATE = 8.0

VEHICLE_KEYWORDS = [
    'car', 'truck', 'bus', 'camper', 'mustang', 'beetle', 'mini', 'ferrari', 'porsche',
    'technic', '8880', '8448', '10242', '10252', '10265', '10220', '10271', '10248',
    '10295', '10258', '10262', '10269', 'speed', 'racer', 'vehicle', 'auto', 'jeep',
    'motorcycle', 'plane', 'aircraft', 'helicopter', 'tractor', 'chassis'
]

ARCHITECTURE_KEYWORDS = [
    '10182', '10185', '10190', '10214', '10253', '10276', '10270', '10278', '10297',
    '10243', '10246', '10251', '10264', 'tower', 'bridge', 'castle', 'building', 'house',
    'hotel', 'restaurant', 'modular', 'temple', 'monument', 'station', 'garage', 'bank', 'palace'
]

SPACE_KEYWORDS = [
    'star', 'falcon', 'shuttle', 'x-wing', 'y-wing', 'snowspeeder', '10019', '10030',
    '10129', '10134', '10143', '10179', '10283', '10240', 'tie', 'rebel', 'space',
    'fighter', 'crawler', 'droid', 'jedi', 'apollo', 'saturn', 'nasa'
]

def parse_model_adjacencies(filepath: str) -> dict:
    local_adj = defaultdict(int)
    bricks = [] # list of (x_stud, y_plate, z_stud, part_id)

    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if line.startswith("1 "):
                    parts = line.split()
                    if len(parts) >= 15:
                        try:
                            x = float(parts[2])
                            y = float(parts[3])
                            z = float(parts[4])
                            raw_part = parts[14].lower().replace(".dat", "").replace("\\", "/")
                            part_id = raw_part.split("/")[-1]

                            # Filter out non-brick elements (stickers, shortcuts, primitives)
                            if re.match(r"^\d{3,6}[a-z0-9]?$", part_id):
                                xs = round(x / LDU_STUD)
                                yp = round(y / LDU_PLATE)
                                zs = round(z / LDU_STUD)
                                bricks.append((xs, yp, zs, part_id))
                        except:
                            continue
    except:
        return {}

    # Limit search per model to avoid O(N^2) on massive UCS sets
    if len(bricks) > 1500:
        bricks = bricks[:1500]

    # Spatial hash for fast neighbor lookup
    spatial = {}
    for b in bricks:
        spatial[(b[0], b[1], b[2])] = b[3]

    for xs, yp, zs, pA in bricks:
        neighbors = [
            ("+Y_top", (xs, yp - 3, zs)),
            ("+Y_top_plate", (xs, yp - 1, zs)),
            ("-Y_bottom", (xs, yp + 3, zs)),
            ("-Y_bottom_plate", (xs, yp + 1, zs)),
            ("+X", (xs + 1, yp, zs)),
            ("-X", (xs - 1, yp, zs)),
            ("+Z", (xs, yp, zs + 1)),
            ("-Z", (xs, yp, zs - 1)),
        ]

        for dname, npos in neighbors:
            pB = spatial.get(npos)
            if pB:
                dir_key = "+Y" if "top" in dname else ("-Y" if "bottom" in dname else dname)
                local_adj[f"{pA}|{dir_key}|{pB}"] += 1

    return dict(local_adj)

def categorize_file(filename: str, omr_dir: str) -> set:
    categories = {'universal'}
    fl = filename.lower()
    title = ''
    try:
        with open(os.path.join(omr_dir, filename), 'r', encoding='utf-8', errors='ignore') as fp:
            for line in fp:
                line = line.strip()
                if line.startswith('0 ') and not line.startswith('0 !') and not line.startswith('0 BFC') and not line.startswith('0 FILE'):
                    title = line[2:].strip().lower()
                    break
    except:
        pass

    text = f"{fl} {title}"
    if any(k in text for k in VEHICLE_KEYWORDS) or re.match(r'^(42\d{3}|84\d{2}|88\d{2}|82\d{2})', fl):
        categories.add('vehicles')
    if any(k in text for k in ARCHITECTURE_KEYWORDS) or re.match(r'^(210\d{2}|1018\d|10214|10253|10276)', fl):
        categories.add('architecture')
    if any(k in text for k in SPACE_KEYWORDS) or re.match(r'^(75\d{3}|71\d{2}|100\d{2}|1017\d|10283)', fl):
        categories.add('space')

    return categories

def build_tensor_from_adj(global_adj: dict, min_count: int = 2) -> dict:
    tensor = defaultdict(lambda: defaultdict(list))
    sums = defaultdict(lambda: defaultdict(int))

    for key, count in global_adj.items():
        if count < min_count:
            continue
        pA, dir_key, pB = key.split("|")
        sums[pA][dir_key] += count

    for key, count in global_adj.items():
        if count < min_count:
            continue
        pA, dir_key, pB = key.split("|")
        total = sums[pA][dir_key]
        if total > 0:
            prob = round(count / total, 4)
            tensor[pA][dir_key].append({
                "partId": pB,
                "count": count,
                "prob": prob
            })

    for pA in tensor:
        for dir_key in tensor[pA]:
            tensor[pA][dir_key].sort(key=lambda x: -x["count"])
            tensor[pA][dir_key] = tensor[pA][dir_key][:12]

    return tensor

def mine_category(cat_name: str, files: list, out_path: str):
    print(f"\n[Mining Category: {cat_name.upper()}] with {len(files)} models...")
    global_adj = defaultdict(int)

    for i, fpath in enumerate(files):
        res = parse_model_adjacencies(fpath)
        for k, count in res.items():
            global_adj[k] += count
        if (i + 1) % 100 == 0 or (i + 1) == len(files):
            print(f"  Parsed {i + 1} / {len(files)} models...")

    min_count = 1 if cat_name in ['vehicles', 'architecture', 'space'] and len(files) < 300 else 2
    tensor = build_tensor_from_adj(global_adj, min_count=min_count)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(tensor, f, indent=2)

    print(f"  Saved {cat_name} tensor ({len(tensor)} unique parts) -> {out_path}")
    return tensor

def main():
    parser = argparse.ArgumentParser(description="OMR Knowledge Miner with Category Support")
    parser.add_argument("--category", choices=["universal", "vehicles", "architecture", "space", "all"], default="all")
    args = parser.parse_args()

    print(f"Scanning OMR models from: {OMR_DIR}")
    all_files = [f for f in os.listdir(OMR_DIR) if f.endswith(".mpd") or f.endswith(".ldr")]
    print(f"Total OMR models found: {len(all_files)}")

    # Classify files
    file_map = defaultdict(list)
    for f in all_files:
        cats = categorize_file(f, OMR_DIR)
        full_path = os.path.join(OMR_DIR, f)
        for c in cats:
            file_map[c].append(full_path)

    print(f"Categorization counts: Universal={len(file_map['universal'])}, Vehicles={len(file_map['vehicles'])}, Architecture={len(file_map['architecture'])}, Space={len(file_map['space'])}")

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    targets = ["vehicles", "architecture", "space", "universal"] if args.category == "all" else [args.category]

    for cat in targets:
        target_files = file_map[cat]
        out_path = os.path.join(OUTPUT_DIR, f"{cat}.json")
        tensor = mine_category(cat, target_files, out_path)

        if cat == "universal":
            # Also write default tensor file
            with open(DEFAULT_OUTPUT, "w", encoding="utf-8") as f:
                json.dump(tensor, f, indent=2)
            print(f"  Updated default tensor: {DEFAULT_OUTPUT}")

    print("\nOMR Mining complete!")

if __name__ == "__main__":
    main()
