// Piece geometry (internal Y-up frame, LDU), feature edges, LDraw text.
import { STUD, PLATE } from './constants.js';
import { ORIENTATIONS, orientPart, ldrMatrix } from '../motifs/orient.js';

const rotY = (deg) => { const t = deg * Math.PI / 180, c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t)); return [c, 0, s, 0, 1, 0, -s, 0, c]; };

function box(x0, x1, y0, y1, z0, z1, out) {
  const v = []; for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) v.push([x, y, z]);
  for (const [a, b, c, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
}
function cyl(cx, cz, r, y0, y1, seg, out, r2 = r) {
  for (let i = 0; i < seg; i++) {
    const a0 = 2 * Math.PI * i / seg, a1 = 2 * Math.PI * (i + 1) / seg;
    const p0 = [cx + r * Math.cos(a0), cz + r * Math.sin(a0)], p1 = [cx + r * Math.cos(a1), cz + r * Math.sin(a1)];
    const q0 = [cx + r2 * Math.cos(a0), cz + r2 * Math.sin(a0)], q1 = [cx + r2 * Math.cos(a1), cz + r2 * Math.sin(a1)];
    out.push(p0[0], y0, p0[1], p1[0], y0, p1[1], q1[0], y1, q1[1], p0[0], y0, p0[1], q1[0], y1, q1[1], q0[0], y1, q0[1],
      cx, y1, cz, q0[0], y1, q0[1], q1[0], y1, q1[1]);
  }
}

/** body triangles of a part in its own frame, centred on the footprint centre (studs are separate, see studLocal) */
export function partLocal(c) {
  const out = [], w = c.w, d = c.d;
  if (c.source === 'analytic') {
    const H = c.h * PLATE;
    if (c.kind === 'round') {
      const rads = c.rad || Array(Math.round(c.h)).fill(w * STUD / 2);
      rads.forEach((r, l) => cyl(0, 0, r, l * PLATE, (l + 1) * PLATE, 20, out, l + 1 < rads.length ? rads[l + 1] : r));
    } else box(-w * 10, w * 10, 0, H, -d * 10, d * 10, out);
    return new Float32Array(out);
  }
  const cx = c.minx + w * 10, cz = c.minz + d * 10;
  for (const t of c.tris) for (const p of t) out.push(p[0] - cx, p[1], p[2] - cz);
  return new Float32Array(out);
}
/** stud base centres in the part frame */
export function studLocal(c) {
  if (c.kind === 'tile') return [];
  if (c.source === 'analytic') return c.stud_cells.map(([i, j]) => [-c.w * 10 + (i + 0.5) * STUD, c.h * PLATE, -c.d * 10 + (j + 0.5) * STUD]);
  let H = 0; for (const row of c.top) for (const t of row) H = Math.max(H, t);
  const cx = c.minx + c.w * 10, cz = c.minz + c.d * 10;
  return c.stud_cells.map(([i, j]) => [c.minx + (i + 0.5) * STUD - cx, H, c.minz + (j + 0.5) * STUD - cz]);
}

/** triangle soup -> unique vertices + indices */
function indexed(tris) {
  const map = new Map(), pos = [], idx = new Uint32Array(tris.length / 3);
  for (let k = 0; k < tris.length; k += 3) {
    const key = `${tris[k].toFixed(3)},${tris[k + 1].toFixed(3)},${tris[k + 2].toFixed(3)}`;
    let v = map.get(key); if (v === undefined) { v = pos.length / 3; map.set(key, v); pos.push(tris[k], tris[k + 1], tris[k + 2]); }
    idx[k / 3] = v;
  }
  return { pos: new Float32Array(pos), idx };
}
const STUD_GEO = (() => { const t = []; cyl(0, 0, 6, 0, 4, 10, t); return indexed(new Float32Array(t)); })();

/** edges between faces bending more than thr degrees (and open boundaries) */
export function featureEdges(tris, thr = 28) {
  const key = (x, y, z) => `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
  const ed = new Map(), ct = Math.cos(thr * Math.PI / 180);
  for (let t = 0; t < tris.length; t += 9) {
    const ux = tris[t + 3] - tris[t], uy = tris[t + 4] - tris[t + 1], uz = tris[t + 5] - tris[t + 2];
    const vx = tris[t + 6] - tris[t], vy = tris[t + 7] - tris[t + 1], vz = tris[t + 8] - tris[t + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const ln = Math.hypot(nx, ny, nz);
    if (ln < 1e-9) continue; nx /= ln; ny /= ln; nz /= ln;
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const A = [tris[t + a * 3], tris[t + a * 3 + 1], tris[t + a * 3 + 2]], B = [tris[t + b * 3], tris[t + b * 3 + 1], tris[t + b * 3 + 2]];
      const ka = key(...A), kb = key(...B), k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      if (!ed.has(k)) ed.set(k, { A, B, n: [] }); ed.get(k).n.push([nx, ny, nz]);
    }
  }
  const out = [];
  for (const { A, B, n } of ed.values()) {
    let sharp = n.length === 1;
    for (let k = 1; k < n.length && !sharp; k++) if (n[0][0] * n[k][0] + n[0][1] * n[k][1] + n[0][2] * n[k][2] < ct) sharp = true;
    if (sharp) out.push(...A, ...B);
  }
  return new Float32Array(out);
}

const tmpl = new Map();
/** cached template for a part at a yaw rotation (about its footprint centre): indexed body, edges, stud positions */
export function template(c, rot) {
  const k = `${c.id}|${rot}`; if (tmpl.has(k)) return tmpl.get(k);
  const loc = partLocal(c), R = rotY(rot);
  const rx = (x, z) => R[0] * x + R[2] * z, rz = (x, z) => R[6] * x + R[8] * z;
  const tris = new Float32Array(loc.length);
  for (let i = 0; i < loc.length; i += 3) { tris[i] = rx(loc[i], loc[i + 2]); tris[i + 1] = loc[i + 1]; tris[i + 2] = rz(loc[i], loc[i + 2]); }
  const edges = featureEdges(tris), body = indexed(tris);
  const studs = studLocal(c).map(([x, y, z]) => [rx(x, z), y, rz(x, z)]);
  const t = { pos: body.pos, idx: body.idx, edges, studs };
  tmpl.set(k, t); return t;
}
/** world offset of a piece's template (footprint centre at grid position, bottom at its level) */
export const pieceOrigin = (p) => [(p.i + p.w / 2) * STUD, p.b * PLATE, (p.j + p.d / 2) * STUD];
/** ... and of a sideways piece's: the centre of its box, which is the frame orient.js works in */
export const pieceCentre = (p) => [(p.i + p.w / 2) * STUD, (p.b + p.h / 2) * PLATE, (p.j + p.d / 2) * STUD];

const mul3 = (A, B) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return o; };
const tmplOri = new Map();
/** template of a part under one of the 24 orientations (motifs/orient.js), centred on its box centre; studs are not drawn (they point sideways) */
export function templateOri(c, ori) {
  const k = `${c.id}|o${ori}`; if (tmplOri.has(k)) return tmplOri.get(k);
  const R = ORIENTATIONS[ori], ob = orientPart(c, ori), loc = partLocal(c), Hc = ob.ny * (STUD / 5) / 2;   // partLocal is centred in x/z, y from the bottom face
  const tris = new Float32Array(loc.length);
  for (let i = 0; i < loc.length; i += 3) {
    const x = loc[i], y = loc[i + 1] - Hc, z = loc[i + 2];
    tris[i] = R[0] * x + R[1] * y + R[2] * z; tris[i + 1] = R[3] * x + R[4] * y + R[5] * z; tris[i + 2] = R[6] * x + R[7] * y + R[8] * z;
  }
  const body = indexed(tris), t = { pos: body.pos, idx: body.idx, edges: featureEdges(tris), studs: [] };
  tmplOri.set(k, t); return t;
}

/** LDraw (Y-down). v_ld = D (R (A p + c0 - cxz) + target), D = A = diag(1,-1,-1). colour: LEGO code when snapped, else direct RGB */
export function toLDR(pieces, cat, name) {
  const by = {}; for (const c of cat) by[c.id] = c;
  const lines = [`0 ${name}`, `0 Name: ${name}.ldr`, '0 Author: brickgen (claude/app)'];
  const TURNi = rotY(-90);
  for (const p of pieces) {
    // The part's own frame is a quarter turn from LDraw's for the analytic entries (they list their footprint as (z, x) of the real
    // part; checked against the library bounding boxes of all 210 parts by motifs/placements.js partFrames). Every orientation is
    // handled the same way: the LDraw origin sits at the box centre plus the part's own origin offset, rotated (motifs/orient.js).
    const c = by[p.id], ori = p.ori !== undefined ? p.ori : Math.round(((p.rot % 360) + 360) % 360 / 90), ob = orientPart(c, ori);
    const Rld = c.source === 'analytic' && c.w !== c.d ? mul3(ob.R, TURNi) : ob.R;
    const M = ldrMatrix(Rld);
    const ctr = pieceCentre({ ...p, w: ob.w, d: ob.d, h: ob.h });
    const r = [ctr[0] + ob.origin[0], ctr[1] + ob.origin[1], ctr[2] + ob.origin[2]];
    const t = [r[0], -r[1], -r[2]];
    const rgb = p.rgb || [200, 200, 200];
    const code = p.code !== undefined ? p.code : 0x2000000 + (rgb[0] << 16) + (rgb[1] << 8) + rgb[2];
    lines.push(`1 ${code} ${t.map((x) => x.toFixed(1)).join(' ')} ${M.map((x) => +x.toFixed(4)).join(' ')} ${p.id}.dat`);
  }
  return lines.join('\n') + '\n';
}

export const KIND_COL = { shape: [0.6, 0.45, 0.3], slope: [0.145, 0.388, 0.922], curved: [0.031, 0.569, 0.698], cheese: [0.576, 0.2, 0.918], inverted: [0.9, 0.3, 0.3],
  tile: [0.8, 0.84, 0.88], plate: [0.55, 0.6, 0.67], brick: [0.35, 0.4, 0.48], round: [0.95, 0.6, 0.1], technic: [0.2, 0.7, 0.35], shaped: [0.9, 0.78, 0.15], support: [0.75, 0.2, 0.75] };

/** indexed mesh of all pieces: positions, sRGB colours (Uint8 RGB per vertex), indices, edges, piece index per triangle.
 * Studs covered by another piece are dropped (they are invisible and are most of the triangles). */
export function buildMesh(pieces, cat, colorMode = 'piece', { hideCovered = true } = {}) {
  const by = {}; for (const c of cat) by[c.id] = c;
  const occ = new Set();
  if (hideCovered) for (const p of pieces) for (let dz = 0; dz < p.d; dz++) for (let dx = 0; dx < p.w; dx++) for (let l = 0; l < p.h; l++) occ.add(`${p.i + dx},${p.j + dz},${p.b + l}`);
  const plan = pieces.map((p) => {
    if (p.ori >= 4) return { t: templateOri(by[p.id], p.ori), studs: [], snot: true };
    const t = template(by[p.id], p.rot), [ox, , oz] = pieceOrigin(p), top = p.b + p.h;
    const studs = t.studs.filter(([x, , z]) => !occ.has(`${Math.floor((x + ox) / STUD)},${Math.floor((z + oz) / STUD)},${top}`));
    return { t, studs };
  });
  let nv = 0, ni = 0, ne = 0;
  for (const { t, studs } of plan) { nv += t.pos.length / 3 + studs.length * STUD_GEO.pos.length / 3; ni += t.idx.length + studs.length * STUD_GEO.idx.length; ne += t.edges.length; }
  const pos = new Float32Array(nv * 3), col = new Uint8Array(nv * 3), idx = new Uint32Array(ni), edges = new Float32Array(ne), triPiece = new Uint32Array(ni / 3);
  let v = 0, i = 0, e = 0;
  const put = (P, I, ox, oy, oz, c, n) => {
    const v0 = v;
    for (let k = 0; k < P.length; k += 3) { pos[v * 3] = P[k] + ox; pos[v * 3 + 1] = P[k + 1] + oy; pos[v * 3 + 2] = P[k + 2] + oz; col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2]; v++; }
    for (let k = 0; k < I.length; k++) idx[i + k] = I[k] + v0;
    triPiece.fill(n, i / 3, (i + I.length) / 3); i += I.length;
  };
  pieces.forEach((p, n) => {
    const { t, studs } = plan[n], [ox, oy, oz] = plan[n].snot ? pieceCentre(p) : pieceOrigin(p);
    const c = colorMode === 'kind' ? (KIND_COL[p.kind] || [0.6, 0.6, 0.6]).map((x) => Math.round(x * 255)) : p.rgb || [200, 200, 200];
    put(t.pos, t.idx, ox, oy, oz, c, n);
    for (const [x, y, z] of studs) put(STUD_GEO.pos, STUD_GEO.idx, ox + x, oy + y, oz + z, c, n);
    for (let k = 0; k < t.edges.length; k += 3) { edges[e + k] = t.edges[k] + ox; edges[e + k + 1] = t.edges[k + 1] + oy; edges[e + k + 2] = t.edges[k + 2] + oz; }
    e += t.edges.length;
  });
  return { pos, col, idx, edges, triPiece };
}

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** binary glTF: indexed triangles, COLOR_0 as normalised linear RGBA bytes, no normals (viewers compute flat normals). 1 unit = 100 LDU */
export function toGLB(mesh, scale = 0.01) {
  const { pos, col, idx } = mesh, n = pos.length / 3;
  const P = new Float32Array(pos.length), C = new Uint8Array(n * 4);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < pos.length; k++) { P[k] = pos[k] * scale; const a = k % 3; if (P[k] < lo[a]) lo[a] = P[k]; if (P[k] > hi[a]) hi[a] = P[k]; }
  const lut = new Uint8Array(256); for (let x = 0; x < 256; x++) lut[x] = Math.round(s2l(x / 255) * 255);
  for (let v = 0; v < n; v++) { C[v * 4] = lut[col[v * 3]]; C[v * 4 + 1] = lut[col[v * 3 + 1]]; C[v * 4 + 2] = lut[col[v * 3 + 2]]; C[v * 4 + 3] = 255; }
  const parts = [new Uint8Array(P.buffer), new Uint8Array(C.buffer), new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength)];
  const offs = []; let len = 0; for (const p of parts) { offs.push(len); len += Math.ceil(p.byteLength / 4) * 4; }
  const bin = new Uint8Array(len); parts.forEach((p, k) => bin.set(p, offs[k]));
  const json = {
    asset: { version: '2.0', generator: 'brickgen' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'lego' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, indices: 2, material: 0, mode: 4 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.6 } }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: offs[0], byteLength: P.byteLength, target: 34962 }, { buffer: 0, byteOffset: offs[1], byteLength: C.byteLength, target: 34962 },
      { buffer: 0, byteOffset: offs[2], byteLength: idx.byteLength, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min: lo, max: hi },
      { bufferView: 1, componentType: 5121, normalized: true, count: n, type: 'VEC4' },
      { bufferView: 2, componentType: 5125, count: idx.length, type: 'SCALAR' }],
  };
  const js = new TextEncoder().encode(JSON.stringify(json)), jp = (4 - (js.length % 4)) % 4;
  const jsonChunk = new Uint8Array(js.length + jp); jsonChunk.set(js); jsonChunk.fill(0x20, js.length);
  const total = 12 + 8 + jsonChunk.length + 8 + bin.length, out = new ArrayBuffer(total), dv = new DataView(out), u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonChunk.length, true); dv.setUint32(16, 0x4E4F534A, true); u8.set(jsonChunk, 20);
  const bo = 20 + jsonChunk.length; dv.setUint32(bo, bin.length, true); dv.setUint32(bo + 4, 0x004E4942, true); u8.set(bin, bo + 8);
  return out;
}
