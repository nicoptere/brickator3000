// BrickPack part dictionary & catalog trainer (browser- and Node-safe):
//   - Parses LDraw `.dat` parts recursively (including `parts/s/`, `p/`, `stud*.dat`, `cyli`/`rect` fallbacks) OR generic 3D meshes (OBJ/GLB/PLY)
//   - Extracts 4x4 LDU column top/bottom height fields -> 4-LDU sub-voxel stencils across 4 yaw rotations + sparse deficits
//   - Evaluates 1-LDU 3D Exact Euclidean Signed Distance Fields (EDT^2) with analytic stud CSG

import { STUD, PLATE, H, SX, SY, STUD_R, STUD_H } from './units.js';
import { signedDistance } from './field.js';

export const PACK_KINDS = new Set(['brick', 'plate', 'slope', 'inverted', 'curved', 'cheese', 'round']);
const SLOPED = new Set(['slope', 'inverted', 'curved', 'cheese']);

const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mulM4 = (a, b) => {
  const o = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
    }
  }
  return o;
};
const xf = (m, x, y, z) => [
  m[0] * x + m[1] * y + m[2] * z + m[3],
  m[4] * x + m[5] * y + m[6] * z + m[7],
  m[8] * x + m[9] * y + m[10] * z + m[11],
];

/** Fraction of a 4 x 4 LDU column covered by a stud disc, for the 5 x 5 columns of one cell */
export const STUD_COVER = (() => {
  const out = new Float32Array(SX * SX), n = 16;
  for (let z = 0; z < SX; z++) {
    for (let x = 0; x < SX; x++) {
      let k = 0;
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          const X = (x + (a + 0.5) / n) * H - STUD / 2;
          const Z = (z + (b + 0.5) / n) * H - STUD / 2;
          if (X * X + Z * Z <= STUD_R * STUD_R) k++;
        }
      }
      out[z * SX + x] = k / (n * n);
    }
  }
  return out;
})();

/** Yaw-rotate a fractional volume (L x nz x nx) by rot degrees (0, 90, 180, 270) */
export function rotateVolume(vol, L, c, rot) {
  const w = c.w, d = c.d, nz = d * SX, nx = w * SX;
  const th = (rot * Math.PI) / 180, co = Math.round(Math.cos(th)), si = Math.round(Math.sin(th));
  const [w2, d2] = rot === 90 || rot === 270 ? [d, w] : [w, d];
  const nx2 = w2 * SX, nz2 = d2 * SX, out = new Float32Array(L * nz2 * nx2);
  const mp = (u, v) => [co * u + si * v, -si * u + co * v];
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      const u = (x + 0.5) * H - (w * STUD) / 2, v = (z + 0.5) * H - (d * STUD) / 2;
      const [u2, v2] = mp(u, v);
      const ix = Math.min(nx2 - 1, Math.max(0, Math.floor((u2 + (w2 * STUD) / 2) / H)));
      const iz = Math.min(nz2 - 1, Math.max(0, Math.floor((v2 + (d2 * STUD) / 2) / H)));
      for (let l = 0; l < L; l++) out[(l * nz2 + iz) * nx2 + ix] = vol[(l * nz + z) * nx + x];
    }
  }
  const studs = (c.stud_cells || []).map(([i, j]) => {
    const [u2, v2] = mp((i + 0.5) * STUD - (w * STUD) / 2, (j + 0.5) * STUD - (d * STUD) / 2);
    return [
      Math.min(w2 - 1, Math.max(0, Math.floor((u2 + (w2 * STUD) / 2) / STUD))),
      Math.min(d2 - 1, Math.max(0, Math.floor((v2 + (d2 * STUD) / 2) / STUD))),
    ];
  });
  return { V: out, studs, w: w2, d: d2 };
}

