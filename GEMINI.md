# Brickator3000 Project Guidelines & LEGO Design Invariants

## 1. Modern & Weird Parts Policy (Lift Pre-Bionicle Constraints)
- **Zero Pre-Bionicle Limitation**: Never restrict discretization or part synthesis to 1970s–1990s basic square bricks (`3001`, `3003`, `3004`, `3005`) and flat 45° slopes (`3039`, `3040`).
- **Active Utilization of Modern & Weird Pieces**: Proactively utilize the 25,000+ LDraw parts library:
  - **Bionicle / Constraction / Creature**: Barbs, claws, teeth, spines (`41669`, `53451`, `87747`, `32578`, `16770`, `48729b`) for organic crests, beaks, ridges, and fins.
  - **Modern Curved Slopes**: Prioritize double-curved and curved slopes (`11477`, `15068`, `61678`, `88930`, `93273`, `24201`, `32803`) over rigid 45° flat slopes.
  - **Macaroni & Round Corner Tiles**: Replace square corners on curved perimeters with curved macaroni tiles (`27925`, `25269`, `27263`).
  - **Inverted Radar Dishes & Domes**: Crown hemispherical and dome apexes with inverted radar dishes (`4740`, `43898`, `3960`).
  - **Automotive & NPU Elements**: Incorporate spoilers (`30626`), grilles (`2412b`), and mudguards (`18974`, `50745`).

## 2. Color Fidelity & Direct Sampling ("Cheat Mode")
- **Default to Model Actual Colors**: Always prioritize direct 24-bit RGB sampling from the input mesh (`0x2RRGGBB` in LDraw line format: `1 0x2RRGGBB X Y Z ...`).
- **Zero Color Quantization Artifacts**: Do not force source mesh colors into small, basic LEGO palettes unless the user explicitly selects official quantization. Direct color fidelity preserves textures, gradients, and original aesthetic intent.

## 3. Pure Model Discretization Policy (Zero Artificial Vehicle / Gear Mechanics)
- **No Artificial Chassis or Gear Constraints**: Never synthesize artificial Technic chassis, axles, differential/pinion gears, steering wheels, or wheel assemblies into the discretized build, and never carve artificial wheel well voids out of voxel fields.
- **Faithful Mesh Geometry**: Discretize the input 3D model faithfully according to its actual surface geometry, volume, and color, maintaining structural stability and running bond interlocking without hardcoded automotive mechanics.

## 4. LEGO Design Series Aesthetic Standards
- **Studless Top Finish**: Cover exposed top plate surfaces with smooth tiles (`3068b` 2x2, `3069b` 1x2, `2431` 1x4, `6636` 1x6, `98138` 1x1 round).
- **Aerodynamic Wedge Plates**: Use authentic wedge plates (`43722`/`43723` 3x2 L/R, `2419` 3x6) for wings, fins, and tapered hulls.
- **Watertight & Structurally Sound**: Ensure shells are 6-connected watertight, layer joints are interlocked (running bond), and BFS physical grounding eliminates floating pieces.
