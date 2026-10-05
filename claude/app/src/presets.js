// High-level feature groups: one switch per idea, each writing the handful of low-level options that idea is made of.
// The settings panels show these; `schema.js` still lists every individual option behind them (the "All parameters" drawer).
// A group is `on` when every key it owns has its `on` value, `off` when every key has its `off` value, `custom` otherwise -
// so turning one low-level option by hand is visible rather than silently overridden.

export const FEATURES = [
  { key: 'auto', label: 'Automatic resolution', group: 'Scale',
    help: 'choose the stud count from the mesh before solving (docs/CURVES.md round 8): the smaller of a piece budget and the curvature ceiling, then the best-aligned count within 15 %. Overrides the resolution slider',
    on: { studsAuto: true }, off: { studsAuto: false } },
  { key: 'lattice', label: 'Snap to the LEGO lattice', group: 'Scale',
    help: 'scale within 5 % and shift in x / z so the model\'s flat faces sit on stud and plate boundaries. A flat face at a fractional position is what renders as a mosaic of partial plates (chair IoU .872 -> .922)',
    on: { gridAlign: true }, off: { gridAlign: false } },
  { key: 'symmetry', label: 'Mirror symmetry', group: 'Scale',
    help: 'detect a mirror plane and solve both parities, so the two halves get the same pieces',
    on: { symmetry: 'auto' }, off: { symmetry: 'off' } },

  { key: 'discs', label: 'Disc layers', group: 'Shape',
    help: 'a level whose solid cross-section is a circle (a table top, a rim, a pole) is laid the way a builder lays one: rows of 1xN plates, turned 90 degrees on the next level, no lone 1x1 inside. Measured on the table: 660 -> 609 pieces at a higher IoU',
    on: { discs: true }, off: { discs: false } },
  { key: 'curves', label: 'Rounded surfaces', group: 'Shape',
    help: 'the sloped-skin recipe for round and organic shapes (docs/CURVES.md round 5): 1-wide skin parts first with their slope aligned to the surface gradient under them, pairs fused back into the catalogue\'s 2-wide parts, quarter-round tiles on convex corners, and the round family placed before or after the skin depending on how sloped the model is',
    on: { skinNarrow: true, skinAlign: 0.6, widen: true, roundCorners: true, roundsAfterSkin: 'auto' },
    off: { skinNarrow: false, skinAlign: 0, widen: false, roundCorners: false, roundsAfterSkin: false } },
  { key: 'skin', label: 'Sloped skin (slopes, curves, cheese)', group: 'Shape',
    help: 'the shaped parts that follow the surface; off leaves a staircase of plates',
    on: { skin: true, inverted: true }, off: { skin: false, inverted: false } },
  { key: 'rounds', label: 'Round parts and poles', group: 'Shape',
    help: 'round bricks and plates for poles, bosses and round cross-sections',
    on: { rounds: true }, off: { rounds: false } },
  { key: 'motifs', label: 'Assemblies learned from official sets', group: 'Shape',
    help: 'multi-part assemblies mined from 1,148 LDraw models, placed as compound parts before any single part. Verification solves the model a second time without them and keeps them only where they pay (they build chairs and ruin smooth slopes)',
    on: { motifs: true, motifVerify: true }, off: { motifs: false } },
  { key: 'snot', label: 'Sideways building (SNOT)', group: 'Shape',
    help: 'parts hung on the side studs of headlight bricks and brackets, synthesised from the side-stud positions recovered from the mined motifs. Experimental: it hangs small parts wherever a partial cell lets it, for little fidelity',
    on: { snot: true }, off: { snot: false } },

  { key: 'crust', label: 'Hollow core', group: 'Build',
    help: 'erase the interior deeper than two studs below the surface, so only the shell is built: far fewer pieces, same look',
    on: { crust: true }, off: { crust: false } },
  { key: 'connect', label: 'Connect and brace', group: 'Build',
    help: 'join the separate components (tubes between islands, bridge chains inside the solid, spliced seams, bracing) and drop single pieces that touch nothing',
    on: { islands: true, bracing: true, splice: true, bridge: true, bridgeOutside: false, dropLoose: 1 },
    off: { islands: false, bracing: false, splice: false, bridge: false, bridgeOutside: false, dropLoose: 0 } },
  { key: 'merge', label: 'Merge and retile', group: 'Build',
    help: 'fuse neighbouring pieces of the same colour into longer ones, turn three levels of plates into bricks, and convert isolated columns into round poles',
    on: { retile: true, mergeVertical: true, mergeHorizontal: true, pillars: true },
    off: { retile: false, mergeVertical: false, mergeHorizontal: false, pillars: false } },
  { key: 'supports', label: 'Support columns', group: 'Build',
    help: 'columns under overhangs that nothing carries',
    on: { supports: true }, off: { supports: false, groundSupports: false } },
  { key: 'finish', label: 'Finish with flat tiles', group: 'Build',
    help: 'tiles on top of the exposed bricks, so the model does not end on studs',
    on: { finish: true }, off: { finish: false } },
];

export const FEATURE_GROUPS = [...new Set(FEATURES.map((f) => f.group))];
const same = (a, b) => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, k) => x === b[k]) : a === b);
/** 'on' | 'off' | 'custom' */
export const featureState = (opts, f) => {
  const on = Object.keys(f.on).every((k) => same(opts[k], f.on[k]));
  if (on) return 'on';
  return Object.keys(f.off).every((k) => same(opts[k], f.off[k])) ? 'off' : 'custom';
};
/** the options a group writes when switched */
export const featurePatch = (f, on) => ({ ...(on ? f.on : f.off) });
/** every low-level key a group owns (to grey it out elsewhere, or to list it) */
export const featureKeys = (f) => [...new Set([...Object.keys(f.on), ...Object.keys(f.off)])];
