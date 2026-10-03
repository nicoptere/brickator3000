# Brickgen performance exploration — cache, GPU, and the "literal 3D image" idea

Status 2026-10-03. Companion to `brickgen-method.md` / `brickgen-handoff.md`.
§0 records what was measured and fixed on 2026-10-03; §1–§6 are the original
exploration (plan, literature) and keep their value for the solver work.

---

## 0. What the profile actually said (2026-10-03, after implementing)

The cost model in §1 below was written before profiling and was **wrong about
the ranking**. On tlamp1 @16 (one grid phase) the solve took 0.33 s and the
post-process **6.8 s**; on rosewood @24, solve 1.9 s and post **54 s**. The
connectivity passes dominated by 10–30×, not scoring. Everything below in
§1–§4 remains valid as the plan for the *solver*, which is now the largest
remaining term, but the first round of work went into `post.js`.

### Fixes landed (all bit-identical output, verified with `cmp` on the piece
lists against the original code: 10 models @16, rosewood/hair_f @24,
Extended, symmetry on)

| Where | What | Why it was slow |
|---|---|---|
| `post.js bridge` | BFS `expand` rewritten allocation-free; plates packed into an `Int32Array` | per-step arrays/objects → 46 % of runtime in `expand`, 27 % in GC |
| `post.js bridge` | `touch` = two table lookups (`tb`/`ta` built once per state) | stud test per cell, per round |
| `post.js bridge` | reverse search off by default (`bridgeReverse: false`) | never succeeded where the forward search failed; flooded the whole volume on every failed round (54/61 rounds fail on tlamp1, 120/120 on rosewood) |
| `post.js bridge` | state (grid, union-find, touch tables) reused while attempts fail; seeds taken from the floating component's own pieces | a failed attempt changes nothing, yet everything was rebuilt |
| `post.js bracing` | occupancy / union-find built once (they were already maintained incrementally); typed-array grid for lookups; numeric `seen` / stud keys; hoisted constant arrays | string-keyed `Map` + string `seen` keys ≈ 1 µs per cross-component hit × 300 k hits per round |
| `post.js splice` | `countCompsAfter`: old–old stud contacts are unaffected by swapping 1–2 pieces, so only the new pieces are linked and a union-find over the pair list gives the count | `countComps(cand)` rebuilt occupancy + components of all 13 k pieces for every tried level of every candidate |
| `post.js` | `K(i,j,l)` is a packed number, not a string; stud sets cached per piece in a `WeakMap` | string allocation on every cell lookup |
| `solver.js candidates` | variants grouped by box (h,d,w): one integral read per box per position; full-box variants (brick/plate/tile/technic, 106/186 limited) skip the sample scan (`ov = sw`, `over = box − sw`); per-level bounds `Σ min(M_l,V_l)` / `Σ |M_l−V_l|` reject before the scan | 19–55 M variant×position prefilter reads; 68 % of exact scans rejected after scanning |
| `islands.js` | neighbour loops unrolled (same order) | destructuring per neighbour over ~2 M voxels |
| `nn.js knn` | shell iteration skips the cube interior; stable insertion instead of push+sort | (2r+1)³ cells visited per query |

### Results (single grid phase, this sandbox, 2 cores — your machine is faster)

| model | before | after |
|---|---|---|
| tlamp1 @16 | 8.1 s | 1.2 s |
| jawa @16 | 8.5 s | 2.0 s |
| thunder1 @16 | 46 s | 3.0 s |
| deinonic @16 | 97 s | 7.5 s |
| ave_vagc @16 | 117 s | 7.3 s |
| lebis @16 (13 k pieces) | 210 s | 18 s |
| rosewood @24 | 60 s | 4.8 s |
| rosewood @24 Extended | 73 s | 5.7 s |
| hair_f @24 | 63 s | 5.8 s |
| rosewood @24, precision 8 (9 phases) | ~80 s | 9.6 s |

Per grid phase the solve went 1.9 → 0.65 s on rosewood @24 (6.0 → 1.8 s
Extended), so precision 12 is now ~16 × 0.7 s of solver work, spread over the
worker pool in the browser.

### Follow-up the same day (quality, not speed)
See handoff §10: the `beatFlat` rule, the hollow-core implementation and the `retile`
pass. `beatFlat` also removes most of the solver's shaped-part candidates, which is why
the solve got cheaper again (rosewood @24 precision 8: 9.6 s → ~8 s, of which post 1 s).

