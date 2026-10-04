// Minimal LDraw reader: MPD / LDR models -> flat list of part placements (world transform, colour),
// plus bounding boxes of library parts (recursive, cached). Node only (reads the library from disk).
// Units: LDU, LDraw frame (Y down). Nothing here knows about the engine grid; see placements.js for that.
import fs from 'node:fs';
import path from 'node:path';
import { readZip } from './zip.js';

const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const mul3 = (A, B) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return o; };
export const apply = (A, t, p) => [A[0] * p[0] + A[1] * p[1] + A[2] * p[2] + t[0], A[3] * p[0] + A[4] * p[1] + A[5] * p[2] + t[1], A[6] * p[0] + A[7] * p[1] + A[8] * p[2] + t[2]];

/** parse one LDraw text: sub-files (type 1), triangles / quads (3 / 4) and the `0 FILE` sections of an MPD */
export function parseLDraw(text) {
  const files = []; let cur = null;
  const open = (name) => { cur = { name: name.toLowerCase(), desc: null, refs: [], verts: [] }; files.push(cur); };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    if (line.startsWith('0 FILE ')) { open(line.slice(7).trim()); continue; }
    if (line.startsWith('0 NOFILE')) { cur = null; continue; }
    if (!cur) open('');
    const c = line[0];
    if (c === '0') { if (cur.desc === null && !cur.refs.length && !cur.verts.length) cur.desc = line.slice(1).trim().replace(/\s+/g, ' '); continue; }
    if (c === '1') {
      const t = line.split(/\s+/); if (t.length < 15) continue;
      const v = t.slice(2, 14).map(Number); const file = t.slice(14).join(' ').toLowerCase().replace(/\\/g, '/');
      if (v.some((x) => Number.isNaN(x))) continue;
      cur.refs.push({ color: +t[1], t: [v[0], v[1], v[2]], M: v.slice(3, 12), file });
    } else if (c === '3' || c === '4') {
      const t = line.split(/\s+/), k = c === '3' ? 3 : 4; if (t.length < 2 + 3 * k) continue;
      for (let i = 0; i < k; i++) cur.verts.push([+t[2 + 3 * i], +t[3 + 3 * i], +t[4 + 3 * i]]);
    }
  }
  return files;
}

/** the LDraw parts library on disk: file lookup, parsed-file cache, recursive bounding boxes */
export class Library {
  /** root: an unpacked library directory (with parts/ and p/) or the official complete.zip */
  constructor(root) {
    this.root = root; this.cache = new Map(); this.bboxes = new Map(); this.zip = null;
    if (/\.zip$/i.test(root)) {
      this.zip = new Map();
      for (const e of readZip(fs.readFileSync(root))) { const m = /^(?:ldraw\/)?(parts|p)\/(.*)$/i.exec(e.name); if (m && e.data) this.zip.set(`${m[1].toLowerCase()}/${m[2].toLowerCase()}`, e.data); }
      this.parts = new Set([...this.zip.keys()].filter((k) => k.startsWith('parts/') && !k.includes('/', 6)).map((k) => k.slice(6)));
    } else {
      this.dirs = ['parts', 'p', 'parts/s', 'p/48', 'p/8'].map((d) => path.join(root, d));
      this.parts = new Set(fs.existsSync(path.join(root, 'parts')) ? fs.readdirSync(path.join(root, 'parts')).map((f) => f.toLowerCase()) : []);
    }
  }
  /** true for a top-level part file (parts/xxx.dat), i.e. something a model places directly */
  isPart(name) { return this.parts.has(name.toLowerCase()); }
  /** text of a library file, or null */
  read(name) {
    const n = name.toLowerCase().replace(/\\/g, '/');
    if (this.zip) { for (const d of ['parts/', 'p/', 'parts/s/', 'p/48/', 'p/8/']) { const e = this.zip.get(d + n); if (e) return e.toString('latin1'); } return null; }
    for (const d of this.dirs) { const p = path.join(d, n); if (fs.existsSync(p)) return fs.readFileSync(p, 'latin1'); }
    return null;
  }
  file(name) {
    const n = name.toLowerCase();
    if (this.cache.has(n)) return this.cache.get(n);
    const t = this.read(n); const f = t !== null ? parseLDraw(t)[0] : null;
    this.cache.set(n, f); return f;
  }
  /** axis-aligned bbox [min, max] of a part in its own frame (conservative: sub-file boxes are transformed corner-wise), null if unknown */
  bbox(name) {
    const n = name.toLowerCase();
    if (this.bboxes.has(n)) return this.bboxes.get(n);
    this.bboxes.set(n, null);                                           // guards against reference cycles
    const f = this.file(n); if (!f) return null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const add = (p) => { for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; } };
    for (const v of f.verts) add(v);
    for (const r of f.refs) {
      const b = this.bbox(r.file); if (!b) continue;
      for (const x of [b[0][0], b[1][0]]) for (const y of [b[0][1], b[1][1]]) for (const z of [b[0][2], b[1][2]]) add(apply(r.M, r.t, [x, y, z]));
    }
    const out = lo[0] === Infinity ? null : [lo, hi];
    this.bboxes.set(n, out); return out;
  }
}

/**
 * Flatten a model (text of an .mpd / .ldr) into part placements in the main model's frame.
 * A reference is a sub-model when its name is one of the MPD's FILE sections, otherwise a library part.
 * Returns { placements: [{ part, color, M, t }], unresolved: Map(name -> count) } with part = file name without .dat
 */
export function flattenModel(text, lib, { main = null, maxDepth = 32 } = {}) {
  const files = parseLDraw(text);
  const byName = new Map(files.map((f) => [f.name, f]));
  const root = main ? byName.get(main.toLowerCase()) : files[0];
  const placements = [], unresolved = new Map();
  const walk = (f, M, t, color, depth) => {
    if (depth > maxDepth) return;
    for (const r of f.refs) {
      const M2 = mul3(M, r.M), t2 = apply(M, t, r.t), col = r.color === 16 ? color : r.color;
      const sub = byName.get(r.file);
      if (sub) { walk(sub, M2, t2, col, depth + 1); continue; }
      let name = r.file.replace(/^.*\//, ''), M3 = M2, t3 = t2;
      if (lib && !lib.isPart(name)) { unresolved.set(name, (unresolved.get(name) || 0) + 1); continue; }
      // "~Moved to xxx" and "=" alias parts hold a single reference to the real part: follow it
      for (let k = 0; k < 4 && lib; k++) {
        const f = lib.file(name);
        if (!f || !f.desc || !(f.desc.startsWith('~Moved to') || f.desc.startsWith('=')) || f.refs.length !== 1) break;
        const a = f.refs[0]; t3 = apply(M3, t3, a.t); M3 = mul3(M3, a.M); name = a.file.replace(/^.*\//, '');
      }
      placements.push({ part: name.replace(/\.dat$/, ''), color: col, M: M3, t: t3 });
    }
  };
  if (root) walk(root, I3, [0, 0, 0], 16, 0);
  return { placements, unresolved, nfiles: files.length };
}
