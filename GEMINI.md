# Brickator3000 Project Guidelines & LEGO Design Invariants

## 0. UI & Theme Design Invariants
- **Strictly Zero Emojis**: Never use emojis in UI buttons, labels, modal headers, badges, or console overlays. Use crisp SVG icons or clean text.
- **Light Theme with Single Accent Color**: The UI interface must strictly use a clean light theme with neutrals (`#ffffff`, `#f8fafc`, `#f1f5f9`, border `#e2e8f0`, text `#0f172a`, muted `#64748b`) and **ONLY ONE accent color**: `#2563eb` (Royal Blue, with subtle background tint `#eff6ff` and active border `#bfdbfe`). Do not introduce secondary or clashing accent colors.
- **3D Scene Background**: The 3D viewport canvas must use a dark grey background (`#1e222b` / `0x1e222b`) with subtle grid lines and soft contact shadows (`opacity: 0.35`).
- **Zero Fireworks, Audio, or Playback Timeline**: Never trigger `canvas-confetti` fireworks, audio sound effects, or bottom timeline playback sliders.

## 1. Modern & Weird Parts Policy (Lift Pre-Bionicle Constraints)
- **Zero Pre-Bionicle Limitation**: Never restrict discretization or part synthesis to 1970s–1990s basic square bricks (`3001`, `3003`, `3004`, `3005`) and flat 45° slopes (`3039`, `3040`).
- **Active Utilization of Modern & Weird Pieces**: Proactively utilize the 25,000+ LDraw parts library:
  - **Bionicle / Constraction / Creature**: Barbs, claws, teeth, spines (`41669`, `53451`, `87747`, `32578`, `16770`, `48729b`) for organic crests, beaks, ridges, and fins.
  - **Modern Curved Slopes**: Prioritize double-curved and curved slopes (`11477`, `15068`, `61678`, `88930`, `93273`, `24201`, `32803`) over rigid 45° flat slopes.
  - **Macaroni & Round Corner Tiles**: Replace square corners on curved perimeters with curved macaroni tiles (`27925`, `25269`, `27263`).
  - **Inverted Radar Dishes & Domes**: Crown hemispherical and dome apexes with inverted radar dishes (`4740`, `43898`, `3960`).
  - **Automotive & NPU Elements**: Incorporate spoilers (`30626`), grilles (`2412b`), and mudguards (`18974`, `50745`).
  - **Vertical Poles, Struts & Cylinders**: Convert vertical single-column masts and structural uprights into round elements: 1x1 canisters (`3062b`), 1x1 round plates (`6141`), 2x2 cylinders (`3941`), and 4x4 cylinders (`6222`).

## 2. Color Fidelity & Direct Sampling ("Cheat Mode")
- **Default to Model Actual Colors**: Always prioritize direct 24-bit RGB sampling from the input mesh (`0x2RRGGBB` in LDraw line format: `1 0x2RRGGBB X Y Z ...`).
- **Dual-Pipeline Sampling (Textures & Vertex Colors)**:
  - For meshes with texture maps (`material.map`), sample diffuse pixel colors using interpolated barycentric UV coordinates.
  - For meshes with vertex color attributes (`geometry.attributes.color`), interpolate barycentric vertex colors.
  - Preserve original color fidelity over quantization into small LEGO color palettes.
- **Zero Color Quantization Artifacts**: Do not force source mesh colors into small, basic LEGO palettes unless the user explicitly selects official quantization. Direct color fidelity preserves textures, gradients, and original aesthetic intent.

## 3. Pure Model Discretization Policy (Zero Artificial Vehicle / Gear Mechanics)
- **No Artificial Chassis or Gear Constraints**: Never synthesize artificial Technic chassis, axles, differential/pinion gears, steering wheels, or wheel assemblies into the discretized build, and never carve artificial wheel well voids out of voxel fields.
- **Faithful Mesh Geometry**: Discretize the input 3D model faithfully according to its actual surface geometry, volume, and color, maintaining structural stability and running bond interlocking without hardcoded automotive mechanics.

## 4. LEGO Design Series Aesthetic Standards
- **Studless Top Finish**: Cover exposed top plate surfaces with smooth tiles (`3068b` 2x2, `3069b` 1x2, `2431` 1x4, `6636` 1x6, `98138` 1x1 round). Enabled by default.
- **Aerodynamic Wedge Plates**: Use authentic wedge plates (`43722`/`43723` 3x2 L/R, `2419` 3x6) for wings, fins, and tapered hulls.
- **Watertight & Structurally Sound**: Ensure shells are 6-connected watertight, layer joints are interlocked (running bond), and BFS physical grounding eliminates floating pieces.

## 5. Asynchronous Pre-processing & UI Responsiveness
- **No Main Thread Freezing**: Never run CPU-intensive mesh pre-processing (half-edge island extraction, raycasting, voxelization, Markov solving) synchronously without yielding. Always yield to the event loop (`await new Promise(r => setTimeout(r, 0))`) periodically.
- **Pre-Process Progress Popin**: Display a centered modal popin during mesh pre-processing with a live percentage bar (0%–100%), active stage descriptions, and real-time topological island discovery feedback.

## 6. Crust vs. Core Disambiguation & Vertical Structure Invariant
- **Strict Crust / Core Stratification**:
  - **Structural Core (depth >= 2)**: Discretized first with large structural bricks ($h = 3$ plates: $2\times8, 2\times6, 2\times4, 1\times8, 1\times6, 2\times3, 2\times2, 1\times4, 1\times2$) and full-height $1\times1\times3$ bricks (`3005`). Strictly ban cosmetic slopes, wedges, and thin 1-plate slices from the interior core.
  - **Exterior Crust (depth <= 1)**: Strictly cosmetic. Reserved for curved slopes, 45° slopes, cheese slopes, wedges, macaroni curves, and top flat tiles.
- **Vertical Columns & Masts**:
  - Morphologically detect continuous vertical shafts ($h \ge 3$) with empty horizontal neighbors.
  - Automatically pack with $1\times1\times5$ tall column bricks (`2453b`, height 15 plates = 120 LDU) and full-height $h=3$ bricks (`3005`, `3004`). Never decompose vertical uprights into stacked 1-plate slivers.

## 7. Universal 1-Plate Grid & Resolution Invariant
- **Universal Plate Unit**: Discretization must strictly operate on the universal LEGO plate grid ($1\text{ unit} = 1\text{ plate} = 8\text{ LDU} = 0.4\text{ studs}$ in $Y$, $1\text{ stud} = 20\text{ LDU}$ in $X/Z$).
- **Zero "1 Brick = 3 Plates" Discrete Grid**: Never introduce or re-enable a coarse "1 brick = 3 plates" discrete lattice mode.
- **High Resolution Support**: Maintain support for resolution scaling up to 128 units (`min={2}`, `max={128}`).

## 8. Continuous Curvature Guidance & Quadrant 1 Viewport
- **Curvature Tensor Alignment**: Slopes and wedges must be aligned with the principal curvature gradient tensor ($\nabla \mathbf{n}$) and dihedral crease lines ($\ge 20^\circ$) extracted from the continuous mesh, not single-triangle normal quantization.
- **Quadrant 1 Viewport Display**: In the 4-split WebGL layout, Quadrant 1 (top-left) must always render the source mesh: 100% opaque (`transparent = false`, `depthWrite = true`) with diffuse texture and overlaid with `#2563eb` curvature/crease lines.
- **Collapsible UI Panels**: All control sidebars and panel sub-sections must be collapsible into compact drawer pills and accordions with clean SVG icons (zero emojis).