### What is left, in order
1. **Solver `candidates`** (now ~35 % of a run): the remaining exact scans are
   slopes / shaped parts. §3.1's box decomposition of binary parts and a
   coarser mip prefilter would take most of it; dirty-AABB rescoring (§2.3)
   is not needed — the lazy heap already re-evaluates only on pop.
2. **`splice` has a wall-clock budget** (`spliceTime` 6000 ms, `Date.now()`),
   so results can depend on machine speed. It never bit here, but a
   deterministic budget (attempt count) would make runs reproducible.
3. `bracing` scan (~0.3 s per round, 2 rounds on rosewood, more on lebis):
   candidates could be restricted to cells near the components that changed.
4. `connectIslands` still floods the padded volume (0.3 s at 24 studs).
5. Then the browser-side items: IndexedDB cache of `M` (§2.1), WebGPU (§4).

Note: the browser already runs the grid phases on a Web Worker pool
(`engine.js`), so §2.2 was already in place; only the Node harness is serial.

---

## 1. Where the time actually goes (cost model)

From the handoff, two multipliers were added on top of each other recently:

| Factor | Effect | Notes |
|---|---|---|
| Grid phases (`offsets` on both axes) | **n² full solves** | Precision 12 ⇒ 16 solves |
| Extended catalogue (83 → 210 parts) | 2–3× per solve | big 6x4 / 4x4 doubles have huge footprints |
| Symmetry | up to 2× (even + odd plane both solved) | |
| Post passes (bracing, splice, bridge) | few % | not the problem |

The inner loop of every solve is, for each phase:

```
for cell in free cells          ~ N_cells
  for variant in catalogue      ~ N_parts × rotations   (210 × ≤4 ≈ 600+)
    score = Σ over part footprint of M[sample]    ~ part volume in samples
```

With `G = 5` samples per stud per axis and 2 per plate, a 2x4 brick is
5·10·6 = **300** samples, a 6x4 double slope is ~**1,800**. So a single
candidate evaluation on an extended part costs 6–20× a plate, and there are
more of them. Multiply by n² offsets and the explosion is explained without
any inefficiency in the code.

The three levers, in order of leverage: **(a)** do fewer solves, **(b)** evaluate
fewer candidates, **(c)** make each evaluation O(1) instead of O(volume).
A cache helps (a) and (b); the "3D image" formulation is (c) and is also
what makes a GPU port natural.

**First action before anything else**: profile one solve with the Node
harness (`node --cpu-prof test/run.mjs …`) and confirm the split between
scoring, overlap checks and the greedy heap. Everything below assumes
scoring dominates, which is the usual case but has not been measured.

---

## 2. Caching — four layers, cheapest first

### 2.1 Cross-run cache (user-visible win, zero algorithm risk)
Key = `hash(glb bytes) + studs + ref + hollow`. Store the padded ray-cast
field `M` and the surface samples in IndexedDB (or on disk for the Node
harness). Changing precision, part set, or symmetry then skips the cast
entirely. Cheap because the padded cast is already shared by all offsets.

Second key = `… + offset + partSet + symmetry mode` → store the solved
placement list. Moving the precision slider from 8 to 12 then only runs the
7 new offsets, not 16.

### 2.2 Offsets are independent → parallelise, don't cache
The n² solves share nothing but `M`. A pool of Web Workers (one per core,
`navigator.hardwareConcurrency`) turns 16 sequential solves into ~2–4
wall-clock rounds on a desktop. The engine is already DOM-free and runs in
a worker, so this is plumbing, not engineering. **This is probably the
single biggest wall-clock win available today.**

Also prune: compute a cheap proxy per offset (IoU of the stud-resolution
envelope, no parts) and only fully solve the best 2–3 offsets. The proxy
is a box-filter of `M` — microseconds.

### 2.3 Dirty-region rescoring inside a solve
Lazy greedy with a max-heap already avoids full rescans, but check what
gets invalidated after a placement. The correct rule: a cached score for
`(variant, pos)` is stale only if its footprint intersects the footprint of
the last placed part. Mark a dirty AABB (in sample units), and re-score only
candidates whose AABB overlaps it. On a 16-stud model a placement dirties
<1 % of candidates.

### 2.4 Variant dedup
At sample resolution many extended parts have identical footprints (or
identical "solid box" parts), and rotations of symmetric parts coincide.
Hash each variant's footprint bitset at catalogue load time and keep one
representative per hash (preferring the core part); 600 variants → likely
300–400. Free.

---

## 3. The "literal 3D image" formulation

This is the key idea you asked about, and it is sound. `M` is already a 3D
grayscale image (fractional fill per 4-LDU sample). Every part variant is a
small binary 3D image (a *kernel*). The solver's score

