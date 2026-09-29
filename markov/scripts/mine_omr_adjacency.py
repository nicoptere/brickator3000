#!/usr/bin/env python3
"""
OMR Knowledge Miner: Statistical N-Gram Adjacency Tensor Extractor.

Parses all 1,420 official LDraw models in docs/omr_gallery/ and mines
3D pairwise spatial adjacency relationships across 6 cardinal directions:
- Top (+Y, stud-to-tube)
- Bottom (-Y, tube-to-stud)
- Lateral (+X, -X, +Z, -Z)

Outputs:
- markov/src/engine/omrAdjacencyTensor.json
"""

import os
import re
import json
import math
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor

OMR_DIR = "/mnt/storage/projects/brickator3000/docs/omr_gallery"
OUTPUT_JSON = "/mnt/storage/projects/brickator3000/markov/src/engine/omrAdjacencyTensor.json"

LDU_STUD = 20.0
LDU_PLATE = 8.0

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
                            # 1 <colour> x y z a b c d e f g h i <part>
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
    for i, b in enumerate(bricks):
        spatial[(b[0], b[1], b[2])] = b[3]

    for xs, yp, zs, pA in bricks:
        # Check 6 cardinal neighbors
        # +Y in LDraw is down, -Y is up
        # Top stud: yp - 1 or yp - 3
        # Bottom tube: yp + 1 or yp + 3
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

def main():
    print(f"Scanning 1,420 OMR reference models from: {OMR_DIR}")
    files = [os.path.join(OMR_DIR, f) for f in os.listdir(OMR_DIR) if f.endswith(".mpd") or f.endswith(".ldr")]
    print(f"Found {len(files)} models to process.")

    global_adj = defaultdict(int)
    total_parsed = 0

    # Process files
    for i, fpath in enumerate(files):
        res = parse_model_adjacencies(fpath)
        for k, count in res.items():
            global_adj[k] += count
        total_parsed += 1
        if (i + 1) % 200 == 0:
            print(f"Parsed {i + 1} / {len(files)} models...")

    print(f"\nExtracted {len(global_adj)} raw directional adjacency pairs across {total_parsed} models!")

    # Format into structured JSON tensor:
    # tensor[partA][direction] = list of { partB: count, prob: weight }
    tensor = defaultdict(lambda: defaultdict(list))
    sums = defaultdict(lambda: defaultdict(int))

    for key, count in global_adj.items():
        if count < 2:  # Prune single one-off anomalies
            continue
        pA, dir_key, pB = key.split("|")
        sums[pA][dir_key] += count

    for key, count in global_adj.items():
        if count < 2:
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

    # Sort candidates by probability
    for pA in tensor:
        for dir_key in tensor[pA]:
            tensor[pA][dir_key].sort(key=lambda x: -x["count"])
            # Keep top 12 most frequent neighbors per direction
            tensor[pA][dir_key] = tensor[pA][dir_key][:12]

    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(tensor, f, indent=2)

    print(f"Saved compressed OMR Adjacency Tensor to: {OUTPUT_JSON}")
    print(f"Unique source pieces with mined adjacency rules: {len(tensor)}")

if __name__ == "__main__":
    main()
