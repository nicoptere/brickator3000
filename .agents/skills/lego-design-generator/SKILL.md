---
name: lego-design-generator
description: >-
  Use this skill when discretizing 3D models into LEGO Design-grade buildable models,
  working with the LDraw library, selecting modern/weird/Bionicle parts, configuring direct RGB
  sampling ('cheat mode'), or implementing functional Technic vehicle mechanics.
---

# LEGO Design Generator Skill

## 1. LDraw Part Reference Cheatsheet

### Modern Curved Slopes
- `11477`: Slope Curved 2 x 1 (20 x 40 x 24 LDU)
- `15068`: Slope Curved 2 x 2 (40 x 40 x 24 LDU)
- `61678`: Slope Curved 4 x 1 (20 x 80 x 24 LDU)
- `88930`: Slope Curved 4 x 2 (40 x 80 x 24 LDU)
- `93273`: Slope Curved 4 x 1 Inverted
- `24201`: Slope Curved 2 x 1 Inverted

### Bionicle, Constraction & Organic Pieces
- `41669`: Bionicle Tooth / Spine 1 x 3 x 2
- `53451`: Barb / Tooth / Horn 1 x 1 x 0.67
- `87747`: Curved Blade / Horn 4L
- `32578`: Bionicle Claw / Hook
- `32174`: Technic Axle Connector 2 x 3 with Ball Socket

### Modern Tiles & Rounds
- `27925`: Tile 2 x 2 Macaroni Curved Round
- `25269`: Tile 1 x 1 Quarter Round
- `4740`: Dish 2 x 2 Inverted (Radar)
- `3068b` / `3069b` / `2431` / `6636`: Flat Tiles (2x2, 1x2, 1x4, 1x6)
- `2412b`: Tile 1 x 2 Radiator Grille

### Vehicle & Technic Functional Elements
- `3700` (1x2), `3701` (1x4), `3702` (1x8): Technic Bricks with Axle Holes
- `3704` (2L), `3705` (4L), `3706` (6L): Technic Axles
- `6014b` & `6015`: Wheel 11mm D. x 8mm with Tire 21mm D. x 9mm
- `30155`: Wheel 20mm D. x 30mm with Tire
- `56145`: Wheel 30.4mm D. x 20mm with Tire

## 2. Coordinate System & Dimension Standards
- 1 Stud = 20 LDU in X and Z.
- 1 Plate = 8 LDU in Y (1 Brick = 3 Plates = 24 LDU).
- Three.js $Y$-up maps to LDraw $Y$-down ($Y_{\text{ldraw}} = -Y_{\text{three}}$).
- Ground plane: Three.js $Y = 0 \iff$ LDraw $Y = 0$.
- Wheels must be offset so that `min_Y_contact` $= 0$.

## 3. Direct RGB Sampling ("Cheat Mode")
In LDraw format, exact 24-bit hex colors are specified using `0x2RRGGBB`:
```text
1 0x2E6A1B 0 0 0 1 0 0 0 1 0 0 0 1 11477.dat
```
This bypasses palette quantization errors and mirrors the original model's diffuse/vertex colors.
