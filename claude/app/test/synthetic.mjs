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

