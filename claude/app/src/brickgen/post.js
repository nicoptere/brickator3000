// Post-processing on the piece list: merges, pillars, bracing / supports (connectivity), studs finish.
import { G } from './constants.js';

// cell keys are packed numbers (string keys made the connectivity passes allocation-bound): i, j in [-1024, 3072), l in [-1, ...)
const KW = 4096, KO = 1024;
const K = (i, j, l) => ((l + 1) * KW + (j + KO)) * KW + (i + KO);
const unK = (k) => { const i = k % KW - KO; k = (k - (k % KW)) / KW; const j = k % KW - KO; return [i, j, (k - (k % KW)) / KW - 1]; };
const K2 = (i, j) => `${i},${j}`;
const byId = (cat) => { const m = {}; for (const c of cat) m[c.id] = c; return m; };
export const close = (a, b, tol = 22) => !!a && !!b && Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) <= tol;
const meanRgb = (cols) => { const c = cols.filter(Boolean); return c.length ? [0, 1, 2].map((t) => Math.round(c.reduce((s, x) => s + x[t], 0) / c.length)) : null; };

export function mk(c, w, d, i, j, b, rgb, phase, kind = null) {
  return { id: c.id, name: c.name, kind: kind || c.kind, rot: w === c.w && d === c.d ? 0 : 90, b, i, j, w, d, h: Math.round(c.h),
    studs: c.kind === 'tile' ? [] : Array.from({ length: w * d }, (_, k) => [k % w, Math.floor(k / w)]), phase, matched: 0, over: 0, rgb };
}
function shapes(cat, kind) { return cat.filter((c) => c.kind === kind && c.source === 'analytic').sort((a, b) => b.w * b.d - a.w * a.d); }
export function occupancy(pieces) {
  const occ = new Map();
  pieces.forEach((p, n) => { for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) for (let l = 0; l < p.h; l++) occ.set(K(p.i + dx, p.j + dz, p.b + l), n); });
  return occ;
}
const studSet = (p) => new Set(p.studs.map(([a, b]) => K2(p.i + a, p.j + b)));

// ------------------------------------------------------------------ merges
export function vertical(S, cat, tol) {
  const bricks = {}; for (const c of cat) if (c.kind === 'brick') bricks[[c.w, c.d].sort((a, b) => a - b).join('x')] = c;
  const byfoot = new Map();
  S.pieces.forEach((p, n) => { if (p.kind === 'plate') { const f = `${p.i},${p.j},${p.w},${p.d}`; if (!byfoot.has(f)) byfoot.set(f, new Map()); byfoot.get(f).set(p.b, n); } });
  let cand = new Map();
  for (const [f, lv] of byfoot) {
    const [fi, fj, fw, fd] = f.split(',').map(Number), key = [fw, fd].sort((a, b) => a - b).join('x');
    if (!bricks[key]) continue;
    const used = new Set();
    for (const b of [...lv.keys()].sort((a, c) => a - c)) {
      if (!(lv.has(b) && lv.has(b + 1) && lv.has(b + 2))) continue;
      const ids = [lv.get(b), lv.get(b + 1), lv.get(b + 2)];
      if (ids.some((x) => used.has(x))) continue;
      const cols = ids.map((x) => S.pieces[x].rgb);
      if (!(close(cols[0], cols[1], tol) && close(cols[1], cols[2], tol))) continue;
      ids.forEach((x) => used.add(x)); cand.set(`${f}|${b}`, { ids, cols, key, fi, fj, fw, fd, b });
    }
  }
  if (S.mirror) {
    const [ax, c2] = S.mirror;
    const mf = (e) => (ax === 'x' ? `${c2 - e.fi - e.fw},${e.fj},${e.fw},${e.fd}|${e.b}` : `${e.fi},${c2 - e.fj - e.fd},${e.fw},${e.fd}|${e.b}`);
    cand = new Map([...cand].filter(([, e]) => cand.has(mf(e))));
  }
  const kill = new Set(), add = [];
  for (const e of cand.values()) { e.ids.forEach((x) => kill.add(x)); add.push(mk(bricks[e.key], e.fw, e.fd, e.fi, e.fj, e.b, meanRgb(e.cols), 'M-vertical')); }
  S.pieces = S.pieces.filter((_, n) => !kill.has(n)).concat(add);
  return add.length;
}

function pack(cells, shp, b, tol) {            // cells: Map "i,j" -> rgb
  const left = new Map(cells), out = [];
  const keys = [...cells.keys()].map((s) => s.split(',').map(Number)).sort((a, c) => a[1] - c[1] || a[0] - c[0]);
  for (const [ci, cj] of keys) {
    if (!left.has(K2(ci, cj))) continue;
    const seed = left.get(K2(ci, cj)); let done = false;
    for (const c of shp) {
      const dims = c.w === c.d ? [[c.w, c.d]] : [[c.w, c.d], [c.d, c.w]];
      for (const [w, d] of dims) {
        const cl = []; for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) cl.push(K2(ci + x, cj + y));
        if (cl.every((q) => left.has(q) && close(left.get(q), seed, tol))) {
          out.push(mk(c, w, d, ci, cj, b, meanRgb(cl.map((q) => left.get(q))), 'M-horizontal')); cl.forEach((q) => left.delete(q)); done = true; break;
        }
      }
      if (done) break;
    }
  }
  return out;
}

export function horizontal(S, cat, kind, tol) {
  const shp = shapes(cat, kind), groups = new Map();
  S.pieces.forEach((p, n) => { if (p.kind === kind && p.h === 1) { if (!groups.has(p.b)) groups.set(p.b, []); groups.get(p.b).push(n); } });
  const sizes = {}; for (const c of shp) { sizes[`${c.w},${c.d}`] = c; sizes[`${c.d},${c.w}`] = c; }
  let gained = 0; const kill = new Set(), add = [];
  for (const [b, ids] of groups) {
    const cell = new Map();
    for (const n of ids) { const p = S.pieces[n]; for (let dx = 0; dx < p.w; dx++) for (let dz = 0; dz < p.d; dz++) cell.set(K2(p.i + dx, p.j + dz), p.rgb); }
    let nw;
    if (!S.mirror) nw = pack(cell, shp, b, tol);
    else {
      const [ax, c2] = S.mirror, A = ax === 'x' ? 0 : 1;
      const rest = new Map(cell); nw = [];
      const keys = [...cell.keys()].map((s) => s.split(',').map(Number)).sort((a, c) => a[1 - A] - c[1 - A] || a[A] - c[A]);
      for (const k of keys) {                      // 1. rectangles centred on the plane tie the two halves together
        if (!rest.has(K2(k[0], k[1])) || 2 * k[A] + 1 >= c2) continue;
        const width = c2 - 2 * k[A]; if (width > 4) continue;
        for (const length of [8, 6, 4, 3, 2, 1]) {
          const wd = A === 0 ? [width, length] : [length, width], c = sizes[`${wd[0]},${wd[1]}`]; if (!c) continue;
          const cl = []; for (let y = 0; y < wd[1]; y++) for (let x = 0; x < wd[0]; x++) cl.push(K2(k[0] + x, k[1] + y));
          const seed = rest.get(K2(k[0], k[1]));
          if (cl.every((q) => rest.has(q) && close(rest.get(q), seed, tol))) {
            nw.push(mk(c, wd[0], wd[1], k[0], k[1], b, meanRgb(cl.map((q) => rest.get(q))), 'M-horizontal')); cl.forEach((q) => rest.delete(q)); break;
          }
        }
      }
      const L = new Map(), Cc = new Map(), R = new Map();
      for (const [s, v] of rest) { const k = s.split(',').map(Number), t = 2 * k[A] + 1; (t < c2 ? L : t === c2 ? Cc : R).set(s, v); }
      const nl = pack(L, shp, b, tol); nw.push(...nl, ...pack(Cc, shp, b, tol));
      const mirrorKey = (s) => { const k = s.split(',').map(Number); return A === 0 ? K2(c2 - 1 - k[0], k[1]) : K2(k[0], c2 - 1 - k[1]); };
      const mL = new Set([...L.keys()].map(mirrorKey));
      if (mL.size === R.size && [...R.keys()].every((s) => mL.has(s))) {
        for (const q of nl) {
          const q2 = { ...q }; if (A === 0) q2.i = c2 - q.i - q.w; else q2.j = c2 - q.j - q.d;
          const cl = []; for (let y = 0; y < q.d; y++) for (let x = 0; x < q.w; x++) cl.push(R.get(K2(q2.i + x, q2.j + y)));
          q2.rgb = meanRgb(cl) || q.rgb; nw.push(q2);
        }
      } else nw.push(...pack(R, shp, b, tol));
    }
    if (nw.length < ids.length) { ids.forEach((n) => kill.add(n)); add.push(...nw); gained += ids.length - nw.length; }
  }
  S.pieces = S.pieces.filter((_, n) => !kill.has(n)).concat(add);
  return gained;
}

