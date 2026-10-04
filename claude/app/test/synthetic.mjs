// Synthetic test geometry shared by test/noise_bench.mjs and claude/paper: a watertight house, and Gaussian grain along the normals.
import { STUD } from '../src/brickgen/constants.js';
import { mulberry32 } from '../src/brickgen/mesh.js';
import { weld, unweld, vertexNormals } from '../src/brickgen/smooth.js';

/** a house in LDU: 12 x 8 studs, walls 6 bricks, 45 deg gable roof along x. Watertight: every shared edge is subdivided identically
 *  (no T-junctions), the gables are fans over the wall-top and roof-edge vertices. Faces subdivided to ~`edge` LDU so grain has
 *  somewhere to live. Convex, so the even-odd ray pairing is exact on it. */
export function house(edge = 6) {
  const W = 12 * STUD, D = 8 * STUD, H = 144, R = D / 2;                    // roof rises R = D/2 -> 45 degrees
  const nx = Math.round(W / edge), nz = Math.round(D / edge), ny = Math.round(H / edge), ns = Math.round(Math.hypot(R, D / 2) / edge);
  const tris = [];
  const tri = (a, b, c) => tris.push(...a, ...b, ...c);
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  // grid patch: origin o, edge vectors u (nu segments) and v (nv segments); shared edges use the same segment counts everywhere
  const patch = (o, u, nu, v, nv) => {
    const P = (i, j) => [o[0] + u[0] * i / nu + v[0] * j / nv, o[1] + u[1] * i / nu + v[1] * j / nv, o[2] + u[2] * i / nu + v[2] * j / nv];
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1));
  };
  patch([0, 0, 0], [W, 0, 0], nx, [0, H, 0], ny);                 // front wall  z = 0 (outward -z)
  patch([W, 0, D], [-W, 0, 0], nx, [0, H, 0], ny);                // back wall   z = D
  patch([0, 0, D], [0, 0, -D], nz, [0, H, 0], ny);                // left wall   x = 0
  patch([W, 0, 0], [0, 0, D], nz, [0, H, 0], ny);                 // right wall  x = W
  patch([0, 0, D], [W, 0, 0], nx, [0, 0, -D], nz);                // floor
  patch([0, H, 0], [W, 0, 0], nx, [0, R, D / 2], ns);             // roof, front slope up to the ridge
  patch([W, H, D], [-W, 0, 0], nx, [0, R, -D / 2], ns);           // roof, back slope
  // gables: polygon = wall top (nz segments along z) + back roof edge (ns) + front roof edge (ns), fanned from its centroid
  for (const x of [0, W]) {
    const ring = [];
    for (let k = 0; k <= nz; k++) ring.push([x, H, D * k / nz]);                                   // wall top, z = 0 .. D
    for (let k = 1; k < ns; k++) ring.push([x, H + R * k / ns, D - (D / 2) * k / ns]);             // back roof edge up to the ridge
    ring.push([x, H + R, D / 2]);
    for (let k = ns - 1; k >= 1; k--) ring.push([x, H + R * k / ns, (D / 2) * k / ns]);             // front roof edge back down
    const c = [x, H + R / 3, D / 2];
    for (let k = 0; k < ring.length; k++) { const a = ring[k], b = ring[(k + 1) % ring.length]; if (x === 0) tri(c, b, a); else tri(c, a, b); }
  }
  const t = new Float32Array(tris), vcols = new Float32Array(t.length).fill(0.6);
  return { tris: t, vcols };
}

/** displace every welded vertex along its normal by N(0, sigma) (LDU of the normalised model) */
export function perturb(model, sigma, seed = 7) {
  if (!(sigma > 0)) return model;
  const { pos, idx } = weld(model.tris), n = vertexNormals(pos, idx), rng = mulberry32(seed);
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = rng(); v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  let ymin = Infinity; for (let v = 1; v < pos.length; v += 3) ymin = Math.min(ymin, pos[v]);
  for (let v = 0; v < pos.length; v += 3) { const g = gauss() * sigma; pos[v] += n[v] * g; pos[v + 1] = Math.max(ymin, pos[v + 1] + n[v + 1] * g); pos[v + 2] += n[v + 2] * g; }   // the model keeps standing on its ground
  return { ...model, tris: unweld(pos, idx) };
}


