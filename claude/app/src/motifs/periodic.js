// Scale: a mined motif is frozen at the length it happened to have in the source set - a row of 3 cheese slopes exists, the same
// row of 5 does not. A motif that is invariant under a translation along one axis is a repeated unit, so every other repeat count
// is a valid assembly too and can be synthesised instead of waiting for a set to contain it.
// (Rows of cheese / inverted slopes, round-brick pillars, plate stacks, brick+slope walls: ~1 motif in 8 is periodic.)

// `dims(id, rot) -> [w, d, h]` keeps this file free of the catalogue and of node-only imports (it runs in the worker too).
const AX = ['i', 'j', 'b'];

/**
 * period of a motif along one axis, or 0: the smallest p < extent such that the parts starting at a >= p are exactly the parts
 * starting at a < extent - p, shifted by p (so the motif is "unit repeated n times" along that axis).
 */
export function periodOf(parts, box, axis, dims) {
  const a = AX[axis], ext = box[axis];
  const key = (p, shift = 0) => `${p.id}|${p.rot}|${AX.map((k, n) => p[k] + (n === axis ? shift : 0)).join(',')}`;
  const all = new Set(parts.map((p) => key(p)));
  for (let per = 1; per < ext; per++) {
    if (ext % per) continue;
    let ok = true;
    for (const p of parts) {
      const size = dims(p.id, p.rot)[axis];
      if (p[a] + size <= ext - per) { if (!all.has(key(p, per))) { ok = false; break; } }       // must repeat forward
      if (p[a] >= per) { if (!all.has(key(p, -per))) { ok = false; break; } }                   // and backward
    }
    if (ok && parts.some((p) => p[a] < per)) return per;
  }
  return 0;
}

/**
 * motifs synthesised from the periodic ones: the same unit repeated n times, for every n up to `max` that was not mined itself.
 * Returns records in the mined format (w, d, h, parts, n, models) plus `synth: <source repeats>`.
 */
export function stretch(motifs, dims, { max = 8, maxCells = 512, maxParts = 12, studded = null } = {}) {
  const have = new Set(motifs.map((m) => m.key));
  const out = [];
  for (const m of motifs) {
    const box = [m.w, m.d, m.h];
    for (let axis = 0; axis < 3; axis++) {
      const per = periodOf(m.parts, box, axis, dims);
      if (!per) continue;
      const reps = box[axis] / per, unit = m.parts.filter((p) => p[AX[axis]] < per);
      if (reps < 2 || unit.length > maxParts) continue;
      // every repeat must be able to carry (and be carried by) something: a long run of studless parts ends up floating, and the
      // bracing / bridge passes cannot repair a chain that has no stud anywhere (duck: 1 -> 55 components without this test)
      if (studded && !unit.some((p) => studded(p.id))) continue;
      for (let n = 2; n <= max; n++) {
        if (n === reps || n * unit.length > maxParts) continue;
        const nb = box.slice(); nb[axis] = per * n;
        if (nb[0] * nb[1] * nb[2] > maxCells || nb[axis] > 16) continue;
        const parts = [];
        for (let k = 0; k < n; k++) for (const p of unit) parts.push({ ...p, [AX[axis]]: p[AX[axis]] + k * per });
        const key = `${nb[0]},${nb[1]},${nb[2]}|` + parts.map((p) => `${p.id}:${p.rot}:${p.i},${p.j},${p.b}`).sort().join(' ');
        if (have.has(key)) continue;
        have.add(key);
        out.push({ key, w: nb[0], d: nb[1], h: nb[2], n: m.n, models: m.models, parts, synth: reps });
      }
      break;                                      // one axis is enough: a motif periodic on two axes is a slab, rare and huge
    }
  }
  return out;
}