// ------------------------------------------------------------------ pillars: isolated 1x1 / 2x2 columns -> round bricks
export function pillars(S, cat, minLevels = 3) {
  const by = byId(cat), occ = occupancy(S.pieces), used = new Set(), add = [], made = { 1: 0, 2: 0 };
  for (const [size, brick, plate] of [[2, '3941', '4032a'], [1, '3062b', '6141']]) {
    const foot = (i, j) => { const o = []; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) o.push([i + x, j + y]); return o; };
    const ring = (i, j) => { const o = []; for (let y = -1; y <= size; y++) for (let x = -1; x <= size; x++) if (!(x >= 0 && x < size && y >= 0 && y < size)) o.push([i + x, j + y]); return o; };
    const cols = new Map();
    S.pieces.forEach((p, n) => {
      if (p.w === size && p.d === size && ['plate', 'brick', 'tile', 'round'].includes(p.kind) && !used.has(n))
        for (let l = 0; l < p.h; l++) { const key = K2(p.i, p.j); if (!cols.has(key)) cols.set(key, new Map()); cols.get(key).set(p.b + l, n); }
    });
    for (const [key, lvm] of cols) {
      const [i, j] = key.split(',').map(Number);
      const lv = [...lvm.entries()].sort((a, b) => a[0] - b[0]);
      const flush = (run) => {
        if (run.length < minLevels) return;
        const ids = new Set(run.map((r) => r[1]));
        for (const n of ids) if (used.has(n)) return;
        for (const n of ids) { const p = S.pieces[n]; if (p.b < run[0][0] || p.b + p.h > run[run.length - 1][0] + 1) return; }
        for (const [l] of run) {
          if (foot(i, j).some(([a, b]) => !ids.has(occ.get(K(a, b, l))))) return;
          if (ring(i, j).some(([a, b]) => occ.has(K(a, b, l)))) return;
        }
        ids.forEach((n) => used.add(n));
        const rgb = S.pieces[run[Math.floor(run.length / 2)][1]].rgb, b0 = run[0][0], L = run.length;
        for (let k = 0; k < Math.floor(L / 3); k++) add.push({ ...mk(by[brick], size, size, i, j, b0 + 3 * k, rgb, 'P-pillar', 'round'), studs: by[brick].stud_cells.map((s) => s.slice()) });
        for (let k = 0; k < L % 3; k++) add.push({ ...mk(by[plate], size, size, i, j, b0 + 3 * Math.floor(L / 3) + k, rgb, 'P-pillar', 'round'), studs: by[plate].stud_cells.map((s) => s.slice()) });
        made[size]++;
      };
      let run = [];
      for (const [l, n] of lv) { if (run.length && l !== run[run.length - 1][0] + 1) { flush(run); run = []; } run.push([l, n]); }
      flush(run);
    }
  }
  S.pieces = S.pieces.filter((_, n) => !used.has(n)).concat(add);
  return made;
}

// ------------------------------------------------------------------ connectivity (stud contact only)
class UF {
  constructor(n) { this.p = Array.from({ length: n }, (_, k) => k); }
  find(a) { while (this.p[a] !== a) { this.p[a] = this.p[this.p[a]]; a = this.p[a]; } return a; }
  union(a, b) { a = this.find(a); b = this.find(b); if (a !== b) this.p[b] = a; return a !== b; }
  grow(n) { while (this.p.length < n) this.p.push(this.p.length); }
}
// absolute stud cells of a piece as packed numbers, cached per object (pieces are never moved in place; copies are new objects)
const STUDK = new WeakMap();
const studKeys = (p) => { let x = STUDK.get(p); if (!x) { x = new Set(); for (const [a, b] of p.studs) x.add((p.i + a) * KW + p.j + b); STUDK.set(p, x); } return x; };
const hasStud = (q, i, j) => studKeys(q).has(i * KW + j);
function link(P, occ, uf, n) {
  const p = P[n], top = p.b + p.h;
  for (const [a, b] of p.studs) { const m = occ.get(K(p.i + a, p.j + b, top)); if (m !== undefined && m !== n && P[m].b === top) uf.union(n, m); }
  if (p.b > 0) for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) {
    const m = occ.get(K(p.i + dx, p.j + dz, p.b - 1));
    if (m === undefined || m === n) continue;
    const q = P[m];
    if (q.b + q.h === p.b && hasStud(q, p.i + dx, p.j + dz)) uf.union(n, m);
  }
}
/** every stud-contact pair (a, b) of the piece list, as a flat Int32Array */
function linkPairs(P, occ) {
  const out = [];
  P.forEach((p, n) => {
    const top = p.b + p.h;
    for (const [a, b] of p.studs) { const m = occ.get(K(p.i + a, p.j + b, top)); if (m !== undefined && m !== n && P[m].b === top) out.push(n, m); }
    if (p.b > 0) for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) {
      const m = occ.get(K(p.i + dx, p.j + dz, p.b - 1));
      if (m === undefined || m === n) continue;
      const q = P[m];
      if (q.b + q.h === p.b && hasStud(q, p.i + dx, p.j + dz)) out.push(n, m);
    }
  });
  return Int32Array.from(out);
}
/** component count of P with the pieces `ids` replaced by `add`, from the pair list of P (old-old contacts do not change; only the new pieces are linked) */
function countCompsAfter(P, occ, pairs, ids, add) {
  const N = P.length, M = add.length, par = new Int32Array(N + M); for (let k = 0; k < N + M; k++) par[k] = k;
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  let comps = N - ids.size + M;
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) { par[b] = a; comps--; } };
  for (let k = 0; k < pairs.length; k += 2) { const a = pairs[k], b = pairs[k + 1]; if (!ids.has(a) && !ids.has(b)) union(a, b); }
  const over = new Map();                                            // cells of the new pieces (override the old occupancy; removed cells fall through to "free")
  add.forEach((q, t) => { for (let dz = 0; dz < q.d; dz++) for (let dx = 0; dx < q.w; dx++) for (let l = 0; l < q.h; l++) over.set(K(q.i + dx, q.j + dz, q.b + l), N + t); });
  const at = (key) => { const o = over.get(key); if (o !== undefined) return o; const m = occ.get(key); return m === undefined || ids.has(m) ? undefined : m; };
  const pieceOf = (m) => (m < N ? P[m] : add[m - N]);
  add.forEach((p, t) => {
    const n = N + t, top = p.b + p.h;
    for (const [a, b] of p.studs) { const m = at(K(p.i + a, p.j + b, top)); if (m !== undefined && m !== n && pieceOf(m).b === top) union(n, m); }
    if (p.b > 0) for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) {
      const m = at(K(p.i + dx, p.j + dz, p.b - 1));
      if (m === undefined || m === n) continue;
      const q = pieceOf(m);
      if (q.b + q.h === p.b && hasStud(q, p.i + dx, p.j + dz)) union(n, m);
    }
  });
  const groundRoot = new Set();
  for (let k = 0; k < N; k++) if (!ids.has(k) && P[k].b === 0) groundRoot.add(find(k));
  add.forEach((q, t) => { if (q.b === 0) groundRoot.add(find(N + t)); });
  let grounded = 0;
  for (let k = 0; k < N; k++) if (!ids.has(k) && groundRoot.has(find(k))) grounded++;
  add.forEach((q, t) => { if (groundRoot.has(find(N + t))) grounded++; });
  return { comps, grounded, pieces: N - ids.size + M };
}
export function components(P, occ) { const uf = new UF(P.length); for (let n = 0; n < P.length; n++) link(P, occ, uf, n); return uf; }
export function connectivity(S) {
  const occ = occupancy(S.pieces), uf = components(S.pieces, occ), roots = new Set(), cnt = new Map();
  S.pieces.forEach((p, n) => { const r = uf.find(n); if (p.b === 0) roots.add(r); cnt.set(r, (cnt.get(r) || 0) + 1); });
  let g = 0; S.pieces.forEach((_, n) => { if (roots.has(uf.find(n))) g++; });
  const N = Math.max(S.pieces.length, 1);
  return { grounded: g / N, components: cnt.size, largest: cnt.size ? Math.max(...cnt.values()) / N : 0 };
}

