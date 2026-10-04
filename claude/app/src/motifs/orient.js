// SNOT: a part turned on its side. The engine's volume field is sampled every 4 LDU in x / z and every plate (8 LDU) in y, and
// 4 LDU divides the stud (20), the plate (8) and the brick (24), so ANY axis-aligned orientation of a part can be rasterised into
// that field exactly - a sideways plate is 2 samples thick, a sideways brick 6, a 1-stud edge standing up is 2.5 plates tall
// (the last level comes out half full, which the solver already scores as a fraction).
// What a sideways part cannot do is land on whole studs: offsets are multiples of 4 LDU (0.2 stud) and 4 LDU (0.5 plate) in y.
// Piece records therefore carry fractional i / j / b, which only export.js and the viewer need to understand; the post passes
// skip them (see post.js) and connectivity treats the motif that holds them as one rigid group.
import { STUD, PLATE, G } from '../brickgen/constants.js';

const SAMP = STUD / G;                                            // 4 LDU

/** the 24 axis-aligned rotations as 3x3 integer matrices (world_r = sum_c M[r][c] * local_c); [0..3] are the upright yaws 0/90/180/270 */
export const ORIENTATIONS = (() => {
  const out = [], perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const p of perms) for (let s = 0; s < 8; s++) {
    const sg = [s & 1 ? -1 : 1, s & 2 ? -1 : 1, s & 4 ? -1 : 1];
    const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let r = 0; r < 3; r++) M[r * 3 + p[r]] = sg[r];
    const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
    if (det === 1) out.push(M);
  }
  // yaw r: world_x = cos.x + sin.z, world_z = -sin.x + cos.z (same convention as variants.js rotate)
  const yaw = [0, 90, 180, 270].map((deg) => { const t = deg * Math.PI / 180, c = Math.round(Math.cos(t)), s = Math.round(Math.sin(t)); return [c, 0, s, 0, 1, 0, -s, 0, c]; });
  const key = (M) => M.join(',');
  const first = yaw.map((M) => out.find((N) => key(N) === key(M)));
  return [...first, ...out.filter((M) => !first.some((N) => key(N) === key(M)))];
})();
export const isUpright = (ori) => ori < 4;
/** LDraw matrix of an orientation: D R D with D = diag(1, -1, -1), the same conversion export.js uses for the yaws */
export const ldrMatrix = (R) => { const D = [1, -1, -1], o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = D[r] * R[r * 3 + c] * D[c]; return o; };

/** fine (4 LDU cube) occupancy of a part in its own frame: F[ly][lz][lx], plus its extents in fine cells */
const fineCache = new Map();
export function fineVolume(c) {
  if (fineCache.has(c.id)) return fineCache.get(c.id);
  const nx = c.w * G, nz = c.d * G;
  let ny, F;
  if (c.cover) {                                                  // authoritative per-level occupancy (round parts, catalog_shapes)
    ny = c.cover.length * 2; F = new Float32Array(ny * nz * nx);
    for (let l = 0; l < c.cover.length; l++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const v = c.cover[l][z][x]; F[((2 * l) * nz + z) * nx + x] = v; F[((2 * l + 1) * nz + z) * nx + x] = v;
    }
  } else {                                                        // height field: exact at 4 LDU
    let tmax = 1e-3; for (const row of c.top) for (const t of row) if (t > tmax) tmax = t;
    ny = Math.ceil(tmax / SAMP - 1e-6); F = new Float32Array(ny * nz * nx);
    for (let l = 0; l < ny; l++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const top = c.top[z][x], bot = c.kind === 'inverted' ? c.bot[z][x] : 0;
      F[(l * nz + z) * nx + x] = Math.min(1, Math.max(0, (Math.min(top, (l + 1) * SAMP) - Math.max(bot, l * SAMP)) / SAMP));
    }
  }
  const out = { F, nx, ny, nz };
  fineCache.set(c.id, out); return out;
}

const cache = new Map();
/**
 * a part under one of the 24 orientations, on the engine grid:
 * { V (levels x nz x nx samples), nx, nz, nl, w, d, h (extents in studs / plates, fractional for a turned part), R, ldr, origin }
 * `origin` is the LDU vector from the world box centre to the part's own LDraw origin, which is all export.js needs.
 */
export function orientPart(c, ori) {
  const k = `${c.id}|${ori}`; if (cache.has(k)) return cache.get(k);
  const R = ORIENTATIONS[ori], { F, nx, ny, nz } = fineVolume(c);
  const nL = [nx, ny, nz];                                         // local fine extents per axis (x, y, z)
  const src = [0, 0, 0];                                           // for each world axis: which local axis feeds it, and whether flipped
  const flip = [false, false, false];
  for (let r = 0; r < 3; r++) for (let cc = 0; cc < 3; cc++) if (R[r * 3 + cc]) { src[r] = cc; flip[r] = R[r * 3 + cc] < 0; }
  const nW = [nL[src[0]], nL[src[1]], nL[src[2]]];                 // world fine extents (x, y, z)
  const FW = new Float32Array(nW[1] * nW[2] * nW[0]);             // world occupancy, still at 4 LDU in y
  const li = [0, 0, 0];
  for (let wy = 0; wy < nW[1]; wy++) for (let wz = 0; wz < nW[2]; wz++) for (let wx = 0; wx < nW[0]; wx++) {
    const w = [wx, wy, wz];
    for (let r = 0; r < 3; r++) li[src[r]] = flip[r] ? nL[src[r]] - 1 - w[r] : w[r];
    FW[(wy * nW[2] + wz) * nW[0] + wx] = F[(li[1] * nz + li[2]) * nx + li[0]];
  }
  const nl = Math.ceil(nW[1] / 2);
  const V = new Float32Array(nl * nW[2] * nW[0]);
  for (let wy = 0; wy < nW[1]; wy++) for (let q = 0; q < nW[2] * nW[0]; q++) V[(wy >> 1) * nW[2] * nW[0] + q] += FW[wy * nW[2] * nW[0] + q] / 2;
  const ext = [nW[0] * SAMP / STUD, nW[1] * SAMP / PLATE, nW[2] * SAMP / STUD];       // studs, plates, studs
  // the part's LDraw origin relative to its own box centre, rotated into the world
  const O = [0 - (c.minx + c.w * STUD / 2), (c.maxy ?? c.h * PLATE) - (ny * SAMP) / 2, 0 - (c.minz + c.d * STUD / 2)];
  const origin = [R[0] * O[0] + R[1] * O[1] + R[2] * O[2], R[3] * O[0] + R[4] * O[1] + R[5] * O[2], R[6] * O[0] + R[7] * O[1] + R[8] * O[2]];
  const out = { V, FW, ny: nW[1], nx: nW[0], nz: nW[2], nl, w: ext[0], d: ext[2], h: ext[1], R, ldr: ldrMatrix(R), origin, c, ori };
  cache.set(k, out); return out;
}

const mul = (A, B) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return o; };
const ORI_KEY = new Map(ORIENTATIONS.map((M, k) => [M.join(','), k]));
/** orientation of a part after the whole assembly is yawed by +90 (used to canonicalise a motif over its 4 rotations) */
export const ORI_YAW = ORIENTATIONS.map((M) => ORI_KEY.get(mul(ORIENTATIONS[1], M).join(',')));