/** Unrotated 4-LDU stencil of part c: { V (L x nz x nx), L (sub-voxel layers), h (plates) } */
export function baseStencil(c) {
  const nx = c.w * SX, nz = c.d * SX;
  if (c.cover && c.coverH) {
    const h = c.coverH, L = h * SY, V = new Float32Array(L * nz * nx);
    for (let l = 0; l < L; l++) {
      const srcOff = ((l / SY) | 0) * nz * nx;
      for (let q = 0; q < nz * nx; q++) V[l * nz * nx + q] = c.cover[srcOff + q];
    }
    return { V, L, h };
  }
  let tmax = 1e-3;
  for (let q = 0; q < c.top.length; q++) if (c.top[q] > tmax) tmax = c.top[q];
  const h = Math.ceil(tmax / PLATE - 1e-6), L = h * SY, V = new Float32Array(L * nz * nx);
  for (let l = 0; l < L; l++) {
    for (let q = 0; q < nz * nx; q++) {
      const top = c.top[q], bot = c.kind === 'inverted' && c.bot ? c.bot[q] : 0;
      V[l * nz * nx + q] = Math.min(1, Math.max(0, (Math.min(top, (l + 1) * H) - Math.max(bot, l * H)) / H));
    }
  }
  return { V, L, h };
}

/** Slope descriptor fitted from the stencil height field itself */
function slopeOf(V, L, nx, nz, inverted) {
  const top = new Float32Array(nx * nz), bot = new Float32Array(nx * nz);
  for (let q = 0; q < nx * nz; q++) {
    let lo = -1, hi = -1;
    for (let l = 0; l < L; l++) {
      if (V[l * nz * nx + q] > 0) { if (lo < 0) lo = l; hi = l; }
    }
    top[q] = lo < 0 ? 0 : (hi + V[hi * nz * nx + q]) * H;
    bot[q] = lo < 0 ? 0 : (lo + 1 - V[lo * nz * nx + q]) * H;
  }
  const hf = inverted ? bot : top;
  let mn = Infinity, mx = -Infinity;
  for (const v of hf) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  if (mx - mn < 1) return null;
  let n = 0, sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      const v = hf[z * nx + x];
      if (v <= mn + 0.5 || v >= mx - 0.5) continue;
      const X = (x + 0.5) * H, Z = (z + 0.5) * H;
      n++; sx += X; sz += Z; sh += v; sxx += X * X; szz += Z * Z; sxz += X * Z; sxh += X * v; szh += Z * v;
    }
  }
  let a = 0, b = 0;
  if (n >= 3) {
    const cxx = sxx - (sx * sx) / n, czz = szz - (sz * sz) / n, cxz = sxz - (sx * sz) / n;
    const cxh = sxh - (sx * sh) / n, czh = szh - (sz * sh) / n, det = cxx * czz - cxz * cxz;
    if (Math.abs(det) > 1e-9) { a = (cxh * czz - czh * cxz) / det; b = (czh * cxx - cxh * cxz) / det; }
  }
  if (!a && !b) {
    let hx = 0, hz = 0, lx = 0, lz = 0, nh = 0, nl = 0;
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const v = hf[z * nx + x];
        if (v >= mx - 0.5) { hx += x; hz += z; nh++; } else { lx += x; lz += z; nl++; }
      }
    }
    if (nh && nl) {
      a = ((hx / nh - lx / nl) * (mx - mn)) / (nx * H);
      b = ((hz / nh - lz / nl) * (mx - mn)) / (nz * H);
    }
  }
  const g = Math.hypot(a, b), angle = (Math.atan(g) * 180) / Math.PI;
  const ax = -a, az_ = -b, dir = Math.abs(ax) >= Math.abs(az_) ? (ax > 0 ? 0 : 2) : (az_ > 0 ? 1 : 3);
  return { angle: Math.round(angle * 10) / 10, az: inverted ? (dir + 2) % 4 : dir, inverted };
}

/**
 * Compile yaw variants & sparse deficit tables for every part in `catalog`.
 * Returns { byKey: Map("id|rot" -> variant), list: variant[] }
 */