const plateOf = (by, len) => by[{ 1: '3024', 2: '3023', 3: '3623', 4: '3710' }[len]];
const acceptsStuds = (p) => p.kind !== 'inverted';
const BR_DX = [1, -1, 0, 0], BR_DZ = [0, 0, 1, -1], BR_DL = [0, 1, -1, 2, -2, 3, -3];

/** join neighbouring components with a 1xN plate under (or over) the seam; pad the shorter side with 1x1 plates (= thicken the limb) */
export function bracing(S, cat, o) {
  const by = byId(cat), one = by['3024']; let added = 0;
  const P = S.pieces, occ = occupancy(P), uf = components(P, occ);     // kept up to date below as pieces are added, so built once
  // typed-array mirror of occ for the hot lookups (the Map keeps the iteration order that fixes candidate ties)
  const NX = S.NXc, NZ = S.NZc, NL = S.NL, grid = new Int32Array(NX * NZ * NL).fill(-1);
  const gset = (i, j, l, n) => { if (i >= 0 && i < NX && j >= 0 && j < NZ && l >= 0 && l < NL) grid[(l * NZ + j) * NX + i] = n; };
  const gi = (i, j, l) => (i < 0 || i >= NX || j < 0 || j >= NZ || l < 0 || l >= NL ? -1 : grid[(l * NZ + j) * NX + i]);
  P.forEach((p, n) => { for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) for (let l = 0; l < p.h; l++) gset(p.i + dx, p.j + dz, p.b + l, n); });
  for (let round = 0; round < o.braceRounds; round++) {
    const ssCache = new Map(), studSetC = (n) => { let x = ssCache.get(n); if (!x) { const p = P[n]; x = new Set(p.studs.map(([a, b]) => (p.i + a) * KW + p.j + b)); ssCache.set(n, x); } return x; };
    const NP = P.length, plane = S.NXc * S.NZc;      // seen: Map pair(n, m) -> Set of packed (c1, c2) cells
    const vol = new Map(); P.forEach((p, n) => { const r = uf.find(n); vol.set(r, (vol.get(r) || 0) + p.w * p.d * p.h); });
    if (vol.size <= 1) break;
    let main = null, mv = -1; for (const [r, v] of vol) if (v > mv) { mv = v; main = r; }
    const cands = [], seen = new Map();
    for (const [key, n] of occ) {
      const [i, j, l] = unK(key), pn = P[n], rn = uf.find(n);
      for (let dir = 0; dir < 4; dir++) {
        const dx = BR_DX[dir], dz = BR_DZ[dir];
        for (let k = 1; k < o.braceMaxSpan; k++) {
          const c2x = i + k * dx, c2z = j + k * dz;
          if (c2x < 0 || c2z < 0 || c2x >= S.NXc || c2z >= S.NZc) break;
          let hit = false;
          for (let t = 0; t < BR_DL.length; t++) {
            const dl = BR_DL[t], m = gi(c2x, c2z, l + dl);
            if (m < 0) continue;
            hit = true;
            if (m === n || uf.find(m) === rn) continue;
            const c1 = [i, j], c2 = [c2x, c2z];
            const pk = n * NP + m, ck = (j * S.NXc + i) * plane + c2z * S.NXc + c2x; let sn = seen.get(pk); if (!sn) { sn = new Set(); seen.set(pk, sn); } if (sn.has(ck)) continue; sn.add(ck);
            const mid = []; for (let t2 = 1; t2 < k; t2++) mid.push([i + t2 * dx, j + t2 * dz]);
            const pm = P[m], jm = main === rn || main === uf.find(m) ? 0 : 1;
            if (acceptsStuds(pn) && acceptsStuds(pm)) {
              const L = Math.min(pn.b, pm.b) - 1, ga = pn.b - 1 - L, gb = pm.b - 1 - L;
              let ok = L >= 0 && Math.max(ga, gb) <= o.braceMaxGap && mid.every(([a, b]) => gi(a, b, L) < 0);
              for (let q = L; ok && q < pn.b; q++) if (gi(c1[0], c1[1], q) >= 0) ok = false;
              for (let q = L; ok && q < pm.b; q++) if (gi(c2[0], c2[1], q) >= 0) ok = false;
              if (ok) cands.push([jm, k + ga + gb, 0, n, m, c1, c2, L]);
            }
            const ta = pn.b + pn.h, tb = pm.b + pm.h, U = Math.max(ta, tb);
            const s1 = studSetC(n), s2 = studSetC(m);
            let ok = U < S.NL && s1.has(i * KW + j) && s2.has(c2x * KW + c2z) && U - Math.min(ta, tb) <= o.braceMaxGap && mid.every(([a, b]) => gi(a, b, U) < 0);
            for (let q = ta; ok && q <= U; q++) if (gi(c1[0], c1[1], q) >= 0) ok = false;
            for (let q = tb; ok && q <= U; q++) if (gi(c2[0], c2[1], q) >= 0) ok = false;
            if (ok) cands.push([jm, k + (U - ta) + (U - tb), 1, n, m, c1, c2, U]);
          }
          if (hit) break;
        }
      }
    }
    if (!cands.length) break;
    cands.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    let done = 0;
    for (const [, , over, n, m, c1, c2, lv] of cands) {
      if (uf.find(n) === uf.find(m)) continue;
      const pn = P[n], pm = P[m];
      const range = (a, b) => { const r = []; for (let q = a; q < b; q++) r.push(q); return r; };
      const cols = over ? [[c1, range(pn.b + pn.h, lv)], [c2, range(pm.b + pm.h, lv)]] : [[c1, range(lv + 1, pn.b)], [c2, range(lv + 1, pm.b)]];
      const kk = Math.abs(c2[0] - c1[0]) + Math.abs(c2[1] - c1[1]);
      const i0 = Math.min(c1[0], c2[0]), j0 = Math.min(c1[1], c2[1]), alongX = c1[1] === c2[1];
      const span = []; for (let t = 0; t <= kk; t++) span.push([i0 + (alongX ? t : 0), j0 + (alongX ? 0 : t)]);
      const need = cols.flatMap(([c, r]) => r.map((q) => K(c[0], c[1], q))).concat(span.map(([a, b]) => K(a, b, lv)));
      if (need.some((t) => occ.has(t))) continue;
      const rgb = pn.rgb; let nw = [];
      for (const [c, r] of cols) for (const q of r) nw.push(mk(one, 1, 1, c[0], c[1], q, rgb, 'B-thicken'));
      const [w, d] = alongX ? [kk + 1, 1] : [1, kk + 1];
      nw.push(mk(plateOf(by, kk + 1), w, d, i0, j0, lv, rgb, 'B-brace'));
      if (S.mirror) {                               // keep symmetric models symmetric
        const [ax, pc] = S.mirror, mm = [];
        for (const q of nw) { const q2 = { ...q }; if (ax === 'x') q2.i = pc - q.i - q.w; else q2.j = pc - q.j - q.d; if ((q2.i !== q.i || q2.j !== q.j) && q2.i >= 0 && q2.j >= 0 && q2.i + q2.w <= S.NXc && q2.j + q2.d <= S.NZc) mm.push(q2); }
        const cellsOf = (arr) => arr.flatMap((q) => { const o2 = []; for (let a = 0; a < q.w; a++) for (let c = 0; c < q.d; c++) o2.push(K(q.i + a, q.j + c, q.b)); return o2; });
        const cm = cellsOf(mm), cn = new Set(cellsOf(nw));
        if (!cm.some((t) => cn.has(t) || occ.has(t))) nw = nw.concat(mm);
      }
      for (const q of nw) {
        P.push(q); const idx = P.length - 1; uf.grow(P.length);
        for (let dz = 0; dz < q.d; dz++) for (let dx = 0; dx < q.w; dx++) { occ.set(K(q.i + dx, q.j + dz, q.b), idx); gset(q.i + dx, q.j + dz, q.b, idx); }
        addVolume(S, q);
      }
      for (let k = P.length - nw.length; k < P.length; k++) link(P, occ, uf, k);
      added += nw.length; done++;
    }
    if (!done) break;
  }
  return added;
}
function addVolume(S, q) {
  if (q.b >= S.NL) return;
  for (let z = q.j * G; z < (q.j + q.d) * G && z < S.NZs; z++) for (let x = q.i * G; x < (q.i + q.w) * G && x < S.NXs; x++) S.C[(q.b * S.NZs + z) * S.NXs + x] += 1;
}