```
score(variant, pos) = matched − w·|V − M| − piecePenalty + kindBonus
```

is a function of two sums over the part footprint F placed at pos:

- `Σ_F M`   (how much of the model the part covers)
- `Σ_F C`   (how much is already covered by placed parts — must be 0)

Everything else (`|V − M|` = volume − Σ_F M, penalties) is arithmetic.
So placement scoring **is** template matching on a 3D image, and all the
tools from image processing apply.

### 3.1 Integral volume (3D summed-area table) → O(1) box sums
Build once per solve (prefix sums along x, then z, then y; one pass each):

```
S[x][z][y] = Σ M over all samples with x'≤x, z'≤z, y'≤y
```

Then the sum over any axis-aligned box is **8 lookups**, regardless of box
size. Summed-area tables (Crow 1984) are exactly what Viola–Jones and fast
template matchers use to make rectangle sums constant-time, and the 3D
version is standard in block matching.

Each part variant is pre-decomposed into a union of axis-aligned boxes at
sample resolution:
- brick / plate / tile: **1 box**
- 45° slope at G=5: a staircase of ~5 boxes
- curved slope: ~5–8 boxes
- round parts: decompose the `cover` mask into row-runs → ~10–20 boxes

Score cost goes from O(volume) (300–1,800) to O(#boxes) (1–20). That is a
**20–100× reduction in the inner loop** with no change in the result —
bit-identical scores. Keep a second integral volume for the covered mask
`C` (rebuilt, or incrementally updated since parts only add) to make the
overlap test O(#boxes) as well. This is the change I would make first after
the worker pool.

### 3.2 Score maps as correlations → GPU-shaped
For a fixed variant, the score at *every* position is the cross-correlation
`M ⋆ K_variant`. Computed naively that is the O(N·|K|) loop above; with an
integral volume it is O(N·boxes); with FFT it is O(N log N) per variant
independent of part size. More importantly, "one output value per position,
read-only inputs" is exactly a compute-shader workload (§4).

The catch is the greedy loop: after one placement, scores near it change.
Two ways round it:
1. **Dirty-region** (§2.3) — recompute the score map only in the AABB.
2. **Parallel greedy / non-maximum suppression** — take all local maxima
   whose footprints don't overlap in one batch, place them all, repeat.
   This is what "maximal layout" construction in the legolization
   literature does implicitly (merge 1x1s until nothing merges). Results
   differ slightly from strict greedy but are usually equal or better
   because the batch is globally chosen.

### 3.3 The 2.5D image: height field → slopes
The volume is column-based (no SNOT), so each (x, z) column is a list of
(bottom, top) spans — a layered depth image. For single-span regions this is
a plain **height image** `h(x, z)` in plates. The most visible open quality
issue (shallow 1-plate steps over ≥1 stud) becomes a 2D problem:

- `∇h` on the height image gives the local slope direction and rise/run.
- A cheese slope is a 2D template "rise 2 plates over 1 stud"; a 1x2 curved
  slope is "rise 3 over 2"; a 2x2 double "rise 3 over 2 in both axes".
- Match these on the height image (2D SAT, trivial), then commit the part
  and lower `h` under it. This runs before the 3D skin phase and would
  replace the "cheese slope rarely chosen" behaviour with a deterministic
  ramp detector. It is a skin-phase change, as the handoff says, but
  formulated as a 2D image op it is a small one.

### 3.4 Distance field and erosion for phase gating
- `erode(M > 0.5, r)` (binary erosion, radius 1 stud) gives the **core**:
  cells where any part cannot touch the surface. Restrict B-fill's large
  bricks to the core and skin parts to `M − erode(M)`. The current phases
  do something like this by ordering; an explicit mask lets you skip whole
  candidate classes per cell instead of scoring and rejecting.
- A Euclidean distance transform of the field gives an SDF; its gradient is
  a cheap surface normal per cell (what the old WFC-0 spec gets from mesh
  normals). Marching-Primitives (CVPR 2023) and its 2025 descendants
  (Light-SQ, SuperFrusta/ResFit) fit primitives directly from a truncated
  SDF, growing them from connected level sets and **subtracting each fitted
  primitive from the residual** — structurally the same loop as brickgen's
  greedy, which suggests the SDF framing scales.
- A **mip pyramid** of `M` (box-filter by 2 per level) lets big parts be
  scored at coarse resolution first and only refined where the coarse score
  is promising — outside-in at the image level, matching the
  Fanni/Giachetti outside-in priority scheme.

---

## 4. GPU

### 4.1 Availability (verified)
WebGPU with compute shaders now ships in Chrome 113+, Firefox 141+ and
Safari 26 (Sept 2025), so compute in the browser is realistic for a 2026
app, with a WebGL/CPU fallback for stragglers.

### 4.2 What is worth porting, and what is not
| Stage | GPU fit | Comment |
|---|---|---|
| Ray-cast volume | excellent | GPU solid voxelization (Schwarz & Seidel 2010; single-pass XOR-parity methods) turns the cast into milliseconds. But the handoff says the cast is *not* the bottleneck, so this is a later nicety. |
| Integral volume build | good | 3 prefix-sum dispatches. |
| Score maps (all variants × all positions) | **excellent** | One thread per (position); loop over variants; write best (score, variantId). Embarrassingly parallel, read-only inputs. |
| Greedy selection | poor | sequential; keep on CPU, or do GPU NMS batches (§3.2). |
| Overlap check | good | same as scoring with the `C` integral volume. |
| Post passes, connectivity | poor | graph algorithms, small; leave in JS. |
| n² offsets | trivial | each offset is a different window of the same `M` → one dispatch per offset, or one dispatch with offset as a workgroup dimension. |

### 4.3 Shape of the implementation
1. Upload `M` (Uint8/Float16, ~ (studs·5)³ samples — a 32-stud model is
   160³ ≈ 4 M samples ≈ 8 MB) and the box-decomposed variant table.
2. Dispatch "score map" → readback best score per cell (one small buffer).
3. CPU pops the best cell, places, marks dirty AABB.
4. Re-dispatch only the dirty AABB (tiny), readback, repeat.

Readback latency (~1 ms per round trip) × thousands of placements is the
risk: a 3,000-piece model is ~3 s of pure latency. So the GPU path only wins
with **batched placement** (NMS, §3.2) — place dozens of non-overlapping
maxima per round trip. Plan for that from the start or the port will be
slower than the SAT-on-CPU path.

Honest ordering: SAT on CPU (§3.1) first. It gives most of the speedup, is
deterministic, testable in the Node harness, and the box-decomposed variant
table it produces is exactly the data the GPU kernel needs later.

---

## 5. What the literature does (SOTA sweep, Oct 2026)

**Legolization — layout from voxels**
- Luo et al., *Legolization* (SIGGRAPH Asia 2015): start from 1x1s, merge
  greedily into a maximal layout, then run a force-flow stability analysis
  and locally re-merge around the weakest spot. The "maximal layout +
  local reconfiguration" pattern recurs in nearly all later work.
- Fanni, De Rossi, Giachetti, *Outside-in priority-based approximation of
  3D models in LEGO bricks* (STAG 2022): outside-in heuristic (shell before
  interior) and a **33-model BRICKS benchmark at three resolutions** — worth
  adopting as a regression set alongside your ten models. Their earlier
  WIP (2021) also searches the best alignment of the model to the brick
  grid, i.e. your grid-phase search, but as a continuous pre-step.
- KAIST SM-GA: split-and-merge genetic algorithm that always keeps a
  feasible layout; slow but a reference for "feasible by construction".
- Several 2025 papers (e.g. the Ljubljana voxel-based paper) still use
  voxelize → component-aware greedy → graph connectivity; none report
  sub-second times at your resolutions. Speed is simply not a focus of this
  literature, which is why the image-processing tools in §3 are not in it.

**Stability rather than connectivity**
- StableLego (Liu et al. 2024) formulates stability as a force-balance
  optimisation over candidate contact forces and ships a 50k-layout dataset.
- LegoGPT / BrickGPT (Pun et al., ICCV 2025 oral) generates brick sequences
  with an LLM and reaches 98.8 % stability only thanks to a per-brick
  validity check and physics rollback (24 % without). Limited to 20³ and 8
  brick types, so not a competitor, but its **fast incremental validity
  check** (legal dims, bounds, no collision, then per-brick equilibrium) is
  the kind of thing that could replace union-find stud contact if
  real-world stability ever matters more than "one component".

**Accurate shape fitting (primitives from volumes/SDFs)**
- Marching-Primitives (CVPR 2023): superquadrics grown from connected
  components of SDF level sets, probabilistic fit, subtract, repeat.
- Light-SQ (2025): adds **SDF carving** — after each primitive is fitted the
  target SDF is updated to discourage overlap. That is precisely the
  `C`-mask / residual idea in §3.
- ResFit / SuperFrusta (Dec 2025, CVPR 2026 oral): residual primitive
  fitting, +9 IoU with half the primitives vs prior work. Primitives are
  continuous, not LEGO, but the loop (global analysis → local fit →
  residual) is the one to copy.
- Robust cuboid fitting (Kluger et al., CVPR 2021 / TPAMI 2024): RANSAC
  guided by a network, occlusion-aware distance. Interesting mainly as a
  reminder that **point-to-primitive distance alone produces oversized
  cuboids** — the same failure as big extended slopes grabbing cells before
  core parts (your A2-skin-ext fix).

**GPU voxelization**
- Schwarz & Seidel, *Fast parallel surface and solid voxelization on GPUs*
  (SIGGRAPH Asia 2010): conservative and 6-separating surface voxelization,
  triangle-parallel and tile-based solid voxelization, sparse octree output.
- Eisemann & Décoret, single-pass solid voxelization (XOR parity in a bit
  volume). A 2024 CGF paper (equidistant scanlines with gap detection)
  updates the surface case. Any of these replaces the vertical ray cast.

**Integral images / block matching**
- Crow 1984 (summed-area tables); Viola–Jones 2004; IPOL "Integral Images
  for Block Matching" (Facciolo et al.) quantifies the speed-up and its
  limits; 3D integral images are used for 3D block matching on volumes.
  The limit they note — the gain disappears when templates are tiny —
  does not bite here because the costly parts are the big ones.

---

## 6. Recommended order

1. **Profile** one solve (`--cpu-prof` on `test/run.mjs`), tlamp1 @16 and
   rosewood @24, Limited and Extended. Confirm scoring dominates.
2. **Worker pool over offsets** + offset pruning by envelope IoU. Pure
   plumbing; expect 3–6× wall clock at precision 12.
3. **Variant dedup** by footprint hash. Free.
4. **Integral volume scoring** with box-decomposed variants, bit-identical
   results, verify with `batch10.mjs` numbers. Expect 10–50× on the inner
   loop, more on Extended.
5. **Dirty-AABB rescoring** in the lazy greedy.
6. **Cross-run cache** (IndexedDB) of `M` and per-offset results.
7. **Height-image ramp detector** for shallow steps — the quality item, not
   a speed item, but it falls out of the same 2.5D image framing.
8. Only then **WebGPU** score maps with batched NMS placement, keeping the
   SAT/CPU path as the fallback and the oracle for tests.

Steps 2–5 need no new dependencies and are all checkable in the Node
harnesses without touching the browser.

---

## Sources

- Legolization (Luo et al., SIGGRAPH Asia 2015) — https://history.siggraph.org/?p=210389
- Outside-in priority-based approximation of 3D models in LEGO bricks (Fanni, De Rossi, Giachetti, STAG 2022) — https://diglib.eg.org/bitstream/handle/10.2312/stag20221256/057-067.pdf
- Approximating shapes with standard and custom 3D printed LEGO (Fanni, Giachetti, STAG 2021) — https://diglib.eg.org/bitstream/handle/10.2312/stag20211487/175-179.pdf
- Split-and-merge GA for LEGO layouts (KAIST) — https://dspace.kaist.ac.kr/handle/10203/245897
- Voxel-based LEGO conversion (Ljubljana, 2025) — https://lgm.fri.uni-lj.si/wp-content/uploads/2025/09/244517379.pdf
- LegoGPT / BrickGPT (Pun et al., 2025) — https://papers.cool/arxiv/2505.05469 ; ICCV oral https://iccv.thecvf.com/virtual/2025/oral/2912
- StableLego / BrickGPT overview — https://www.emergentmind.com/topics/lego
- Marching-Primitives (Liu et al., CVPR 2023) — https://arxiv.org/abs/2303.13190v2
- Light-SQ (2025) — https://arxiv.org/html/2509.24986v1
- Residual Primitive Fitting with SuperFrusta (Ganeshan et al., Dec 2025) — https://www.arxiv.org/abs/2512.09201
- Robust Shape Fitting for 3D Scene Abstraction (Kluger et al., 2024) — https://arxiv.org/abs/2403.10452
- Fast parallel surface and solid voxelization on GPUs (Schwarz & Seidel, 2010) — https://hgpu.org/?p=5264
- Single-pass GPU solid voxelization (Eisemann & Décoret) — https://publications.graphics.tudelft.nl/ (solidvoxelization author version)
- Summed-area table — https://en.wikipedia.org/wiki/Summed-area_table
- Integral Images for Block Matching (IPOL preprint) — https://tools.ipol.im/mailman/archive/announce/2013-July/000010.html
- WebGPU browser support 2025 — https://ics.media/en/entry/230426/