// ------------------------------------------------------------------------------------------- curved test shapes (docs/CURVES.md)
/** triangle soup of a closed parametric surface P(u, v), u in [0, nu) periodic, v in [0, nv]; poles where the v rows degenerate are fine
 *  (zero-area triangles are skipped). Winding: outward for a surface whose u runs counter-clockwise seen from +v. */
function lathe(P, nu, nv, flip = false) {
  const tris = [];
  const tri = (a, b, c) => { if (flip) [b, c] = [c, b]; tris.push(...a, ...b, ...c); };
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    tri(a, b, c); tri(a, c, d);
  }
  const t = new Float32Array(tris);
  return { tris: t, vcols: new Float32Array(t.length).fill(0.6) };
}

/** a solid of revolution about y: profile r(y) for y in [0, H], standing on the ground; closed with a flat bottom and a flat top */
export function revolve(rOf, H, { nu = 96, nv = 64 } = {}) {
  const P = (i, j) => { const th = 2 * Math.PI * i / nu, y = H * j / nv, r = Math.max(0, rOf(y)); return [r * Math.cos(th), y, r * Math.sin(th)]; };
  const side = lathe(P, nu, nv, true);
  const caps = [];
  for (const [y, flipCap] of [[0, false], [H, true]]) {
    const r = Math.max(0, rOf(y)); if (r <= 1e-6) continue;
    for (let i = 0; i < nu; i++) {
      const a = [0, y, 0], b = [r * Math.cos(2 * Math.PI * i / nu), y, r * Math.sin(2 * Math.PI * i / nu)], c = [r * Math.cos(2 * Math.PI * (i + 1) / nu), y, r * Math.sin(2 * Math.PI * (i + 1) / nu)];
      if (flipCap) caps.push(...a, ...c, ...b); else caps.push(...a, ...b, ...c);
    }
  }
  const t = new Float32Array(side.tris.length + caps.length); t.set(side.tris); t.set(caps, side.tris.length);
  return { tris: t, vcols: new Float32Array(t.length).fill(0.6) };
}
/** hemisphere of radius R (LDU) on the ground */
export const dome = (R = 160) => revolve((y) => Math.sqrt(Math.max(0, R * R - y * y)), R);
/** full sphere of radius R resting on the ground (undersides for the inverted slopes) */
export const sphere = (R = 160) => revolve((y) => Math.sqrt(Math.max(0, R * R - (y - R) * (y - R))), 2 * R);
/** egg: a sphere scaled 1 : 1.35 in y */
export const egg = (R = 140) => revolve((y) => { const t = (y - 1.35 * R) / (1.35 * R); return R * Math.sqrt(Math.max(0, 1 - t * t)); }, 2.7 * R);
/** cone of base radius R and height H */
export const cone = (R = 160, H = 200) => revolve((y) => R * (1 - y / H), H);
/** a cylinder lying along x: radius R, length L, resting on the ground (its underside wants inverted slopes) */
export function cylinderX(R = 120, L = 400, nu = 96) {
  const P = (i, j) => { const th = 2 * Math.PI * i / nu, x = j ? L : 0; return [x, R + R * Math.cos(th), R * Math.sin(th)]; };
  const side = lathe(P, nu, 1, true), caps = [];
  for (const [x, flipCap] of [[0, false], [L, true]]) for (let i = 0; i < nu; i++) {
    const a = [x, R, 0], b = [x, R + R * Math.cos(2 * Math.PI * i / nu), R * Math.sin(2 * Math.PI * i / nu)], c = [x, R + R * Math.cos(2 * Math.PI * (i + 1) / nu), R * Math.sin(2 * Math.PI * (i + 1) / nu)];
    if (flipCap) caps.push(...a, ...c, ...b); else caps.push(...a, ...b, ...c);
  }
  const t = new Float32Array(side.tris.length + caps.length); t.set(side.tris); t.set(caps, side.tris.length);
  return { tris: t, vcols: new Float32Array(t.length).fill(0.6) };
}
export const CURVED = { dome, sphere, egg, cone, cylinderX };