/** round-brick columns under the centre(s) of mass of components that do not reach the ground */
export function supports(S, cat, o, rgb = [70, 74, 82]) {
  const by = byId(cat); let made = 0; const tried = new Set(), columns = [];
  for (let it = 0; it < 50; it++) {
    const P = S.pieces, occ = occupancy(P), uf = components(P, occ), groups = new Map();
    P.forEach((_, n) => { const r = uf.find(n); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(n); });
    const mass = (g) => g.reduce((s, n) => s + P[n].w * P[n].d * P[n].h, 0);
    const total = [...groups.values()].reduce((s, g) => s + mass(g), 0);
    const floating = [...groups.values()].filter((g) => !g.some((n) => P[n].b === 0) && mass(g) >= o.supportMinFrac * total && !tried.has(Math.min(...g)));
    if (!floating.length) break;
    const g = floating.reduce((a, b) => (mass(b) > mass(a) ? b : a)), gset = new Set(g);
    // mass samples -> one centre per `spacing` studs along the principal axis
    const pts = [], wts = [];
    for (const n of g) { const p = P[n]; for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) { pts.push([p.i + dx + 0.5, p.j + dz + 0.5]); wts.push(p.h); } }
    const W = wts.reduce((a, b) => a + b, 0);
    const c0 = [0, 1].map((t) => pts.reduce((s, q, k) => s + q[t] * wts[k], 0) / W);
    let axv = [1, 0];
    if (pts.length > 2) {
      let sxx = 0, sxz = 0, szz = 0;
      pts.forEach((q, k) => { const a = q[0] - c0[0], b = q[1] - c0[1]; sxx += wts[k] * a * a; sxz += wts[k] * a * b; szz += wts[k] * b * b; });
      const th = 0.5 * Math.atan2(2 * sxz, sxx - szz); axv = [Math.cos(th), Math.sin(th)];
    }
    const proj = pts.map((q) => (q[0] - c0[0]) * axv[0] + (q[1] - c0[1]) * axv[1]);
    const span = Math.max(...proj) - Math.min(...proj), kc = Math.max(1, Math.ceil(span / o.supportSpacing));
    const order = proj.map((v, k) => k).sort((a, b) => proj[a] - proj[b]);
    const centres = []; let acc = 0, bucket = [], q = 0;
    for (const k of order) {
      acc += wts[k] / W; bucket.push(k);
      if (acc >= (q + 1) / kc - 1e-9 || k === order[order.length - 1]) {
        const ww = bucket.reduce((s, x) => s + wts[x], 0);
        centres.push([0, 1].map((t) => bucket.reduce((s, x) => s + pts[x][t] * wts[x], 0) / ww)); bucket = []; q++;
      }
    }
    const under = new Map();
    for (const n of g) { const p = P[n]; if (!acceptsStuds(p)) continue; for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) { const key = K2(p.i + dx, p.j + dz); if (!under.has(key) || p.b < under.get(key)) under.set(key, p.b); } }
    const underCells = [...under.keys()].map((s) => s.split(',').map(Number));
    let placedAny = false;
    for (const [cx, cz] of centres) {
      let doneC = false;
      for (const [size, off] of [[2, 1.0], [1, 0.5]]) {
        const sorted = underCells.slice().sort((a, b) => ((a[0] + off - cx) ** 2 + (a[1] + off - cz) ** 2) - ((b[0] + off - cx) ** 2 + (b[1] + off - cz) ** 2)).slice(0, 400);
        for (const [ci, cj] of sorted) {
          const col = column(P, occ, under, ci, cj, size, gset, o.groundSupports);
          if (!col) continue;
          const [sz, base, top] = col, [brick, plate] = sz === 2 ? ['3941', '4032a'] : ['3062b', '6141'];
          let lv = base; const L = top - base;
          for (let t = 0; t < Math.floor(L / 3); t++) { P.push({ ...mk(by[brick], sz, sz, ci, cj, lv, rgb.slice(), 'S-support', 'support'), studs: by[brick].stud_cells.map((s) => s.slice()) }); lv += 3; }
          for (let t = 0; t < L % 3; t++) { P.push({ ...mk(by[plate], sz, sz, ci, cj, lv, rgb.slice(), 'S-support', 'support'), studs: by[plate].stud_cells.map((s) => s.slice()) }); lv += 1; }
          for (let a = 0; a < sz; a++) for (let b = 0; b < sz; b++) for (let l = base; l < top; l++) occ.set(K(ci + a, cj + b, l), P.length - 1);
          made++; placedAny = true; doneC = true; columns.push({ i: ci, j: cj, size: sz, base, top });
          break;
        }
        if (doneC) break;
      }
    }
    if (!placedAny) tried.add(Math.min(...g));
  }
  return { columns: made, detail: columns };
}
function column(P, occ, under, ci, cj, size, gset, ground) {
  const cells = []; for (let a = 0; a < size; a++) for (let b = 0; b < size; b++) cells.push([ci + a, cj + b]);
  const tops = cells.map(([a, b]) => under.get(K2(a, b)));
  const def = tops.filter((t) => t !== undefined); if (!def.length) return null;
  const top = Math.min(...def); if (top <= 0) return null;
  for (let k = 0; k < cells.length; k++) if (tops[k] !== top && occ.has(K(cells[k][0], cells[k][1], top))) return null;
  let base = null;
  for (let l = top - 1; l >= 0; l--) {
    const hit = cells.map(([a, b]) => occ.get(K(a, b, l)));
    if (hit.every((h) => h === undefined)) continue;
    for (let k = 0; k < cells.length; k++) {           // strut: lands on studded tops of ANOTHER component
      const h = hit[k]; if (h === undefined || gset.has(h)) return null;
      const q = P[h]; if (q.b + q.h !== l + 1 || !studSet(q).has(K2(...cells[k]))) return null;
    }
    base = l + 1; break;
  }
  if (base === null) { if (!ground) return null; base = 0; }
  return top - base >= 1 ? [size, base, top] : null;
}

