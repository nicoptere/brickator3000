// Units: LDU. 1 stud pitch = 20 LDU, 1 plate = 8 LDU, 1 brick = 3 plates = 24 LDU.
export const STUD = 20.0;
export const PLATE = 8.0;
export const G = 5;                 // volume samples per stud along x and z
export const SAMP = STUD / G;       // 4 LDU sample pitch
export const PAD = 16.0;            // grid phases (offsets) are multiples of SAMP in [0, PAD]; the volume is ray-cast once on a padded grid

/** every tunable of the method, with the values used by the Python reference */
export const DEFAULTS = {
  // scale
  studs: 16,                 // stud count of the reference side
  ref: 'min3',               // 'min3' = smallest side of the bounding box, 'maxh' = longest horizontal side
  // volume
  mode: 'hollow',            // 'hollow' (surface orientation) | 'envelope' (lowest..highest hit)
  snap: 12.0,                // LDU: gap above the ground snapped shut
  minThick: true,            // sheets thinner than 0.8 plate are fattened to one plate
  minGap: 6.0,               // LDU: air thinner than this between two solid intervals is closed
  superSample: 1,            // rays per field cell per axis: 1 = one centre ray, 2 = 2x2 area average (more exact, but the
                             // coverage thresholds below are tuned for point sampling, so raising it costs IoU until they are retuned)
  fieldSmooth: 0,            // 0..1: blend a cell with its 4 lateral neighbours where the neighbourhood is sparse (thin struts).
                             // Helps strut-heavy models (aircraft) and hurts dense ones, so it is opt-in; see docs/MOTIFS.md
  fieldSmoothThin: 0.5,      // only cells whose lateral neighbour mean is <= this are smoothed
  gridAlign: true,           // snap the model to the LEGO lattice: scale within +-alignTol and x/z shifts so the dominant planar faces sit on stud / plate boundaries (grid.latticeFit)
  alignTol: 0.05,            // how far from "longest side = N studs" the lattice fit may scale (5 % = N +- 2.4 studs at 48)
  alignMinGain: 0.15,        // the lattice score must improve by this much over the default scale before the scale is changed (shifts always apply)
  field: 'rays',             // 'rays' = one vertical ray per 4-LDU cell (the method so far) | 'sdf' = signed distance field (sdf.js)
  sdfSigma: 0,               // LDU: Gaussian on the SDF before occupancy; denoises grain but rounds creases by ~sigma; 0 = off
  sdfMedian: 0,              // cells: radius of a median filter on the SDF (edge-preserving denoise, 1 = 3x3x3); applied before the Gaussian
  sdfBand: 2,                // cells: exact distances this far from the surface, clamped beyond (occupancy only needs ~1)
  sdfRamp: 0,                // LDU: 0 = occupancy from the SDF's zero crossings, quantised like the ray field (matches the part templates); > 0 = anti-aliased cube ramp
  fieldCascade: false,       // broad phases (motifs, round, skin, fill) see a coarse field, the detail phases the sharp one (run.js)
  cascadeSigma: 6,           // LDU: the coarse field's Gaussian (needs field: 'sdf')
  meshSmooth: 0,             // Taubin lambda|mu iterations on the welded mesh before anything else (smooth.js); rounds creases, so opt-in
  meshLambda: 0.5, meshMu: -0.53,
  surfaceSamples: 200000,
  seed: 1,
  // grid phase search
  offsets: [0, 4, 8],        // LDU, tried on both axes (multiples of 4); the Precision slider (0/4/8/12) sets it to every multiple of 4 up to its value
  precision: 8,
  partSet: 'limited',   // 'limited' (core catalogue) | 'extended' (+ extra LDraw shapes)
  shapeSolo: ['round'],      // kinds of the measured shape parts (catalog_shapes.js) allowed as solo candidates: discs / quarter discs / cones
  shapeParts: false,    // let the frequent shapes compete as single parts too (they are always available to motifs): arches, panels, dishes, corner tiles, curved-top bricks (catalog_shapes.js)
  // symmetry
  symmetry: 'off',           // 'auto' | 'off'
  symThreshold: 0.006,       // mean mirror distance / bbox diagonal
  parity: 'auto',            // 'auto' (solve both) | 'even' (plane on a stud seam) | 'odd' (plane on a stud centre line)
  // broad phase: motifs = multi-part assemblies mined from the OMR models (motifs/library.js); off = the method as before, bit-identical.
  // motifSnot keeps the ones that hold a sideways part (a tile clamped between two headlight bricks and the like): they are placed
  // as one rigid assembly, kept out of the merge passes, and exported with their real orientation (motifs/orient.js).
  motifs: false, motifTol: { min_cov: 0.85, max_err: 0.06, piece_pen: 0.3, beatFlat: 0.8 },   // beatFlat: a motif must explain its box better than plain plates / bricks would (else the fill phases do it with fewer pieces)
  motifMinModels: 2, motifMinCount: 3, motifMaxParts: 12, motifSolid: false, motifShapedOnly: true, motifMirror: true, motifSnot: true, motifStretch: false, motifStretchMax: 4, motifStretchCells: 96,   // synthesising the missing lengths raises recall ~0.004 but multiplies disconnected components (duck 1 -> 25+): off
  motifBonus: 0.2, motifBonusLog: 0.1, motifMinPartH: 2,   // these three had been swallowed by the comment above and the library's own fallbacks (0.2 / 0.1 / 2) applied; written out with those values so nothing changes
  motifShapedMin: 0,         // min share of an assembly's volume in shaped parts (0 = off): .5 drops "a slope on a long brick"; +.8 IoU on the chair for +26 % pieces, so off (docs/CURVES.md)
  motifScoring: false,       // also run the motif phase while scoring the grid phases (9x slower); off = only the final solve uses motifs
  motifVerify: true, motifGain: 0.01,   // the final field is also solved without the assemblies; they are kept only if they gain this much IoU (docs/CURVES.md)
  // phases
  dropLoose: 1,              // post: components of at most this many pieces that touch nothing are removed (a cheese on a wing tip); 0 = keep
  roundCorners: true,        // after finish: exposed 1x1 tiles on convex corners become quarter-round tiles (post.roundCorners); IoU unchanged, table 12 / duck 56 corners
  discs: true, discMinR: 2, discRms: 0.45, discIoU: 0.85, discsExposed: true, discRing: 1.5,   // disc layers (discs.js, phase A1 before the motifs): a level whose solid component is a circle of radius >= discMinR studs is laid as rows of plates, direction alternating per level. Measured: table 660 -> 609 pieces, IoU .789 -> .799; duck -19 pieces; the others untouched (no round layer). discsExposed limits it to layers whose top shows (table tops, rims); laying every layer of a sphere overfills (table rim: IoU .727)
  rounds: true, roundTol: { min_cov: 0.85, max_err: 0.12, piece_pen: 0.5, bonus: { round: 0.4 } },
  skin: true, skinTol: { min_cov: 0.65, max_err: 0.14, piece_pen: 0.3, bonus: { slope: 0.7, curved: 0.6, cheese: 0.5, inverted: 0.6 } },
  inverted: true,
  fillTol: { min_cov: 0.90, max_err: 0.06, piece_pen: 0.6 },
  fill2: true, fill2Tol: { min_cov: 0.80, max_err: 0.16, piece_pen: 0.6, w_err: 1.5 },
  relaxed: true, relaxedTol: { min_cov: 0.5, max_err: 0.5, piece_pen: 0.15, w_err: 0.9 },
  fallback: true, fallbackMin: 0.5,
  thin: true, thinBand: [0.3, 0.5], thinPoints: 4,
  technic: true,
  wErr: 3.0,                 // default weight of |V - M| in the score
  // the sloped skin on curved surfaces (docs/CURVES.md, round 5)
  skinNarrow: true,          // the 1-wide skin parts first: they fit doubly curved surfaces where 2-wide parts fail on their cross slope; post.widen fuses pairs back
  shapeSoloIds: [],          // measured shapes allowed solo by id whatever their kind (pipeline.shapesFor); empty: the inverted 33 slopes are core parts now (4287, 3747)
  skinAlign: 0.6,            // +- this much net for a shaped part whose slope direction agrees / disagrees with the surface gradient there (solver.align); 0 = off
  widen: true,               // post: two identical 1-wide shaped parts side by side become the catalogue's 2-wide version (post.widen)
  profiles: false, profileTol: { min_cov: 0.65, max_err: 0.14, piece_pen: 0.3, bonus: { slope: 0.7, curved: 0.6, cheese: 0.5, inverted: 0.6 } }, profileSkip: 0.4, profileMaxLen: 4, profileExt: false,   // profile chains (skin.js): rows of 1-wide parts chosen per row by DP - measured below the narrow greedy, kept as an option
  beatFlat: 0.9,             // a shaped part (slope, curve, round, wedge) is only a candidate where its error is below this fraction of the best flat plate / brick stack in the same box (1 = off)
  tileExposure: 0.35,        // a tile is refused if the level above is fuller than this
  // crust: erase the hollow core (voxels deeper than crustDepth LDU below the surface) so only the shell is solved
  crust: true, crustDepth: 40,     // 40 = two studs of wall; 60 only hollows chunky ones
  // islands: MST of thin tubes between the 3D components of the source volume (before solving)
  decimate: true,            // erase tiny floating components (debris) even when islands are not tube-joined
  islands: true, tubeWidth: 4, islandDrop: 0.002, islandDropMax: 40, islandOcc: 0.25, islandThinPoints: 2,
  // post-process
  retile: true,              // three levels of plates -> bricks, committed per level only if connectivity holds
  mergeVertical: true, mergeHorizontal: true, colorTol: 22,
  pillars: true, pillarMinLevels: 3,
  pillarCluster: 2,          // thin (1x1) neighbours a pole may touch per level: 0 = only a fully isolated column (old
                             // behaviour), 2 = strut pairs and rows of railings convert too. Wider neighbours always veto.
  bracing: true, braceMaxGap: 3, braceMaxSpan: 4, braceRounds: 40,
  splice: true, spliceRounds: 60, spliceTries: 80, spliceTime: 6000,   // re-cut side-by-side pieces of different components so a 1x2 plate spans the seam
  bridge: true, bridgeMax: 10, bridgeRounds: 120,    // shortest plate chain (zig-zag) through free cells between two components
  vertexNormals: false,      // main-thread pre-step (three.js welded vertex normals): flips reversed triangles before the ray cast
  supports: false, groundSupports: false, supportMinFrac: 0.01, supportSpacing: 24,
  finish: false, finishBricks: 'add', // 'add' (tile on top of exposed bricks) | 'none'
  // colour
  colorK: 10,
  colorVisible: true,        // colour from surfaces visible from outside only (hidden interior geometry cannot bleed through a shell)
  palette: 'cheat',          // 'cheat' (mean of nearest samples) | 'lego' (snap to the LEGO solid palette)
};