// ---------------------------------------------------------------------------------- SNOT test shapes (docs/CURVES.md round 7)
/** a closed axis-aligned box [x0,x1] x [y0,y1] x [z0,z1] as triangles (outward) */
function boxTris(x0, y0, z0, x1, y1, z1) {
  const q = (a, b, c, d) => [...a, ...b, ...c, ...a, ...c, ...d];
  const A = [x0, y0, z0], B = [x1, y0, z0], C = [x1, y1, z0], D = [x0, y1, z0], E = [x0, y0, z1], F = [x1, y0, z1], Gp = [x1, y1, z1], H = [x0, y1, z1];
  return [...q(A, D, C, B), ...q(E, F, Gp, H), ...q(A, B, F, E), ...q(D, H, Gp, C), ...q(A, E, H, D), ...q(B, C, Gp, F)];
}
/** a box of W x H x D LDU with a cylindrical boss (radius R, height T) standing proud of its +x face: the disc on a wall */
export function boxBoss(W = 160, H = 120, D = 160, R = 30, T = 8, nu = 48) {
  const tris = boxTris(0, 0, 0, W, H, D), cy = H / 2, cz = D / 2;
  for (let i = 0; i < nu; i++) {
    const a0 = 2 * Math.PI * i / nu, a1 = 2 * Math.PI * (i + 1) / nu;
    const p0 = [W, cy + R * Math.cos(a0), cz + R * Math.sin(a0)], p1 = [W, cy + R * Math.cos(a1), cz + R * Math.sin(a1)];
    const q0 = [W + T, p0[1], p0[2]], q1 = [W + T, p1[1], p1[2]];
    tris.push(...p0, ...p1, ...q1, ...p0, ...q1, ...q0);                     // side of the boss (outward)
    tris.push(W + T, cy, cz, ...q0, ...q1);                                  // its face
    tris.push(W, cy, cz, ...p1, ...p0);                                      // the ring on the wall faces inward (the box face is there too; the solid is the union)
  }
  const t = new Float32Array(tris); return { tris: t, vcols: new Float32Array(t.length).fill(0.6) };
}
/** a box of W x H x D with its +x/+z vertical edge rounded to radius R: the sideways-curved-slope corner */
export function boxRoundEdge(W = 160, H = 120, D = 160, R = 40, nu = 24) {
  const tris = [];
  const q = (a, b, c, d) => tris.push(...a, ...b, ...c, ...a, ...c, ...d);
  // outline of the footprint, counter-clockwise seen from above (+y): start at (0,0), go along +x, round the (W, D) corner, back along -x at z = D, down the x = 0 edge
  const ring = [[0, 0], [W, 0], [W, D - R]];
  for (let i = 1; i < nu; i++) { const a = Math.PI / 2 * i / nu; ring.push([W - R + R * Math.cos(a), D - R + R * Math.sin(a)]); }
  ring.push([W - R, D], [0, D]);
  for (let k = 0; k < ring.length; k++) {
    const [x0, z0] = ring[k], [x1, z1] = ring[(k + 1) % ring.length];
    q([x0, 0, z0], [x0, H, z0], [x1, H, z1], [x1, 0, z1]);                  // wall segment, outward normal = right-hand of the walk
  }
  const cx = W / 2, cz = D / 2;                                              // caps as fans
  for (let k = 0; k < ring.length; k++) { const [x0, z0] = ring[k], [x1, z1] = ring[(k + 1) % ring.length]; tris.push(cx, H, cz, x0, H, z0, x1, H, z1); tris.push(cx, 0, cz, x1, 0, z1, x0, 0, z0); }
  const t = new Float32Array(tris); return { tris: t, vcols: new Float32Array(t.length).fill(0.6) };
}
CURVED.boxBoss = boxBoss; CURVED.boxRoundEdge = boxRoundEdge; CURVED.boxRoundEdge24 = () => boxRoundEdge(160, 120, 160, 24);