// ------------------------------------------------------------------ studs finish
export function finish(S, cat, bricksMode = 'add') {
  const tiles = {}; for (const c of cat) if (c.kind === 'tile' && c.source === 'analytic') { tiles[`${c.w},${c.d}`] = c; tiles[`${c.d},${c.w}`] = c; }
  const one = tiles['1,1'], occ = occupancy(S.pieces), air = exteriorAir(S);
  const exposed = (p) => { for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) if (occ.has(K(p.i + dx, p.j + dz, p.b + p.h)) || !air(p.i + dx, p.j + dz, p.b + p.h)) return false; return true; };
  let swapped = 0, split = 0, added = 0; const nw = [], kill = new Set();
  S.pieces.forEach((p, n) => {
    if (!p.studs.length || !['plate', 'brick'].includes(p.kind) || !exposed(p)) return;
    const c = tiles[`${p.w},${p.d}`];
    if (p.kind === 'plate') {
      kill.add(n);
      if (c) { nw.push(mk(c, p.w, p.d, p.i, p.j, p.b, p.rgb, 'F-finish')); swapped++; }
      else { for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) nw.push(mk(one, 1, 1, p.i + dx, p.j + dz, p.b, p.rgb, 'F-finish')); split++; }
    } else if (bricksMode === 'add' && p.b + p.h < S.NL) {
      const b2 = p.b + p.h;
      if (c) nw.push(mk(c, p.w, p.d, p.i, p.j, b2, p.rgb, 'F-finish'));
      else for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) nw.push(mk(one, 1, 1, p.i + dx, p.j + dz, b2, p.rgb, 'F-finish'));
      addVolume(S, { b: b2, i: p.i, j: p.j, w: p.w, d: p.d });
      added++;
    }
  });
  S.pieces = S.pieces.filter((_, n) => !kill.has(n)).concat(nw);
  return { platesToTiles: swapped, platesSplit: split, bricksCapped: added };
}

// ------------------------------------------------------------------ splice: stitch side-by-side components without changing the volume
const SPLITTABLE = new Set(['plate', 'brick', 'tile']);
const countComps = (P) => { const uf = components(P, occupancy(P)), r = new Set(); for (let n = 0; n < P.length; n++) r.add(uf.find(n)); return r.size; };

/** a 1x2 plate on level L over cells c1 / c2 (on the seam between two components): whatever occupies those two cells on level L
 * is re-cut into plates around it (a brick is 3 plates). Returns the new piece list or null. */
function spliceAt(S, cat, P, occ, c1, c2, L) {
  if (L < 0 || L >= S.NL) return null;
  const shp = shapes(cat, 'plate'), by = byId(cat);
  const ids = new Set(); for (const c of [c1, c2]) { const m = occ.get(K(c[0], c[1], L)); if (m !== undefined) ids.add(m); }
  const skip = new Set([K2(...c1), K2(...c2)]), out = [];
  for (const n of ids) {
    const pc = P[n]; if (!SPLITTABLE.has(pc.kind)) return null;
    for (let l = pc.b; l < pc.b + pc.h; l++) {
      const cells = new Map();
      for (let dz = 0; dz < pc.d; dz++) for (let dx = 0; dx < pc.w; dx++) { const k = K2(pc.i + dx, pc.j + dz); if (!(l === L && skip.has(k))) cells.set(k, pc.rgb); }
      if (cells.size) out.push(...pack(cells, shp, l, 1e9).map((x) => ({ ...x, phase: 'X-splice' })));
    }
  }
  const alongX = c1[1] === c2[1], i0 = Math.min(c1[0], c2[0]), j0 = Math.min(c1[1], c2[1]);
  out.push(mk(by['3023'], alongX ? 2 : 1, alongX ? 1 : 2, i0, j0, L, [...ids].map((n) => P[n].rgb).find(Boolean) || [128, 128, 128], 'X-splice'));
  const res = P.filter((_, k) => !ids.has(k)).concat(out); res.ids = ids; res.add = out; return res;
}

export function splice(S, cat, o) {
  let done = 0; const t0 = Date.now(), budget = o.spliceTime ?? 6000;
  for (let round = 0; round < (o.spliceRounds ?? 200); round++) {
    const P = S.pieces, occ = occupancy(P), uf = components(P, occ), pairs = linkPairs(P, occ);
    let nc = 0; { const r = new Set(); for (let n = 0; n < P.length; n++) r.add(uf.find(n)); nc = r.size; }
    if (nc <= 1 || Date.now() - t0 > budget) break;
    const size = new Map(); P.forEach((p, n) => { const r = uf.find(n); size.set(r, (size.get(r) || 0) + p.w * p.d * p.h); });
    const cands = [];
    for (const [key, n] of occ) {
      const [i, j, l] = unK(key);
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const m = occ.get(K(i + dx, j + dz, l));
        if (m === undefined || m === n || uf.find(m) === uf.find(n)) continue;
        cands.push([Math.min(size.get(uf.find(n)), size.get(uf.find(m))), [i, j], [i + dx, j + dz], l, uf.find(n), uf.find(m)]);
      }
    }
    if (!cands.length) break;
    cands.sort((a, b) => a[0] - b[0]);
    let improved = false, tries = 0; const dead = new Map();
    for (const [, c1, c2, l, ra, rb] of cands) {
      const pk = ra < rb ? `${ra}|${rb}` : `${rb}|${ra}`, nTried = dead.get(pk) || 0;
      if (nTried >= 12) continue;
      if (++tries > (o.spliceTries ?? 150) || Date.now() - t0 > budget) break;
      let P2 = null;
      for (const L of [l, l + 1, l - 1, l + 2, l - 2]) {
        const cand = spliceAt(S, cat, P, occ, c1, c2, L);
        if (cand && countCompsAfter(P, occ, pairs, cand.ids, cand.add).comps < nc) { P2 = cand; break; }
      }
      if (!P2) { dead.set(pk, nTried + 1); continue; }
      if (S.mirror) {                                  // twin on the other side of the plane
        const [ax, pc] = S.mirror, mir = (c) => (ax === 'x' ? [pc - 1 - c[0], c[1]] : [c[0], pc - 1 - c[1]]);
        const a2 = mir(c1), b2 = mir(c2);
        if (a2[0] !== c1[0] || a2[1] !== c1[1]) {
          const occ2 = occupancy(P2), lv = [l, l + 1, l - 1, l + 2, l - 2];
          const base = countComps(P2);
          for (const L of lv) { const c3 = spliceAt(S, cat, P2, occ2, a2, b2, L); if (c3 && countComps(c3) <= base) { P2 = c3; break; } }
        }
      }
      S.pieces = P2; done++; improved = true; break;
    }
    if (!improved) break;
  }
  return done;
}

// ------------------------------------------------------------------ bridge: shortest chain of plates through free cells between two components
/** Dijkstra from the smallest floating component through chains of 1xk plates (k <= 4): a plate that shares a cell with the previous one on the
 * level above / below is stud-connected to it, so the chain can walk sideways (zig-zag) as well as up and down. Stops at the first stud
 * contact with another component. Added pieces: phase 'T-bridge'. */
