// How does surface grain reach the solver? Add Gaussian displacement along the vertex normals at known amplitudes (LDU), solve,
// and grade the result against the field of the CLEAN mesh (not the noisy one, which would grade the noise as ground truth).
//
// usage: node test/noise_bench.mjs <model.glb | house> [studs] [sigmas LDU, e.g. 0,1,2,4]
//   OPTS="meshSmooth=10 field=sdf sdfSigma=1 ..." env passes engine options, like the other benches; REF=self grades against the
//   noisy field instead (what `metrics` does in the app). Pieces are the solver's (before post), `merged` after the volume-preserving
//   merge passes, `1x1` the share of 1x1 pieces (fragmentation), `clean IoU` the occupancy IoU against the clean field.
import fs from 'node:fs';
import { parseGLB } from '../src/brickgen/mesh.js';
import { prepare, window } from '../src/brickgen/grid.js';
import { solve } from '../src/brickgen/run.js';
import { catalogFor, DEFAULTS } from '../src/brickgen/pipeline.js';
import { house, perturb } from './synthetic.mjs';
import { vertical, horizontal, retile, mergePairs } from '../src/brickgen/post.js';
import { STUD } from '../src/brickgen/constants.js';

const [file = 'house', studsArg, sigmasArg = '0,1,2,4'] = process.argv.slice(2);
const extra = {}; for (const kv of (process.env.OPTS || '').split(' ').filter(Boolean)) { const [k, v] = kv.split('='); extra[k] = isNaN(+v) ? (v === 'true' ? true : v === 'false' ? false : v) : +v; }

/** two sub-cell triangles at the corners of `box` so that both meshes normalise identically */
const anchored = (model, box) => {
  const [lo, hi] = box, e = 1e-3, a = [], tri = (p) => a.push(p[0], p[1], p[2], p[0] + e, p[1], p[2], p[0], p[1] + e, p[2]);
  tri(lo); tri([hi[0] - e, hi[1] - e, hi[2]]);
  const tris = new Float32Array(model.tris.length + a.length); tris.set(model.tris); tris.set(a, model.tris.length);
  const vcols = new Float32Array(tris.length); vcols.set(model.vcols);
  return { ...model, tris, vcols };
};
const bbox = (tris) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let k = 0; k < tris.length; k += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], tris[k + c]); hi[c] = Math.max(hi[c], tris[k + c]); } return [lo, hi]; };
const union = (a, b) => [a[0].map((v, i) => Math.min(v, b[0][i])), a[1].map((v, i) => Math.max(v, b[1][i]))];

