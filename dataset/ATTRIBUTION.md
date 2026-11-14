# Dataset Attribution & Licensing

This repository bundles the lightweight data needed to run **BrickPack SDF** out of the box (without large LDraw `.dat` binary/text trees), plus download scripts to fetch the official top-99 OMR LDraw library on demand.

## 1. Bundled Out-of-the-Box Assets

| File | Contents | License / Credit |
| :--- | :--- | :--- |
| [`catalog_99.json`](catalog_99.json) | Pre-trained top-99 OMR BrickPack SDF dictionary (`82 KB` heights, covers, studs, deficits — default catalog across CLI and Web Studio) | Derived from [LDraw.org](https://library.ldraw.org/) (CC-BY 2.0) |
| [`catalog_minimal.json`](catalog_minimal.json) | Lightweight 15-part canonical subset (`bricks`, `plates`, `slopes`, `inverted`, `curved`, `round`) | Derived from [LDraw.org](https://library.ldraw.org/) (CC-BY 2.0) |
| [`colors.json`](colors.json) | Official LDraw solid opaque plastic colors (`sRGB`, edge colors, CIE $L^*a^*b^*$ for CIEDE2000 matching) parsed from LDraw `LDConfig.ldr` | [LDraw.org `LDConfig.ldr`](https://www.ldraw.org/legal-info) (CC-BY 2.0) |
| [`omr_top99.json`](omr_top99.json) | Ranked list of the top 99 most frequent LDraw parts across 1,150 Official Model Repository models | [LDraw OMR](https://omr.ldraw.org/) |
| `models/stanford_bunny.{obj,glb,ply}` | Stanford Bunny mesh (10,000 decimated triangles) provided across all 3 supported mesh adapters (`.obj`, textured/vertex-colored `.glb`, ASCII `.ply`) | Stanford University Computer Graphics Laboratory, via [`alecjacobson/common-3d-test-models`](https://github.com/alecjacobson/common-3d-test-models) |

---

## 2. Downloading the Top-99 LDraw Parts Library (On Demand)

The raw LDraw `.dat` parts are intentionally **not** committed to git so the repository stays small. Download the 99 OMR parts plus all recursive subparts (`parts/s/`), primitives (`p/`), and `LDConfig.ldr` from [library.ldraw.org](https://library.ldraw.org/library/updates/complete.zip):

```bash
# Python downloader (no external dependencies):
python3 dataset/download_ldraw.py

# Or shell wrapper:
bash dataset/download_ldraw.sh
```

This populates `dataset/ldraw/` (ignored by git) and refreshes `dataset/colors.json`. You can then encode the full 99-part catalog in either runtime:

```bash
# Python:
python3 python/scripts/train_catalog.py \
  --ldraw dataset/ldraw --rank dataset/omr_top99.json --out dataset/catalog_99.json

# Node.js:
node js/cli/train_catalog.mjs \
  --ldraw dataset/ldraw --rank dataset/omr_top99.json --out dataset/catalog_99.json
```

All `.dat` files inside `dataset/ldraw/` remain copyright their respective LDraw Parts Authors and are distributed under the **LDraw Parts Library License** (Creative Commons Attribution 2.0 Generic / CC-BY 2.0).