export function buildVariants(catalog, { kinds = PACK_KINDS } = {}) {
  const byKey = new Map(), list = [];
  for (const c of catalog) {
    if (c.noSolo) continue;
    if (kinds && !kinds.has(c.kind)) continue;
    const { V: V0, L, h } = baseStencil(c);
    const seen = new Set();
    for (const rot of [0, 90, 180, 270]) {
      const r = rotateVolume(V0, L, c, rot);
      const nx = r.w * SX, nz = r.d * SX, per = nx * nz;
      let vol = 0, full = true;
      const di = [], dv = [];
      for (let q = 0; q < r.V.length; q++) {
        const v = r.V[q];
        vol += v;
        if (v < 1) { full = false; di.push(q); dv.push(1 - v); }
      }
      const v = {
        c, id: c.id, kind: c.kind, name: c.name, rot, w: r.w, d: r.d, h, L, V: r.V, vol, full,
        studs: r.studs, deficit: { idx: Int32Array.from(di), val: Float32Array.from(dv) }, per,
        slope: SLOPED.has(c.kind) ? slopeOf(r.V, L, nx, nz, c.kind === 'inverted') : null,
      };
      byKey.set(`${c.id}|${rot}`, v);
      const sig = `${r.w},${r.d},${Array.from(r.V, (x) => x.toFixed(3)).join(',')}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      if (vol / (SX * SX * SY) < 0.3) continue;
      list.push(v);
    }
  }
  return { byKey, list };
}

/** Compute 1-LDU 3D Euclidean Signed Distance Field (no studs) + analytic stud positions */
export function partSDF(c, pad = 4) {
  const { V, L } = baseStencil(c), nx0 = c.w * SX, nz0 = c.d * SX;
  const top = new Float32Array(nx0 * nz0), bot = new Float32Array(nx0 * nz0);
  for (let q = 0; q < nx0 * nz0; q++) {
    let lo = -1, hi = -1;
    for (let l = 0; l < L; l++) if (V[l * nz0 * nx0 + q] > 0) { if (lo < 0) lo = l; hi = l; }
    top[q] = lo < 0 ? -1 : (hi + V[hi * nz0 * nx0 + q]) * H;
    bot[q] = lo < 0 ? 0 : (lo + 1 - V[lo * nz0 * nx0 + q]) * H;
  }
  const hs = (f, X, Z) => {
    const fx = Math.min(nx0 - 1, Math.max(0, X / H - 0.5)), fz = Math.min(nz0 - 1, Math.max(0, Z / H - 0.5));
    const i = Math.min(nx0 - 2, Math.floor(fx)), k = Math.min(nz0 - 2, Math.floor(fz));
    if (nx0 < 2 || nz0 < 2) return f[Math.round(fz) * nx0 + Math.round(fx)];
    const tx = fx - i, tz = fz - k, at = (a, b) => f[b * nx0 + a];
    if (top[k * nx0 + i] < 0 || top[k * nx0 + i + 1] < 0 || top[(k + 1) * nx0 + i] < 0 || top[(k + 1) * nx0 + i + 1] < 0) {
      return f[Math.round(fz) * nx0 + Math.round(fx)];
    }
    return (at(i, k) * (1 - tx) + at(i + 1, k) * tx) * (1 - tz) + (at(i, k + 1) * (1 - tx) + at(i + 1, k + 1) * tx) * tz;
  };
  const W = c.w * STUD, D = c.d * STUD, HT = L * H;
  const nx = W + 2 * pad, ny = HT + STUD_H + 2 * pad, nz = D + 2 * pad, inside = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      const X = x + 0.5 - pad, Z = z + 0.5 - pad;
      if (X < 0 || Z < 0 || X > W || Z > D) continue;
      const col = Math.min(nz0 - 1, Math.floor(Z / H)) * nx0 + Math.min(nx0 - 1, Math.floor(X / H));
      if (top[col] < 0) continue;
      const t = hs(top, X, Z), b = hs(bot, X, Z);
      for (let y = 0; y < ny; y++) {
        const Y = y + 0.5 - pad;
        if (Y >= b && Y <= t) inside[(y * nz + z) * nx + x] = 1;
      }
    }
  }
  const sdf = signedDistance(inside, nx, ny, nz);
  let vox = 0; for (const v of inside) vox += v;
  const studs = (c.stud_cells || []).map(([i, j]) => {
    const X = (i + 0.5) * STUD, Z = (j + 0.5) * STUD;
    const col = Math.min(nz0 - 1, Math.floor(Z / H)) * nx0 + Math.min(nx0 - 1, Math.floor(X / H));
    return [X, Math.max(0, top[col]), Z];
  });
  return { sdf, nx, ny, nz, origin: [-pad, -pad, -pad], step: 1, studs, vol: vox };
}

/** Analytic CSG SDF of stud cylinders r=6, h=4 standing on [cx, y0, cz] */
export function studSDF(studs, x, y, z) {
  let d = Infinity;
  for (const [cx, y0, cz] of studs) {
    const r = Math.hypot(x - cx, z - cz) - STUD_R, hy = Math.abs(y - (y0 + STUD_H / 2)) - STUD_H / 2;
    const out = Math.hypot(Math.max(r, 0), Math.max(hy, 0)), ins = Math.min(Math.max(r, hy), 0);
    d = Math.min(d, out + ins);
  }
  return d;
}

/* ---------------- Catalog Training (LDraw .dat & generic OBJ/GLB/PLY) ---------------- */

const CYLI_N = 16;
function synthPrim(low, M, outTris, outStuds) {
  if (low.includes('stud')) outStuds.push(xf(M, 0, 0, 0));
  const base = low.split(/[\\/]/).pop().split('.')[0];
  if (base.startsWith('rect')) {
    const pts = [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]].map(([x, y, z]) => xf(M, x, y, z));
    outTris.push(pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]);
    return true;
  }
  if (base.includes('cyli')) {
    for (let i = 0; i < CYLI_N; i++) {
      const a0 = (2 * Math.PI * i) / CYLI_N, a1 = (2 * Math.PI * ((i + 1) % CYLI_N)) / CYLI_N;
      const p00 = xf(M, Math.cos(a0), 0, Math.sin(a0)), p10 = xf(M, Math.cos(a1), 0, Math.sin(a1));
      const p01 = xf(M, Math.cos(a0), 1, Math.sin(a0)), p11 = xf(M, Math.cos(a1), 1, Math.sin(a1));
      outTris.push(p00, p10, p11, p00, p11, p01);
    }
    return true;
  }
  return false;
}

/**
 * Recursively parse an LDraw `.dat` part given a `resolver(subpath) => string|null`
 */
export function parseLDrawDat(entryName, resolver) {
  const tris = [], studs = [], seenPrim = new Set();
  const stack = new Set();
  function walk(name, M, depth) {
    if (depth > 24 || stack.has(name)) return;
    const txt = resolver(name);
    if (!txt) return;
    stack.add(name);
    for (const raw of txt.split(/\r?\n/)) {
      const s = raw.trim();
      if (!s) continue;
      const tok = s.split(/\s+/);
      const t = Number(tok[0]);
      if (t === 1 && tok.length >= 15) {
        const sub = tok.slice(14).join(' ').replace(/\\/g, '/');
        const mSub = [
          +tok[5], +tok[6], +tok[7], +tok[2],
          +tok[8], +tok[9], +tok[10], +tok[3],
          +tok[11], +tok[12], +tok[13], +tok[4],
          0, 0, 0, 1,
        ];
        const NM = mulM4(M, mSub);
        const low = sub.toLowerCase();
        if (low.includes('stud')) {
          const p = xf(NM, 0, 0, 0);
          const key = `${p[0].toFixed(1)},${p[1].toFixed(1)},${p[2].toFixed(1)}`;
          if (!seenPrim.has(key)) { seenPrim.add(key); studs.push(p); }
        }
        if (resolver(sub)) walk(sub, NM, depth + 1);
        else synthPrim(low, NM, tris, studs);
      } else if (t === 3 && tok.length >= 11) {
        tris.push(
          xf(M, +tok[2], +tok[3], +tok[4]),
          xf(M, +tok[5], +tok[6], +tok[7]),
          xf(M, +tok[8], +tok[9], +tok[10]),
        );
      } else if (t === 4 && tok.length >= 14) {
        const p0 = xf(M, +tok[2], +tok[3], +tok[4]), p1 = xf(M, +tok[5], +tok[6], +tok[7]);
        const p2 = xf(M, +tok[8], +tok[9], +tok[10]), p3 = xf(M, +tok[11], +tok[12], +tok[13]);
        tris.push(p0, p1, p2, p0, p2, p3);
      }
    }
    stack.delete(name);
  }
  walk(entryName, I4, 0);
  // Extract title from line 0
  const rootTxt = resolver(entryName) || '';
  const firstLine = (rootTxt.split(/\r?\n/).find((l) => l.trim()) || '').replace(/^0\s+/, '').trim();
  return { tris, studs, title: firstLine };
}

function classifyLDrawTitle(id, title, hPlates) {
  const tl = title.toLowerCase();
  if (tl.includes('slope') && tl.includes('inverted')) return 'inverted';
  if (tl.includes('cheese') || (tl.includes('slope') && tl.includes('31') && tl.includes('1 x 1'))) return 'cheese';
  if (tl.includes('curved') && tl.includes('slope')) return 'curved';
  if (tl.includes('slope')) return 'slope';
  if (tl.includes('tile')) return 'tile';
  if (tl.includes('plate')) return 'plate';
  if (tl.includes('round') || tl.includes('cylinder') || tl.includes('cone') || tl.includes('dome')) return 'round';
  if (tl.includes('technic')) return 'technic';
  if (hPlates === 1) return 'plate';
  return 'brick';
}

/**
 * Train a catalog entry { id, name, kind, w, d, top, bot, stud_cells, sdfShape? }
 * from raw LDraw-space triangles (Y-down, 20 LDU/stud, 8 LDU/plate) or normalized mesh triangles.
 */
export function trainPartFromLDrawGeom(id, title, rawTris, rawStuds = [], opts = {}) {
  if (!rawTris.length) return null;
  // Filter out extreme outlier spikes and compute bounds (in LDraw Y-down coordinates)
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of rawTris) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    if (p[2] < z0) z0 = p[2]; if (p[2] > z1) z1 = p[2];
  }
  const hasStudGeom = rawStuds.length > 0;
  // Studs extend ~4 LDU above main body top (which in LDraw Y-down is negative y)
  const studTopY = rawStuds.length ? Math.min(...rawStuds.map((s) => s[1])) : y0;
  const maxY = y1;
  // Snap body bottom (in Y-up: maxY - y) to origin 0, and round footprint to stud multiples
  const spanX = Math.max(STUD, Math.round((x1 - x0) / STUD) * STUD);
  const spanZ = Math.max(STUD, Math.round((z1 - z0) / STUD) * STUD);
  const w = Math.max(1, Math.round(spanX / STUD)), d = Math.max(1, Math.round(spanZ / STUD));
  // Centre X/Z footprint cleanly on [0, w*20] x [0, d*20]
  const cxMid = 0.5 * (x0 + x1), czMid = 0.5 * (z0 + z1);
  const offX = (w * STUD) / 2 - cxMid, offZ = (d * STUD) / 2 - czMid;
  // Transform every triangle to local BrickPack coordinates: x in [0, 20*w], z in [0, 20*d], y up from base = maxY
  const nTri = rawTris.length / 3;
  const xTris = new Float32Array(nTri * 9);
  let bodyTopUp = 0;
  for (let i = 0; i < rawTris.length; i++) {
    const p = rawTris[i];
    const ux = p[0] + offX, uy = maxY - p[1], uz = -(p[2] + offZ) + d * STUD;
    xTris[i * 3] = ux; xTris[i * 3 + 1] = uy; xTris[i * 3 + 2] = uz;
    if (uy > bodyTopUp) bodyTopUp = uy;
  }
  // If studs were detected at top, subtract stud height (~4 LDU) when snapping height to multiples of PLATE
  const rawBodyTop = hasStudGeom ? Math.max(PLATE, maxY - studTopY) : bodyTopUp;
  const hPlates = Math.max(1, Math.round(rawBodyTop / PLATE));
  const targetH = hPlates * PLATE;

  // Rasterize column heights (5x5 samples per stud -> 4x4 LDU columns)
  const nx = w * SX, nz = d * SX;
  const top = new Float32Array(nx * nz).fill(-1);
  const bot = new Float32Array(nx * nz).fill(Infinity);
  const hits = new Uint16Array(nx * nz);
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    const ax = xTris[o], ay = xTris[o + 1], az = xTris[o + 2];
    const bx = xTris[o + 3], by = xTris[o + 4], bz = xTris[o + 5];
    const cx = xTris[o + 6], cy = xTris[o + 7], cz = xTris[o + 8];
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-8) continue;
    const tx0 = Math.min(ax, bx, cx), tx1 = Math.max(ax, bx, cx);
    const tz0 = Math.min(az, bz, cz), tz1 = Math.max(az, bz, cz);
    const i0 = Math.max(0, Math.floor(tx0 / H)), i1 = Math.min(nx - 1, Math.floor(tx1 / H));
    const k0 = Math.max(0, Math.floor(tz0 / H)), k1 = Math.min(nz - 1, Math.floor(tz1 / H));
    for (let k = k0; k <= k1; k++) {
      const Z = (k + 0.5) * H + 0.0029;
      for (let i = i0; i <= i1; i++) {
        const X = (i + 0.5) * H + 0.0013;
        const l1 = ((bz - cz) * (X - cx) + (cx - bx) * (Z - cz)) / den;
        if (l1 < -1e-4) continue;
        const l2 = ((cz - az) * (X - cx) + (ax - cx) * (Z - cz)) / den;
        if (l2 < -1e-4) continue;
        const l3 = 1 - l1 - l2;
        if (l3 < -1e-4) continue;
        const y = Math.min(targetH, Math.max(0, l1 * ay + l2 * by + l3 * cy));
        const q = k * nx + i;
        hits[q]++;
        if (y > top[q]) top[q] = y;
        if (y < bot[q]) bot[q] = y;
      }
    }
  }
  for (let q = 0; q < nx * nz; q++) {
    if (!hits[q]) { top[q] = 0; bot[q] = 0; }
    else {
      // Snap near-plate heights cleanly to plate boundaries (removes sub-0.2 LDU stud-rim noise)
      if (Math.abs(top[q] - targetH) < 1.2) top[q] = targetH;
      if (bot[q] < 1.5) bot[q] = 0;
    }
  }
  // Map stud cell coordinates
  const cellSet = new Set();
  for (const s of rawStuds) {
    const ux = s[0] + offX, uz = -(s[2] + offZ) + d * STUD, uy = maxY - s[1];
    if (uy < targetH - 5) continue; // ignore side studs unless upright
    const ci = Math.floor(ux / STUD), cj = Math.floor(uz / STUD);
    if (ci >= 0 && ci < w && cj >= 0 && cj < d) cellSet.add(`${ci},${cj}`);
  }
  const kind = opts.kind || classifyLDrawTitle(id, title, hPlates);
  if (cellSet.size === 0 && (kind === 'brick' || kind === 'plate')) {
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) cellSet.add(`${i},${j}`);
  }
  const stud_cells = [...cellSet].map((s) => s.split(',').map(Number));
  return {
    id,
    name: title || id,
    kind,
    w,
    d,
    top: Array.from(top, (v) => +v.toFixed(2)),
    bot: Array.from(bot, (v) => +v.toFixed(2)),
    stud_cells,
  };
}

/**
 * Train a catalog entry directly from a generic 3D mesh (OBJ / GLB / PLY Float32Array tris).
 * Scales the mesh to fit inside `w x d x hPlates` LEGO units (default: inferred aspect ratio).
 */
export function trainPartFromMesh(id, tris, { w = null, d = null, hPlates = null, kind = 'shape', studsTop = true } = {}) {
  let lo0 = Infinity, lo1 = Infinity, lo2 = Infinity, hi0 = -Infinity, hi1 = -Infinity, hi2 = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    if (x < lo0) lo0 = x; if (x > hi0) hi0 = x;
    if (y < lo1) lo1 = y; if (y > hi1) hi1 = y;
    if (z < lo2) lo2 = z; if (z > hi2) hi2 = z;
  }
  const ex = Math.max(1e-6, hi0 - lo0), ey = Math.max(1e-6, hi1 - lo1), ez = Math.max(1e-6, hi2 - lo2);
  const W = w || Math.max(1, Math.min(8, Math.round((ex / Math.min(ex, ez)) * 2)));
  const D = d || Math.max(1, Math.min(8, Math.round((ez / Math.min(ex, ez)) * 2)));
  const HPL = hPlates || Math.max(1, Math.round((ey / ((ex / (W * STUD) + ez / (D * STUD)) * 0.5)) / PLATE));
  // Convert to LDraw Y-down temporary tuples for uniform z-buffering
  const rawTris = [];
  const sx = (W * STUD) / ex, sz = (D * STUD) / ez, sy = (HPL * PLATE) / ey;
  for (let i = 0; i < tris.length; i += 3) {
    rawTris.push([
      (tris[i] - lo0) * sx,
      (HPL * PLATE) - (tris[i + 1] - lo1) * sy,
      (tris[i + 2] - lo2) * sz,
    ]);
  }
  const studList = [];
  if (studsTop) {
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) studList.push([(i + 0.5) * STUD, -STUD_H, (j + 0.5) * STUD]);
  }
  const c = trainPartFromLDrawGeom(id, id, rawTris, studList, { kind: kind === 'shape' ? 'slope' : kind });
  if (c) c.name = id;
  return c;
}

/** Serialize/deserialize catalog JSON cleanly (rehydrating Float32Arrays) */
export function serializeCatalog(catalog, meta = {}) {
  return JSON.stringify({
    format: 'brickpack-catalog-v1',
    count: catalog.length,
    ...meta,
    parts: catalog.map((p) => ({
      id: p.id, name: p.name, kind: p.kind, w: p.w, d: p.d,
      ...(p.cover ? { coverH: p.coverH, cover: Array.from(p.cover) } : {}),
      ...(p.top ? { top: Array.from(p.top) } : {}),
      ...(p.bot ? { bot: Array.from(p.bot) } : {}),
      stud_cells: p.stud_cells || [],
      ...(p.noSolo ? { noSolo: true } : {}),
      ...(p.omr_count !== undefined ? { omr_count: p.omr_count } : {}),
    })),
  });
}

export function deserializeCatalog(jsonOrObj) {
  const doc = typeof jsonOrObj === 'string' ? JSON.parse(jsonOrObj) : jsonOrObj;
  const arr = Array.isArray(doc) ? doc : doc.parts || [];
  return arr.map((p) => ({
    ...p,
    ...(p.top ? { top: Float32Array.from(p.top) } : {}),
    ...(p.bot ? { bot: Float32Array.from(p.bot) } : {}),
    ...(p.cover ? { cover: Float32Array.from(p.cover) } : {}),
  }));
}
