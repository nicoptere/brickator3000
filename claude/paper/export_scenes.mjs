// Everything the paper's figures need from the engine, written as JSON / LDR into an output directory (figures.py reads them).
// usage: node claude/paper/export_scenes.mjs <outdir>        (run from claude/app, needs models/*.glb)
import fs from 'node:fs';
import path from 'node:path';
import { parseGLB } from '../app/src/brickgen/mesh.js';
import { generate, catalogFor, DEFAULTS, FULL_CATALOG } from '../app/src/brickgen/pipeline.js';
import { prepare, window, latticeFit } from '../app/src/brickgen/grid.js';
import { solve } from '../app/src/brickgen/run.js';
import { toLDR, KIND_COL } from '../app/src/brickgen/export.js';
import { partVariants } from '../app/src/brickgen/variants.js';
import { bounds } from '../app/src/brickgen/mesh.js';
import { STUD, PLATE, G, SAMP, PAD } from '../app/src/brickgen/constants.js';
import { house, perturb } from '../app/test/synthetic.mjs';
import MOTIFS from '../app/src/motifs/motifs.js';

const out = process.argv[2] || 'out/paper'; fs.mkdirSync(out, { recursive: true });
const W = (name, obj) => fs.writeFileSync(path.join(out, name), typeof obj === 'string' ? obj : JSON.stringify(obj));
const load = (f) => { const b = fs.readFileSync(f); return parseGLB(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const FULL = { ref: 'maxh', partSet: 'extended', precision: 4, offsets: [0, 4], motifs: true, crust: true, islands: true, bracing: true, splice: true, bridge: true, supports: true, groundSupports: false, finish: true, symmetry: 'off' };
const rgb255 = (c) => c.map((x) => Math.round(x * 255));
const kindRGB = (p) => rgb255(p.snot ? [0.1, 0.95, 0.75] : p.motif ? [1, 0.1, 0.35] : (KIND_COL[p.kind] || [0.7, 0.7, 0.7]));
const ldrWith = (pieces, cat, name, colour) => toLDR(pieces.map((p) => ({ ...p, rgb: colour(p), code: undefined })), cat, name);
const fieldJSON = (pre, ox = 0, oz = 0) => { const w = window(pre, ox, oz); const nx = w.nxc * G, nz = w.nzc * G, nl = w.arr.length / (nx * nz); return { nl, nz, nx, data: Array.from(w.arr, (v) => +v.toFixed(2)) }; };

// ---------------------------------------------------------------------------------------------- A. models: source, solution, kinds
const MODELS = [['duck', 24], ['bieder_chair', 32], ['be2', 48], ['table_baked', 32], ['dolphin', 32], ['rafs5', 48]];
const summary = {};
for (const [name, studs] of MODELS) {
  const model = load(`models/${name}.glb`), t0 = Date.now();
  const r = generate(model, { ...FULL, studs }), cat = catalogFor(r.options);
  // the source mesh, in the solution's frame: normalise exactly as the engine did (scale + PAD + shift), engine frame Y up
  const { lo } = bounds(model.tris), s = r.align ? r.align.s : null;
  const pre = prepare({ tris: model.tris, pts: new Float32Array(0) }, studs, r.options); const sc = pre.s, sh = pre.shift;
  const src = new Float32Array(model.tris.length);
  for (let k = 0; k < model.tris.length; k += 3) { src[k] = (model.tris[k] - lo[0]) * sc + PAD + sh[0]; src[k + 1] = (model.tris[k + 1] - lo[1]) * sc; src[k + 2] = (model.tris[k + 2] - lo[2]) * sc + PAD + sh[1]; }
  W(`src_${name}.json`, { pos: Array.from(src, (v) => +v.toFixed(2)), col: Array.from(model.vcols, (v) => +v.toFixed(3)) });
  W(`sol_${name}.ldr`, ldrWith(r.pieces, cat, name, (p) => p.rgb));
  W(`kind_${name}.ldr`, ldrWith(r.pieces, cat, name, kindRGB));
  summary[name] = { studs, pieces: r.metrics.pieces, iou: +r.metrics.iou.toFixed(3), recall: +r.metrics.recall.toFixed(3), components: r.metrics.components, kinds: r.metrics.kinds, fromMotif: r.pieces.filter((p) => p.motif).length, sideways: r.pieces.filter((p) => p.snot).length, align: r.align && { scale: +(r.align.s / r.align.s0).toFixed(3), shift: r.align.shift.map((x) => +x.toFixed(1)), score: +r.align.score.toFixed(2), score0: +r.align.score0.toFixed(2) }, ms: Date.now() - t0, tris: model.tris.length / 9 };
  if (name === 'duck') W('field_duck.json', fieldJSON(pre, 0, 0));
  console.log(name, summary[name].pieces, 'pieces', summary[name].iou);
}
W('summary.json', summary);

// ------------------------------------------------------------------------------------------------- B. part templates (the kernel)
const cat = catalogFor({ ...DEFAULTS, partSet: 'extended' });
const tpl = {};
for (const id of ['3039', '3005', '54200', '3040', '3062b', '3665']) {
  const c = cat.find((x) => x.id === id); if (!c) continue;
  const v = partVariants([c], new Set([c.kind])).find((x) => x.rot === 0) || partVariants([c], new Set([c.kind]))[0];
  tpl[id] = { name: c.name, kind: c.kind, w: v.w, d: v.d, h: v.h, V: Array.from(v.V, (x) => +x.toFixed(3)), studs: v.studs };
  W(`part_${id}.ldr`, toLDR([{ id, rot: 0, i: 0, j: 0, b: 0, w: v.w, d: v.d, h: v.h, rgb: [200, 60, 60] }], cat, id));
}
W('templates.json', tpl);

// ------------------------------------------------------------------------------------------ C. the house: grain, frames, lattice
{
  const base = house(), o = { ...DEFAULTS, studs: 12, ref: 'maxh', partSet: 'extended', motifs: false, symmetry: 'off', offsets: [0], decimate: false };
  const flat = (m) => ({ tris: m.tris, pts: new Float32Array(0) });
  const noisy = perturb(base, 2);
  // the lattice score curve for the noisy house: score vs scale factor
  const { lo, hi } = bounds(noisy.tris), s0 = 12 * STUD / Math.max(hi[0] - lo[0], hi[2] - lo[2]);
  const curve = [];
  for (let k = 0; k <= 60; k++) { const f = 0.93 + 0.14 * k / 60; const r = latticeFit(noisy.tris, s0 * f, lo, 0, 0); curve.push([+f.toFixed(4), +r.score0.toFixed(4)]); }
  const fit = latticeFit(noisy.tris, s0, lo, 0.05);
  const cases = {};
  for (const [tag, m, opt] of [['clean', base, { gridAlign: false }], ['noisy_rays', noisy, { gridAlign: false }], ['noisy_align', noisy, { gridAlign: true }], ['noisy_sdf_align', noisy, { gridAlign: true, field: 'sdf', sdfMedian: 1 }]]) {
    const oo = { ...o, ...opt }, pre = prepare(flat(m), 12, oo), c = catalogFor(oo), S = solve(pre, c, 0, 0, oo);
    const phases = {}; for (const p of S.pieces) { const k = p.phase.replace(/-.*/, ''); phases[k] = (phases[k] || 0) + 1; }
    for (const p of S.pieces) p.rgb = kindRGB(p);
    cases[tag] = { pieces: S.pieces.length, phases, field: fieldJSON(pre, 0, 0), scale: pre.s, shift: pre.shift };
    W(`house_${tag}.ldr`, ldrWith(S.pieces, c, tag, (p) => p.rgb));
    // the source mesh in that frame
    const src = new Float32Array(m.tris.length), b2 = bounds(m.tris);
    for (let k = 0; k < m.tris.length; k += 3) { src[k] = (m.tris[k] - b2.lo[0]) * pre.s + PAD + pre.shift[0]; src[k + 1] = (m.tris[k + 1] - b2.lo[1]) * pre.s; src[k + 2] = (m.tris[k + 2] - b2.lo[2]) * pre.s + PAD + pre.shift[1]; }
    W(`house_${tag}_src.json`, { pos: Array.from(src, (v) => +v.toFixed(2)) });
  }
  W('house.json', { curve, fit: { s: fit.s / s0, shift: fit.shift, score: fit.score, score0: fit.score0, aligned: fit.aligned }, cases: Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, { pieces: v.pieces, phases: v.phases, scale: v.scale, shift: v.shift }])) });
  for (const [k, v] of Object.entries(cases)) W(`house_field_${k}.json`, v.field);
  console.log('house done', Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, v.pieces])));
}

