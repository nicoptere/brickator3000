# claude/app — Brickator 3000, mesh → LEGO (JS port)

The method from `claude/generator` (Python) ported to plain JavaScript: `src/brickgen/` has no dependencies and no DOM,
runs in Web Workers (the app) and in Node (tests / batches). The React + antd + three.js app around it only loads models,
exposes every parameter and shows / exports the result. Everything of the old app (YOLO detection, colour inference,
remix matcher, path tracer, splats) is gone.

## Routes
- `http://localhost:5174/#/` = **Studio**: layout and look of the original discretizer app (dark stage with grid and soft shadows, floating white card with collapsible
  sections, results card, step scrubber, HUD with FPS / draw calls / triangles), bricks drawn as `THREE.InstancedMesh` (one per part x rotation + one for the visible studs)
  with a cell-shaded (toon) material and ink outlines, pieces pop in with a spring while the model is built layer by layer, synthesised sounds (Web Audio, mute button in the HUD;
  the source repo has no sound files so these are generated).
- `http://localhost:5174/#/dev` = the first frontend, every parameter in a side panel (kept as is).
Both use the same engine, `src/schema.js` and `src/fields.jsx`; "All parameters..." in Studio opens the same panels in a drawer.

## Run
```
cd claude/app
npm install
npm run dev            # http://localhost:5174  (models are served from ../../discretizer/public/models)
MODELS_DIR=/some/other/models npm run dev
npm run build          # static build in dist/ (no model list without the dev server: use "Open file")
node test/run.mjs path/to/model.glb 16 [key=value ...]   # one model in Node, prints metrics
node test/batch10.mjs 16 24 32                           # the 10-model batch (GLB / LDR / reports in out/r10js)
```

## Engine (`src/brickgen/`)
| file | what |
|---|---|
| `constants.js` | units (stud 20, plate 8 LDU, 5x5 samples / stud) and `DEFAULTS` = every tunable |
| `mesh.js` | GLB reader keeping `COLOR_0`, area-weighted surface samples (seeded), sRGB <-> linear |
| `grid.js` | normalisation (stud count on the smallest / longest side), ray hits per sample column, hollow / envelope volume, padded one-shot volume + grid-phase windows, mirror averaging |
| `variants.js` | part volumes for 4 yaw rotations from the measured catalog profiles |
| `solver.js` | lazy-greedy selection: cell-level integral image prefilter, exact fit, collision, mirror twins |
| `run.js` | phases A0 round, A skin (slopes / curved / cheese / tiles / inverted), B / B2 fill, C relaxed, D 1x1, E thin features; volume metrics |
| `islands.js` | 3D islands of the source volume, minimum spanning tree (multi-source Dijkstra + Kruskal), 4 LDU tubes written into the field before solving; tiny floaters removed |
| `post.js` | 3 plates → brick, colour-aware re-pack (mirror aware), round-brick pillars, stud-contact connectivity, bracing / thickening, **splice** (re-cut touching pieces of different components so a 1x2 plate spans the seam, volume unchanged), **bridge** (Dijkstra through free cells with 1xk plates, zig-zag, to the nearest other component), support columns (ground optional, default OFF), studs finish (**optional, default OFF**) |
| `symmetry.js`, `nn.js` | mirror-plane detection on surface samples (uniform-grid nearest neighbour) |
| `colors.js`, `palette.js` | cheat colour or snap to the LEGO solid palette (CIEDE2000, your `color_matcher.ts` data) |
| `export.js` | part geometry (catalog .dat triangles / analytic), feature edges, `.ldr`, `.glb` writer |
| `pipeline.js` | `generate(model, opts)` = `setup` → `scoreJob` per grid phase → `finishJob` |
| `catalog.js` | 82 parts measured from your LDraw library by `claude/generator/lego_catalog.py` |

Parity with Python (16 studs, same options): isetta 1168 vs 1151 pieces, IoU 0.867 vs 0.868; t_poli 1584 vs 1562, 0.573 vs 0.572;
mantis 813 vs 813. Differences come from the random surface samples (different RNG) and the cheaper centre-of-mass binning.

## App
- model list = every .glb/.gltf/.obj/.ply/.stl under `MODELS_DIR` (+ "Open file"); up-axis switch
- all parameters in the left panels (stored in localStorage, "defaults" resets)
- grid phases are scored in parallel workers (`workers` box), the best one is finished in worker 0
- viewport: side by side / LEGO / mesh / overlay, colours or part kinds, edges, views, layer slider (build order by level), hover = part info
- stats, symmetry, bracing / supports counts, parts list (BOM by part + colour)
- export: `.ldr` (direct RGB colours, or LEGO codes when the palette is snapped), `.glb`, `.glb` coloured by kind, report `.json`, `.png`
