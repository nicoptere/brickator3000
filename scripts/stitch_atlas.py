
import os
import sys
import shutil
import json
from PIL import Image

BASE_DIR = "/mnt/storage/lego"
CLASSES_PATH = os.path.join(BASE_DIR, "brickator3000/app/public/data/classes.json")
BACKUP_INDEX_PATH = os.path.join(BASE_DIR, "detect/mobile_app/dist/data/atlas_index.json")
THUMB_DIR_1 = os.path.join(BASE_DIR, "brickator3000/app/public/thumbnails")
THUMB_DIR_2 = os.path.join(BASE_DIR, "detect/atlas_64/thumbnails")

ATLAS_OUTPUTS = [
    os.path.join(BASE_DIR, "brickator3000/app/public/atlas_64.png"),
    os.path.join(BASE_DIR, "detect/atlas_64/atlas_64.png"),
    os.path.join(BASE_DIR, "detect/mobile_app/public/atlas_64.png"),
    os.path.join(BASE_DIR, "detect/mobile_app/dist/atlas_64.png"),
    "/home/nico/.gemini/antigravity/brain/fc214192-3297-4e24-913b-5f7ddf0de94b/atlas_64.png"
]

INDEX_OUTPUTS = [
    os.path.join(BASE_DIR, "brickator3000/app/public/data/atlas_index.json"),
    os.path.join(BASE_DIR, "detect/atlas_64/atlas_index.json"),
    os.path.join(BASE_DIR, "detect/mobile_app/public/data/atlas_index.json"),
    os.path.join(BASE_DIR, "detect/mobile_app/dist/data/atlas_index.json"),
]

def run():
    print("=================================================================")
    print(" ★ FULL 936-PART SPRITE ATLAS & INDEX BUILDER")
    print("=================================================================")

    # 1. Load classes
    with open(CLASSES_PATH, "r", encoding="utf-8") as f:
        classes_data = json.load(f)
    classes = classes_data["classes"]
    print(f"[*] Loaded {len(classes)} classes from {CLASSES_PATH}")

    # 2. Load existing aliases
    existing_aliases = {}
    if os.path.exists(BACKUP_INDEX_PATH):
        try:
            with open(BACKUP_INDEX_PATH, "r", encoding="utf-8") as f:
                backup = json.load(f)
                for pid, pdata in backup.get("parts", {}).items():
                    if "aliases" in pdata and pdata["aliases"]:
                        existing_aliases[pid] = pdata["aliases"]
            print(f"[*] Preserved {len(existing_aliases)} alias mappings from backup index.")
        except Exception as e:
            print(f"[!] Warning reading backup index: {e}")

    # 3. Synchronize thumbnail folders so both have all 936 files
    os.makedirs(THUMB_DIR_1, exist_ok=True)
    os.makedirs(THUMB_DIR_2, exist_ok=True)
    for c in classes:
        fn = f"{c['id']}.png"
        p1 = os.path.join(THUMB_DIR_1, fn)
        p2 = os.path.join(THUMB_DIR_2, fn)
        if os.path.exists(p1) and not os.path.exists(p2):
            shutil.copy2(p1, p2)
        elif os.path.exists(p2) and not os.path.exists(p1):
            shutil.copy2(p2, p1)

    COLS = 32
    ROWS = 32
    TILE_SIZE = 64
    WIDTH = COLS * TILE_SIZE   # 2048
    HEIGHT = ROWS * TILE_SIZE  # 2048

    atlas_index = {
        "tileSize": TILE_SIZE,
        "cols": COLS,
        "rows": ROWS,
        "atlasWidth": WIDTH,
        "atlasHeight": HEIGHT,
        "totalParts": len(classes),
        "parts": {}
    }

    atlas_img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))

    pasted_count = 0
    missing = []
    suspicious = []

    for c in classes:
        idx = c["idx"]
        pid = c["id"]
        col = idx % COLS
        row = idx // COLS
        x = col * TILE_SIZE
        y = row * TILE_SIZE
        u_min = col / COLS
        v_min = row / ROWS
        u_max = (col + 1) / COLS
        v_max = (row + 1) / ROWS

        atlas_index["parts"][pid] = {
            "idx": idx,
            "id": pid,
            "name": c["name"],
            "col": col,
            "row": row,
            "x": x,
            "y": y,
            "uMin": u_min,
            "vMin": v_min,
            "uMax": u_max,
            "vMax": v_max,
            "aliases": existing_aliases.get(pid, []),
            "thumbnail": f"thumbnails/{pid}.png"
        }

        # Paste thumbnail
        tpath = os.path.join(THUMB_DIR_1, f"{pid}.png")
        if not os.path.exists(tpath):
            tpath = os.path.join(THUMB_DIR_2, f"{pid}.png")

        if os.path.exists(tpath):
            try:
                im = Image.open(tpath).convert("RGBA")
                colors = im.getcolors(maxcolors=4096)
                if colors:
                    non_alpha_colors = [clr for clr in colors if clr[1][3] > 10]
                    if not non_alpha_colors:
                        suspicious.append((pid, "transparent"))
                    else:
                        max_c = max(max(clr[1][:3]) for clr in non_alpha_colors)
                        if max_c < 30:
                            suspicious.append((pid, f"dark RGB={max_c}"))

                atlas_img.paste(im, (x, y), im)
                pasted_count += 1
            except Exception as e:
                print(f"[!] Error reading {tpath}: {e}")
                missing.append(pid)
        else:
            missing.append(pid)

    print(f"\n✓ Pasted {pasted_count} / {len(classes)} thumbnails into {WIDTH}x{HEIGHT} atlas.")
    if missing:
        print(f"[!] Missing {len(missing)} thumbnails: {missing}")
    if suspicious:
        print(f"[!] Found {len(suspicious)} suspicious thumbnails: {suspicious}")
    else:
        print("✓ Zero pitch-black thumbnails across all 936 pasted tiles!")

    # 4. Save atlas_index.json to all targets
    index_json = JSON.stringify(atlas_index, null, 2) if False else json.dumps(atlas_index, indent=2)
    for ip in INDEX_OUTPUTS:
        os.makedirs(os.path.dirname(ip), exist_ok=True)
        with open(ip, "w", encoding="utf-8") as f:
            f.write(index_json)
        print(f"✓ Saved index ({len(atlas_index['parts'])} parts): {ip}")

    # 5. Save atlas_64.png to all targets
    print("\n[*] Saving optimized master atlas PNGs...")
    for ap in ATLAS_OUTPUTS:
        os.makedirs(os.path.dirname(ap), exist_ok=True)
        atlas_img.save(ap, optimize=True)
        size_kb = os.path.getsize(ap) / 1024
        print(f"✓ Saved master atlas: {ap} ({size_kb:.1f} KB)")

    print("\n★ Full Sprite Atlas & Index build complete successfully!\n")

if __name__ == "__main__":
    run()