const base = file === 'house' ? house() : (() => { const b = fs.readFileSync(file); return parseGLB(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); })();
// the model's own scale: the house is in LDU already (12 studs wide); a GLB is scaled so its longest horizontal side = studs
const studs = +(studsArg || (file === 'house' ? 12 : 24));
const o = { ...DEFAULTS, studs, ref: 'maxh', partSet: 'extended', motifs: false, symmetry: 'off', offsets: [0], decimate: false, ...extra };
// sigma is given in LDU of the normalised model: convert to model units through the clean model's scale
const [lo0, hi0] = bbox(base.tris), scale = studs * STUD / Math.max(hi0[0] - lo0[0], hi0[2] - lo0[2]);
const cat = catalogFor(o);
const rows = [];
for (const sLdu of sigmasArg.split(',').map(Number)) {
  const noisy = perturb(base, sLdu / scale);
  // the mesh the solver sees: noisy, then whatever the engine's own pre-pass does to it; anchored LAST, so that both meshes
  // normalise into the same frame whatever the pre-pass did to the bounding box (a half-cell shift alone costs 0.4 of |dM|)
  const { smoothModel } = await import('../src/brickgen/smooth.js');
  const seen0 = o.meshSmooth ? smoothModel(noisy, o.meshSmooth, o.meshLambda, o.meshMu) : noisy;
  const box = union(bbox(base.tris), bbox(seen0.tris));
  const mClean = anchored(base, box), seen = anchored(seen0, box);
  const preN = prepare({ tris: seen.tris, pts: new Float32Array(0) }, studs, o), preC = prepare({ tris: mClean.tris, pts: new Float32Array(0) }, studs, { ...o, gridAlign: preN.align ? { s: preN.s, shift: preN.shift } : false });   // the reference in the SAME frame (scale + shift), whatever alignment the engine chose
  const S = solve(preN, cat, 0, 0, o);
  const ref = (process.env.REF === 'self' ? window(preN, 0, 0) : window(preC, 0, 0)).arr;
  // the clean mesh solved in this very frame: the piece count to aim for (the frame moves a little with the noisy bounding box)
  const Sc = solve(preC, cat, 0, 0, { ...o, field: 'rays', meshSmooth: 0 }); let mc = 0, tc = 0, oc = 0; for (let k = 0; k < ref.length; k++) { mc += Math.min(ref[k], Sc.C[k]); tc += ref[k]; if (Sc.C[k] > ref[k]) oc += Sc.C[k] - ref[k]; }
  let matched = 0, total = 0, over = 0;
  for (let k = 0; k < ref.length; k++) { const m = ref[k], c = S.C[k]; matched += Math.min(m, c); total += m; if (c > m) over += c - m; }
  // field-level noise at the SURFACE: mean |dM| over the clean field's boundary cells (fractional, or next to an empty cell); the
  // interior is 1 in both fields and would only dilute the number
  const wC = window(preC, 0, 0), Mn = window(preN, 0, 0).arr, nxw = wC.nxc * 5, nzw = wC.nzc * 5; let dm = 0, cells = 0;
  for (let l = 0; l < preC.nl; l++) for (let z = 0; z < nzw; z++) for (let x = 0; x < nxw; x++) {
    const k = (l * nzw + z) * nxw + x, m = ref[k]; if (m <= 0) continue;
    const edge = m < 0.999 || (x > 0 && ref[k - 1] === 0) || (x < nxw - 1 && ref[k + 1] === 0) || (z > 0 && ref[k - nxw] === 0) || (z < nzw - 1 && ref[k + nxw] === 0) || (l > 0 && ref[k - nzw * nxw] === 0) || (l < preC.nl - 1 && ref[k + nzw * nxw] === 0);
    if (edge) { dm += Math.abs(m - Mn[k]); cells++; }
  }
  const phases = {}; for (const p of S.pieces) { const ph = p.phase.replace(/-.*/, ''); phases[ph] = (phases[ph] || 0) + 1; }
  const n0 = S.pieces.length, one = S.pieces.filter((p) => p.w === 1 && p.d === 1).length;
  for (const p of S.pieces) p.rgb = [128, 128, 128];
  vertical(S, cat, 1); horizontal(S, cat, 'plate', 1); horizontal(S, cat, 'tile', 1); retile(S, cat, 1); mergePairs(S, cat, 'plate', 1); mergePairs(S, cat, 'brick', 1);
  const kinds = {}; for (const p of S.pieces) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
  rows.push({ sigma_LDU: sLdu, 'surface |dM|': +(dm / cells).toFixed(3), 'clean pieces/IoU': `${Sc.pieces.length} / ${(mc / (tc + oc)).toFixed(3)}`, pieces: n0, merged: S.pieces.length, '1x1 %': +(100 * one / n0).toFixed(0), 'clean IoU': +(matched / (total + over)).toFixed(3), recall: +(matched / total).toFixed(3), overfill: +(over / total).toFixed(3),
    phases: Object.entries(phases).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '),
    kinds: Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${v}`).join(' ') });
}
console.log(`${file} @${studs} studs, OPTS="${process.env.OPTS || ''}", reference = ${process.env.REF === 'self' ? 'the noisy field itself' : 'the CLEAN field'}`);
console.table(rows);