export function bridge(S, cat, o) {
  const by = byId(cat), NX = S.NXc, NZ = S.NZc, NL = S.NL, plane = NX * NZ, N = plane * NL, maxCost = o.bridgeMax ?? 10;
  const idx = (x, z, l) => (l * NZ + z) * NX + x;
  let added = 0; const hopeless = new Set(), flattened = new Set();
  let state = null;                                   // grid / components of the current piece list; rebuilt only after the pieces change
  for (let round = 0; round < (o.bridgeRounds ?? 120); round++) {
    if (!state) {
    const P = S.pieces, grid = new Int32Array(N).fill(-1);
    P.forEach((p, n) => { for (let l = p.b; l < p.b + p.h; l++) for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) { const x = p.i + dx, z = p.j + dz; if (x >= 0 && x < NX && z >= 0 && z < NZ && l >= 0 && l < NL) grid[idx(x, z, l)] = n; } });
    const uf = components(P, occupancy(P)), cnt = new Map(), members = new Map(); P.forEach((_, n) => { const r = uf.find(n); cnt.set(r, (cnt.get(r) || 0) + 1); let mm = members.get(r); if (!mm) members.set(r, mm = []); mm.push(n); });
    // per-cell component reachable by a plate placed on (x,z,l): via the stud of the piece below (tb) or the underside of the piece above (ta)
    const root = new Int32Array(P.length); P.forEach((_, n) => { root[n] = uf.find(n); });
    const tb = new Int32Array(N).fill(-1), ta = new Int32Array(N).fill(-1);
    P.forEach((p, n) => {
      const lt = p.b + p.h;
      if (lt < NL) for (const [a, c] of p.studs) { const x = p.i + a, z = p.j + c; if (x >= 0 && x < NX && z >= 0 && z < NZ && grid[idx(x, z, lt - 1)] === n) tb[idx(x, z, lt)] = root[n]; }
      if (p.b > 0 && acceptsStuds(p)) for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) { const x = p.i + dx, z = p.j + dz; if (x >= 0 && x < NX && z >= 0 && z < NZ && grid[idx(x, z, p.b)] === n) ta[idx(x, z, p.b - 1)] = root[n]; }
    });
    state = { P, grid, uf, cnt, members, tb, ta };
    }
    const { P, grid, uf, cnt, members, tb, ta } = state;
    if (cnt.size <= 1) break;
    const order = [...cnt].filter(([r]) => !hopeless.has(r)).sort((a, b) => a[1] - b[1]);
    if (!order.length) break;
    const [A] = order[0];
    const touch = (x, z, l, out) => { out.length = 0; const v = idx(x, z, l); if (tb[v] >= 0) out.push(tb[v]); if (ta[v] >= 0) out.push(ta[v]); return out; };
    const free = (x, z, l) => x >= 0 && x < NX && z >= 0 && z < NZ && l >= 0 && l < NL && grid[idx(x, z, l)] < 0;
    // plates are packed as ints: ((cell(x,z,l2) * 4 + dir) * 4 + (len - 1)); no per-step allocation (this BFS used to dominate the whole run)
    const DX = [1, -1, 0, 0], DZ = [0, 0, 1, -1];
    const unpack = (code) => { const len = (code & 3) + 1, dir = (code >> 2) & 3, cell = code >> 4, l = (cell / plane) | 0, r = cell - l * plane, z = (r / NX) | 0, x = r - z * NX;
      const cells = []; for (let k = 0; k < len; k++) cells.push([x + k * DX[dir], z + k * DZ[dir]]); return { l, cells }; };
    let dist, parent, via, goal = -1;
    // the reverse search (grow from the rest towards A) finds the same chains mirrored and never succeeded where the forward one failed, so it is off by default
    for (const rev of o.bridgeReverse ? [false, true] : [false]) {
      dist = new Int16Array(N).fill(32000); parent = new Int32Array(N).fill(-1); via = new Int32Array(N).fill(-1);
      const buckets = Array.from({ length: maxCost + 2 }, () => []), tmp = [];
      const expand = (x, z, l, l2, base, from) => {
        if (l2 < 0 || l2 >= NL) return;
        const nb = base + 1; if (nb > maxCost) return;
        const bk = buckets[nb], head = idx(x, z, l2) * 16;
        for (let dir = 0; dir < 4; dir++) {
          const dx = DX[dir], dz = DZ[dir];
          for (let k = 0; k < 4; k++) {
            const cx = x + k * dx, cz = z + k * dz;
            if (cx < 0 || cx >= NX || cz < 0 || cz >= NZ) break;
            const v = idx(cx, cz, l2);
            if (grid[v] >= 0) break;
            if (nb < dist[v]) { dist[v] = nb; parent[v] = from; via[v] = head + dir * 4 + k; bk.push(v); }
          }
        }
      };
      if (rev) {
        for (let l = 0; l < NL; l++) for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
          if (grid[idx(x, z, l)] >= 0) continue;
          if (touch(x, z, l, tmp).some((rr) => rr !== A)) expand(x, z, l, l, 0, -1);
        }
      } else {
        // seeds = free cells touching A: taken from A's own pieces, in the same (l, z, x) order as a full scan would visit them
        const seeds = [];
        for (const n of members.get(A)) {
          const p = P[n], lt = p.b + p.h;
          if (lt < NL) for (const [a, c] of p.studs) { const x = p.i + a, z = p.j + c; if (x >= 0 && x < NX && z >= 0 && z < NZ) { const v = idx(x, z, lt); if (grid[v] < 0 && tb[v] === A) seeds.push(v); } }
          if (p.b > 0) for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) { const x = p.i + dx, z = p.j + dz; if (x >= 0 && x < NX && z >= 0 && z < NZ) { const v = idx(x, z, p.b - 1); if (grid[v] < 0 && ta[v] === A) seeds.push(v); } }
        }
        seeds.sort((a, b) => a - b);
        let last = -1;
        for (const v of seeds) { if (v === last) continue; last = v; const l = (v / plane) | 0, r = v - l * plane, z = (r / NX) | 0, x = r - z * NX; expand(x, z, l, l, 0, -1); }
      }
      for (let c = 1; c <= maxCost && goal < 0; c++) {
        const bk = buckets[c];
        for (let q = 0; q < bk.length && goal < 0; q++) {
          const v = bk[q]; if (dist[v] !== c) continue;
          const l = (v / plane) | 0, r = v - l * plane, z = (r / NX) | 0, x = r - z * NX;
          const t = touch(x, z, l, tmp);
          if (rev ? t.includes(A) : t.some((rr) => rr !== A)) { goal = v; break; }
          if (c < maxCost) { expand(x, z, l, l + 1, c, v); expand(x, z, l, l - 1, c, v); }
        }
      }
      if (goal >= 0) break;
    }
    if (goal < 0) {
      // last resort: the component has no stud to build on (a lone slope on the ground): flatten its smooth pieces into a brick / plates of the same footprint
      const SMOOTH = new Set(['slope', 'curved', 'cheese', 'inverted', 'tile']); const idsA = []; P.forEach((p, n) => { if (uf.find(n) === A && SMOOTH.has(p.kind)) idsA.push(n); });
      if (idsA.length && !flattened.has(A)) {
        flattened.add(A); const bricks = shapes(cat, 'brick'), plates = shapes(cat, 'plate'), kill = new Set(idsA), add = [];
        for (const n of idsA) {
          const p = P[n], cells = new Map(); for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) cells.set(K2(p.i + dx, p.j + dz), p.rgb);
          let l = p.b; const top = p.b + Math.max(1, Math.round(p.h));
          while (l < top) { const brick = top - l >= 3 ? bricks.find((c) => (c.w === p.w && c.d === p.d) || (c.w === p.d && c.d === p.w)) : null;
            if (brick) { add.push(mk(brick, brick.w === p.w ? p.w : p.d, brick.w === p.w ? p.d : p.w, p.i, p.j, l, p.rgb, 'T-flatten')); l += 3; }
            else { add.push(...pack(cells, plates, l, 1e9).map((x) => ({ ...x, phase: 'T-flatten' }))); l += 1; } }
        }
        S.pieces = P.filter((_, n) => !kill.has(n)).concat(add); added += add.length - idsA.length; state = null; continue;
      }
      hopeless.add(A); continue;
    }
    // chain of plates back to the seed; validate (no two plates on the same cell)
    const chain = []; const used = new Set(), seenPl = new Set(); let v = goal, ok = true;
    while (v >= 0) {
      const code = via[v];
      if (!seenPl.has(code)) { seenPl.add(code); const pl = unpack(code);
        for (const [x, z] of pl.cells) { const k = K(x, z, pl.l); if (used.has(k)) ok = false; used.add(k); }
        chain.push(pl);
      }
      v = parent[v];
    }
    if (!ok) { hopeless.add(A); continue; }
    const rgb = P.find((p, n) => uf.find(n) === A && p.rgb)?.rgb || [128, 128, 128];
    const nw = [];
    for (const pl of chain) {
      const xs = pl.cells.map((c) => c[0]), zs = pl.cells.map((c) => c[1]), i0 = Math.min(...xs), j0 = Math.min(...zs), len = pl.cells.length;
      const alongX = zs.every((t) => t === zs[0]) && len > 1;
      nw.push(mk(plateOf(by, len), alongX ? len : 1, alongX ? 1 : len, i0, j0, pl.l, rgb, 'T-bridge'));
    }
    if (S.mirror) {                                   // symmetric twin when its cells are free
      const [ax, pc] = S.mirror, tw = [], seen = new Set(used);
      for (const q of nw) {
        const q2 = { ...q }; if (ax === 'x') q2.i = pc - q.i - q.w; else q2.j = pc - q.j - q.d;
        if (q2.i === q.i && q2.j === q.j) continue;
        let good = true; const cells = [];
        for (let dz = 0; dz < q2.d; dz++) for (let dx = 0; dx < q2.w; dx++) { const x = q2.i + dx, z = q2.j + dz; if (!free(x, z, q2.b) || seen.has(K(x, z, q2.b))) good = false; cells.push(K(x, z, q2.b)); }
        if (good) { tw.push(q2); cells.forEach((c) => seen.add(c)); }
      }
      nw.push(...tw);
    }
    for (const q of nw) { S.pieces.push(q); addVolume(S, q); }
    added += nw.length; state = null;
  }
  return added;
}

