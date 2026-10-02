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
  surfaceSamples: 200000,
  seed: 1,
  // grid phase search
  offsets: [0, 8, 16],       // LDU, tried on both axes (multiples of 4)
  // symmetry
  symmetry: 'off',           // 'auto' | 'off'
  symThreshold: 0.006,       // mean mirror distance / bbox diagonal
  parity: 'auto',            // 'auto' (solve both) | 'even' (plane on a stud seam) | 'odd' (plane on a stud centre line)
  // phases
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
  tileExposure: 0.35,        // a tile is refused if the level above is fuller than this
  // crust: erase the hollow core (voxels deeper than crustDepth LDU below the surface) so only the shell is solved
  crust: true, crustDepth: 60,
  // islands: MST of thin tubes between the 3D components of the source volume (before solving)
  islands: true, tubeWidth: 4, islandDrop: 0.002, islandDropMax: 40, islandOcc: 0.25, islandThinPoints: 2,
  // post-process
  mergeVertical: true, mergeHorizontal: true, colorTol: 22,
  pillars: true, pillarMinLevels: 3,
  bracing: true, braceMaxGap: 3, braceMaxSpan: 4, braceRounds: 40,
  splice: true, spliceRounds: 60, spliceTries: 80,   // re-cut side-by-side pieces of different components so a 1x2 plate spans the seam
  bridge: true, bridgeMax: 10, bridgeRounds: 120,    // shortest plate chain (zig-zag) through free cells between two components
  supports: false, groundSupports: false, supportMinFrac: 0.01, supportSpacing: 24,
  finish: false, finishBricks: 'add', // 'add' (tile on top of exposed bricks) | 'none'
  // colour
  colorK: 10,
  palette: 'cheat',          // 'cheat' (mean of nearest samples) | 'lego' (snap to the LEGO solid palette)
};