// ---------------------------------------------------------------------------------------------------- D. motifs: the top ones
{
  const by = new Map(cat.map((c) => [c.id, c]));
  const SHAPED = new Set(['slope', 'curved', 'cheese', 'inverted', 'wedge', 'shaped']);
  const shaped = (m) => m.parts.some((p) => SHAPED.has((by.get(p.id) || {}).kind));
  const ok = (m) => m.parts.every((p) => by.has(p.id)) && m.parts.length >= 2 && m.models >= 3;
  // the most frequent shaped motifs, one per distinct set of part ids (otherwise the list is twelve lengths of the same cheese row)
  const seen = new Set(), upright = [];
  for (const m of MOTIFS.filter((m) => ok(m) && !m.snot && shaped(m) && m.parts.length >= 3).sort((a, b) => b.n * b.models - a.n * a.models)) {
    const sig = [...new Set(m.parts.map((p) => p.id))].sort().join(','); if (seen.has(sig)) continue; seen.add(sig); upright.push(m); if (upright.length === 12) break;
  }
  const sideways = MOTIFS.filter((m) => ok(m) && m.snot).sort((a, b) => b.n - a.n).slice(0, 8);
  const toPieces = (m) => m.parts.map((p) => { const c = by.get(p.id); const ori = p.ori !== undefined ? p.ori : Math.round((p.rot || 0) / 90); return { id: p.id, rot: p.rot || 0, ori, i: p.i, j: p.j, b: p.b, w: c.w, d: c.d, h: c.h, rgb: ori >= 4 ? [30, 220, 190] : [200, 200, 200] }; });
  const info = [];
  upright.forEach((m, k) => { W(`motif_${k}.ldr`, toLDR(toPieces(m), cat, `motif ${k}`)); info.push({ k, key: m.key, n: m.n, models: m.models, parts: m.parts.map((p) => p.id + (p.ori >= 4 ? '/o' + p.ori : '@' + (p.rot || 0))), w: m.w, d: m.d, h: m.h }); });
  const sinfo = [];
  sideways.forEach((m, k) => { W(`snot_${k}.ldr`, toLDR(toPieces(m), cat, `snot ${k}`)); sinfo.push({ k, key: m.key, n: m.n, models: m.models, parts: m.parts.map((p) => p.id + (p.ori >= 4 ? '/o' + p.ori : '@' + (p.rot || 0))), w: m.w, d: m.d, h: m.h }); });
  // library statistics
  const nParts = {}, counts = []; for (const m of MOTIFS) { nParts[m.parts.length] = (nParts[m.parts.length] || 0) + 1; counts.push(m.n); }
  W('motifs.json', { total: MOTIFS.length, snot: MOTIFS.filter((m) => m.snot).length, byParts: nParts, upright: info, sideways: sinfo, countHist: counts });
  console.log('motifs:', MOTIFS.length, 'top upright', upright.length, 'top sideways', sideways.length);
}

// ----------------------------------------------------------------------------------------------- E. poles: be2 with / without
{
  const model = load('models/be2.glb');
  for (const [tag, cl] of [['old', 0], ['new', 2]]) {
    const r = generate(model, { ...FULL, studs: 48, pillarCluster: cl }), c = catalogFor(r.options);
    W(`poles_${tag}.ldr`, ldrWith(r.pieces, c, tag, (p) => (p.kind === 'round' ? [255, 140, 0] : [215, 215, 215])));
    console.log('poles', tag, r.metrics.pieces, 'round', r.metrics.kinds.round || 0);
  }
}
console.log('exports in', out);