// ------------------------------------------------------------------ exterior air / tiles only where the sky is
/** cells of the grid (+1 padding on every side) that are empty and reachable from outside through empty cells (6-neighbourhood) */
export function exteriorAir(S) {
  const NX = S.NXc + 2, NZ = S.NZc + 2, NL = S.NL + 2, N = NX * NZ * NL, occ = new Uint8Array(N);
  const id = (x, z, l) => (l * NZ + z) * NX + x;
  for (const p of S.pieces) for (let l = p.b; l < p.b + p.h; l++) for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) {
    const x = p.i + dx + 1, z = p.j + dz + 1, L = l + 1; if (x >= 0 && x < NX && z >= 0 && z < NZ && L >= 0 && L < NL) occ[id(x, z, L)] = 1;
  }
  const ext = new Uint8Array(N), st = new Int32Array(N); let sp = 0;
  const push = (x, z, l) => { const k = id(x, z, l); if (!occ[k] && !ext[k]) { ext[k] = 1; st[sp++] = k; } };
  push(0, 0, NL - 1);                                       // every padding cell is connected to the corner
  for (let l = 0; l < NL; l++) for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) if (x === 0 || z === 0 || l === NL - 1 || x === NX - 1 || z === NZ - 1) push(x, z, l);
  const plane = NX * NZ;
  while (sp) {
    const k = st[--sp], l = (k / plane) | 0, r = k - l * plane, z = (r / NX) | 0, x = r - z * NX;
    if (x > 0) push(x - 1, z, l); if (x < NX - 1) push(x + 1, z, l); if (z > 0) push(x, z - 1, l); if (z < NZ - 1) push(x, z + 1, l);
    if (l > 0) push(x, z, l - 1); if (l < NL - 1) push(x, z, l + 1);
  }
  return (x, z, l) => { const xx = x + 1, zz = z + 1, ll = l + 1; return xx < 0 || zz < 0 || ll < 0 || xx >= NX || zz >= NZ || ll >= NL || ext[id(xx, zz, ll)] === 1; };
}
/** a smooth tile belongs to the outside skin only: when the cell(s) above it are not open to the sky (something sits on it, or it faces
 * an enclosed cavity) it becomes studded plates of the same footprint */
export function untile(S, cat) {
  const air = exteriorAir(S), shp = shapes(cat, 'plate'); let n = 0; const keep = [], add = [];
  for (const p of S.pieces) {
    if (p.kind !== 'tile') { keep.push(p); continue; }
    let open = true;
    for (let dz = 0; dz < p.d && open; dz++) for (let dx = 0; dx < p.w; dx++) if (!air(p.i + dx, p.j + dz, p.b + p.h)) { open = false; break; }
    if (open) { keep.push(p); continue; }
    const cells = new Map(); for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) cells.set(K2(p.i + dx, p.j + dz), p.rgb);
    for (let l = p.b; l < p.b + p.h; l++) add.push(...pack(cells, shp, l, 1e9).map((x) => ({ ...x, phase: 'U-untile' })));
    n++;
  }
  S.pieces = keep.concat(add);
  return n;
}

// ------------------------------------------------------------------ re-tiling merge: three levels of plates -> bricks, whatever the plate footprints
/** Wherever three consecutive levels are covered by plain plates of close colour, pack the common cells with bricks and re-cut the
 *  plates that lost cells. Unlike `vertical` the plate footprints need not coincide. Each level triple is committed only if the
 *  piece count drops and connectivity does not get worse (a re-cut plate could lose its only stud contact). */
