#!/usr/bin/env python3
"""
generate_18k_kernels.py:
Ingests /mnt/storage/lego/17K/catalog/parts_catalog_17k.json and LDraw geometry files
to build the 18K LEGO kernel definitions for Brickator3000 Discretizer V2.
"""

import os
import json
import re
from pathlib import Path

CATALOG_PATH = Path('/mnt/storage/lego/17K/catalog/parts_catalog_17k.json')
PARTS_DIR = Path('/mnt/storage/lego/ldraw/parts')
OUTPUT_PATH = Path('/mnt/storage/projects/brickator3000/discretizer/src/kernels/parts18kData.json')

def get_bbox_dim(dat_path):
    min_x, max_x = float('inf'), float('-inf')
    min_y, max_y = float('inf'), float('-inf')
    min_z, max_z = float('inf'), float('-inf')
    try:
        with open(dat_path, 'r', errors='ignore') as f:
            for line in f:
                parts = line.strip().split()
                if not parts:
                    continue
                if parts[0] == '1' and len(parts) >= 5:
                    x, y, z = float(parts[2]), float(parts[3]), float(parts[4])
                    min_x, max_x = min(min_x, x), max(max_x, x)
                    min_y, max_y = min(min_y, y), max(max_y, y)
                    min_z, max_z = min(min_z, z), max(max_z, z)
                elif parts[0] in ('3', '4') and len(parts) >= 11:
                    x, y, z = float(parts[2]), float(parts[3]), float(parts[4])
                    min_x, max_x = min(min_x, x), max(max_x, x)
                    min_y, max_y = min(min_y, y), max(max_y, y)
                    min_z, max_z = min(min_z, z), max(max_z, z)
    except Exception:
        return None
    if min_x == float('inf'):
        return None
    w = max(1, min(16, round((max_x - min_x) / 20.0)))
    d = max(1, min(16, round((max_z - min_z) / 20.0)))
    h = max(1, min(48, round((max_y - min_y) / 8.0)))
    return [w, d, h]

def map_category(super_cat, name):
    lname = name.lower()
    system = 'TECHNIC' if 'technic' in super_cat.lower() or 'technic' in lname else 'SYSTEM'

    if super_cat == 'Brick':
        return ('BRICK_STANDARD', [0, 1, 0], 5, 1.0, system)
    elif super_cat == 'Plate':
        return ('PLATE_STANDARD', [0, 1, 0], 6, 1.0, system)
    elif super_cat == 'Tile':
        return ('TILE_FLAT', [0, 1, 0], 7, 1.2, system)
    elif super_cat == 'Slope':
        if 'curved' in lname:
            return ('SLOPE_CURVED', [0, 0.707, 0.707], 2, 1.5, system)
        elif 'inverted' in lname:
            return ('SLOPE_INVERTED', [0, -0.707, 0.707], 2, 1.4, system)
        elif 'cheese' in lname or '31' in lname or '33' in lname:
            return ('CHEESE_SLOPE', [0, 0.707, 0.707], 2, 1.6, system)
        else:
            return ('SLOPE_45', [0, 0.707, 0.707], 2, 1.3, system)
    elif super_cat == 'Wedge':
        return ('WEDGE_PLATE', [0.707, 0.707, 0], 2, 1.4, system)
    elif super_cat == 'Curved_Round':
        if 'macaroni' in lname or 'quarter' in lname or 'round corner' in lname:
            return ('MACARONI_WEDGE', [0.707, 0, 0.707], 3, 1.6, system)
        return ('SLOPE_CURVED', [0, 0.707, 0.707], 2, 1.5, system)
    elif super_cat == 'Cylinder_Cone':
        if 'dome' in lname or 'dish' in lname or 'radar' in lname:
            return ('ORGANIC_DOME', [0, 1, 0], 1, 1.8, system)
        return ('ROUND_CANISTER', [0, 1, 0], 4, 1.5, system)
    elif super_cat in ('Animal', 'Minifig_Head', 'Minifig_Accessory', 'Plant_Foliage', 'Specialized_Other'):
        return ('BIONICLE_CREATURE', [0, 0.707, 0.707], 1, 1.6, system)
    elif super_cat == 'Technic_Beam':
        return ('TECHNIC_BEAM', [0, 1, 0], 5, 1.0, 'TECHNIC')
    elif super_cat == 'Technic_Pin_Axle':
        return ('TECHNIC_PIN', [0, 1, 0], 5, 1.0, 'TECHNIC')
    elif super_cat == 'Technic_Gear':
        return ('TECHNIC_GEAR', [0, 1, 0], 5, 1.0, 'TECHNIC')
    else:
        return ('BRICK_STANDARD', [0, 1, 0], 5, 1.0, system)

def main():
    print(f'Loading catalog from {CATALOG_PATH}...')
    with open(CATALOG_PATH, 'r') as f:
        catalog = json.load(f)

    print(f'Total parts in catalog: {len(catalog)}')

    kernels = []
    skipped = 0

    for pid, info in catalog.items():
        name = info.get('name', f'Part {pid}')
        super_cat = info.get('super_category', 'Specialized_Other')

        # Skip non-buildable 2D stickers or shortcut patterns
        if 'sticker' in name.lower() or 'pattern' in name.lower():
            skipped += 1
            continue

        dims = info.get('dimensions')
        base_size = None

        if dims:
            try:
                w = max(1, min(16, round(float(dims[0]))))
                d = max(1, min(16, round(float(dims[1]))))
                # dims[2] is height in brick units (1 brick = 3 plates)
                h = max(1, min(48, round(float(dims[2]) * 3.0)))
                base_size = [w, d, h]
            except Exception:
                pass

        if not base_size:
            dat_file = PARTS_DIR / f'{pid}.dat'
            if dat_file.exists():
                base_size = get_bbox_dim(dat_file)

        if not base_size:
            # Default 1x1x3 if completely unmeasurable
            base_size = [1, 1, 3]

        category, target_normal, tier, weight_bonus, system = map_category(super_cat, name)

        kernel_entry = {
            'partId': str(pid),
            'name': name,
            'system': system,
            'category': category,
            'baseSize': base_size,
            'targetNormal': target_normal,
            'minNormalDot': 0.35 if 'SLOPE' in category else 0.0,
            'tier': tier,
            'weightBonus': weight_bonus,
            'omrFrequency': 50
        }
        kernels.append(kernel_entry)

    print(f'Generated {len(kernels)} kernel definitions (skipped {skipped} stickers/patterns).')

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(kernels, f, separators=(',', ':'))

    print(f'Successfully wrote 18K kernels to {OUTPUT_PATH} ({round(OUTPUT_PATH.stat().st_size / (1024 * 1024), 2)} MB).')

if __name__ == '__main__':
    main()