export function retile(S, cat, tol) {
  const bricks = shapes(cat, 'brick'), plates = shapes(cat, 'plate');
  const plain = (p) => p.kind === 'plate' && p.h === 1 && p.studs.length === p.w * p.d;
  let gained = 0;
  const levels = [...new Set(S.pieces.filter(plain).map((p) => p.b))].sort((a, b) => a - b);
  for (const b of levels) {
    const P = S.pieces, cells = [0, 1, 2].map(() => new Map());
    // working set of plates on the three levels: id -> { l, rgb, cells: Set, piece }; ids < P.length are original pieces, larger ones are re-cuts made here
    const work = new Map(); let nextId = P.length;
    P.forEach((p, n) => { if (!plain(p) || p.b < b || p.b > b + 2) return; const l = p.b - b, cs = new Set(); for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) { const k = K2(p.i + dx, p.j + dz); cells[l].set(k, p.rgb); cs.add(k); } work.set(n, { l, rgb: p.rgb, cells: cs, piece: p }); });
    if (!cells[0].size || !cells[1].size || !cells[2].size) continue;
    const triple = new Map();
    for (const [k, c0] of cells[0]) { const c1 = cells[1].get(k), c2 = cells[2].get(k); if (c1 && c2 && close(c0, c1, tol) && close(c1, c2, tol) && close(c0, c2, tol)) triple.set(k, meanRgb([c0, c1, c2])); }
    if (!triple.size) continue;
    // candidates: first bricks with exactly the footprint of a plate of the stack (they swallow that plate whole), largest first; then a generic packing of what is left
    const brickOf = new Map(); for (const c of bricks) { brickOf.set(`${c.w},${c.d}`, c); brickOf.set(`${c.d},${c.w}`, c); }
    const cand = [], taken = new Set();
    const ws = [...work.values()].sort((a, b) => b.cells.size - a.cells.size);
    for (const w of ws) {
      const p = w.piece, c = brickOf.get(`${p.w},${p.d}`); if (!c || p.w * p.d < 2) continue;
      let ok = true; for (const k of w.cells) if (!triple.has(k) || taken.has(k)) { ok = false; break; }
      if (!ok) continue;
      cand.push(mk(c, p.w, p.d, p.i, p.j, b, meanRgb([...w.cells].map((k) => triple.get(k))), 'M-retile')); w.cells.forEach((k) => taken.add(k));
    }
    const rest = new Map(); for (const [k, c] of triple) if (!taken.has(k)) rest.set(k, c);
    if (rest.size) cand.push(...pack(rest, bricks, b, tol));
    if (!cand.length) continue;
    // every brick is checked on its own against the cumulative edit: fewer pieces, no new component, nothing un-grounded
    const occ = occupancy(P), pairs = linkPairs(P, occ);
    let cur = countCompsAfter(P, occ, pairs, new Set(), []);
    const kill = new Set(), add = [];
    for (const q of cand) {
      const qc = []; for (let dz = 0; dz < q.d; dz++) for (let dx = 0; dx < q.w; dx++) qc.push(K2(q.i + dx, q.j + dz));
      const hit = []; for (const [id, w] of work) if (qc.some((k) => w.cells.has(k))) hit.push(id);
      const cuts = hit.map((id) => { const w = work.get(id), left = new Map(); for (const k of w.cells) if (!qc.includes(k)) left.set(k, w.rgb); return { id, w, parts: left.size ? pack(left, plates, b + w.l, 1e9) : [] }; });
      const delta = hit.length - 1 - cuts.reduce((a, c) => a + c.parts.length, 0);
      if (delta < 1 && !(delta === 0 && q.w * q.d >= 2)) continue;
      const kill2 = new Set(kill), add2 = add.slice();
      const brick = { ...q, phase: 'M-retile' }, fresh = [];
      for (const { id, w, parts } of cuts) {
        if (id < P.length) kill2.add(id); else add2.splice(add2.indexOf(w.piece), 1);
        for (const np of parts) { const piece = { ...np, phase: 'M-retile' }; add2.push(piece); fresh.push([w, piece]); }
      }
      add2.push(brick);
      const r = countCompsAfter(P, occ, pairs, kill2, add2);
      if (r.comps > cur.comps || r.pieces - r.grounded > cur.pieces - cur.grounded) continue;
      cur = r; kill.clear(); kill2.forEach((x) => kill.add(x)); add.length = 0; add.push(...add2);
      for (const { id } of cuts) work.delete(id);
      for (const [w, piece] of fresh) { const cs = new Set(); for (let dz = 0; dz < piece.d; dz++) for (let dx = 0; dx < piece.w; dx++) cs.add(K2(piece.i + dx, piece.j + dz)); work.set(nextId++, { l: w.l, rgb: w.rgb, cells: cs, piece }); }
    }
    if (!kill.size) continue;
    S.pieces = P.filter((_, n) => !kill.has(n)).concat(add);
    gained += kill.size - add.length;
  }
  return gained;
}

// ------------------------------------------------------------------ safe final merge: only ever UNITES whole pieces (never re-cuts), so connectivity cannot get worse
/** repeatedly merge two same-level plates (or tiles) of close colour whose union is a rectangle that exists as a part: 1x2+1x2 side by side -> 2x2,
 * 2x4 + 2x2 -> 2x6 ... Mirror symmetric: a merge is applied together with its mirror twin (or skipped). */
export function mergePairs(S, cat, kind, tol, passes = 12) {
  const H = kind === 'brick' ? 3 : 1;
  const shp = shapes(cat, kind), has = new Map(); for (const c of shp) { has.set(`${c.w},${c.d}`, c); has.set(`${c.d},${c.w}`, c); }
  let total = 0;
  for (let pass = 0; pass < passes; pass++) {
    const P = S.pieces, foot = new Map(), dead = new Set(), add = [];
    P.forEach((p, n) => { if (p.kind === kind && p.h === H) foot.set(`${p.b},${p.i},${p.j},${p.w},${p.d}`, n); });
    const mirrorFoot = (p) => { if (!S.mirror) return null; const [ax, c2] = S.mirror; return ax === 'x' ? { i: c2 - p.i - p.w, j: p.j } : { i: p.i, j: c2 - p.j - p.d }; };
    const plan = (n, m) => {                                // union rectangle of two pieces or null
      const a = P[n], b = P[m];
      if (a.b !== b.b || !close(a.rgb, b.rgb, tol)) return null;
      const i0 = Math.min(a.i, b.i), j0 = Math.min(a.j, b.j), i1 = Math.max(a.i + a.w, b.i + b.w), j1 = Math.max(a.j + a.d, b.j + b.d);
      if ((i1 - i0) * (j1 - j0) !== a.w * a.d + b.w * b.d) return null;      // not a rectangle (or overlapping)
      const c = has.get(`${i1 - i0},${j1 - j0}`); if (!c) return null;
      return { c, i: i0, j: j0, w: i1 - i0, d: j1 - j0, b: a.b };
    };
    const cands = [];
    P.forEach((a, n) => {
      if (a.kind !== kind || a.h !== H) return;
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const ni = dx ? a.i + a.w : a.i, nj = dz ? a.j + a.d : a.j;
        // the neighbour starting at (ni, nj) with the same extent across the seam
        for (const [w, d] of dx ? [[1, a.d], [2, a.d], [3, a.d], [4, a.d], [6, a.d], [8, a.d]] : [[a.w, 1], [a.w, 2], [a.w, 3], [a.w, 4], [a.w, 6], [a.w, 8]]) {
          const m = foot.get(`${a.b},${ni},${nj},${w},${d}`); if (m === undefined) continue;
          const u = plan(n, m); if (u) cands.push([-(u.w * u.d), n, m, u]);
        }
      }
    });
    cands.sort((x, y) => x[0] - y[0]);
    let did = 0;
    for (const [, n, m, u] of cands) {
      if (dead.has(n) || dead.has(m)) continue;
      const group = [[n, m, u]];
      const mf = mirrorFoot(P[n]);
      if (mf) {                                             // twin merge (same pair, mirrored)
        const a = P[n], b = P[m], ma = mirrorFoot(a), mb = mirrorFoot(b);
        const tn = foot.get(`${a.b},${ma.i},${ma.j},${a.w},${a.d}`), tm = foot.get(`${b.b},${mb.i},${mb.j},${b.w},${b.d}`);
        const selfTwin = (tn === n && tm === m) || (tn === m && tm === n);
        if (!selfTwin) {
          if (tn === undefined || tm === undefined || dead.has(tn) || dead.has(tm) || tn === m || tm === n || tn === tm) continue;
          const u2 = plan(tn, tm); if (!u2) continue;
          group.push([tn, tm, u2]);
        }
      }
      for (const [x, y, uu] of group) {
        dead.add(x); dead.add(y);
        add.push({ ...mk(uu.c, uu.w, uu.d, uu.i, uu.j, uu.b, meanRgb([P[x].rgb, P[y].rgb]), 'M-pair') });
      }
      did += group.length;
    }
    if (!did) break;
    S.pieces = P.filter((_, n) => !dead.has(n)).concat(add); total += did;
  }
  return total;
}
