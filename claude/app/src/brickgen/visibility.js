// Which surface samples can be seen from outside the model? Used by the colour pass: a sundae glass is a shell with
// ice cream, sauce and fruit *inside* it; those interior surfaces are hidden in any render of the mesh, yet they are
// as close to the LEGO skin as the glass itself, so a plain nearest-sample colour lets them bleed through as stripes.
// A sample counts as visible if, in at least one of 26 orthographic directions (all sign combinations of x/y/z), no
// triangle lies in front of it in a depth buffer rendered from the mesh itself.
const DIRS = [];
for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) if (a || b || c) { const l = Math.hypot(a, b, c); DIRS.push([a / l, b / l, c / l]);
}

/** tris: 9 floats per triangle, pts: 3 floats per sample. Returns Uint8Array (1 = visible from outside). */
export function visibleSamples(tris, pts, { res = 640, tol = 3 } = {}) {
  const n = pts.length / 3, nt = tris.length / 9, vis = new Uint8Array(n);
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], tris[i + c]); hi[c] = Math.max(hi[c], tris[i + c]); }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const px = diag / res, eps = tol * px;                    // pixel size, depth tolerance (world units)
  const W = res + 2, zb = new Float32Array(W * W), P = new Float32Array(nt * 6), Z = new Float32Array(nt * 3);
  const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2, cz = (lo[2] + hi[2]) / 2, half = diag / 2 + px;
  for (const d of DIRS) {
    // orthonormal frame (u, v, d); depth = p . d (larger = nearer to a viewer standing at +d)
    const t = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = [t[1] * d[2] - t[2] * d[1], t[2] * d[0] - t[0] * d[2], t[0] * d[1] - t[1] * d[0]]; const ul = Math.hypot(...u); u = u.map((x) => x / ul);
    const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    const proj = (x, y, z) => { x -= cx; y -= cy; z -= cz; return [((x * u[0] + y * u[1] + z * u[2]) + half) / px, ((x * v[0] + y * v[1] + z * v[2]) + half) / px, x * d[0] + y * d[1] + z * d[2]]; };
    zb.fill(-Infinity);
    for (let t3 = 0; t3 < nt; t3++) {
      const a = proj(tris[t3 * 9], tris[t3 * 9 + 1], tris[t3 * 9 + 2]), b = proj(tris[t3 * 9 + 3], tris[t3 * 9 + 4], tris[t3 * 9 + 5]), c = proj(tris[t3 * 9 + 6], tris[t3 * 9 + 7], tris[t3 * 9 + 8]);
      const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]) - 1)), x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0]) + 1));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]) - 1)), y1 = Math.min(W - 1, Math.ceil(Math.max(a[1], b[1], c[1]) + 1));
      const zmin = Math.min(a[2], b[2], c[2]), zmax = Math.max(a[2], b[2], c[2]);
      if (Math.abs(den) < 1e-12) {                          // edge-on in this view: splat its bbox at the nearest depth so it still occludes
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (zmax > zb[y * W + x]) zb[y * W + x] = zmax;
        continue;
      }
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const X = x + 0.5, Y = y + 0.5;
        const l1 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / den, l2 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / den, l3 = 1 - l1 - l2;
        const m = -0.7 / Math.sqrt(Math.abs(den) + 1);       // conservative: accept pixels whose centre is slightly outside (no pin-holes in thin triangles)
        if (l1 < m - 0.02 || l2 < m - 0.02 || l3 < m - 0.02) continue;
        let z = l1 * a[2] + l2 * b[2] + l3 * c[2]; if (z < zmin) z = zmin; else if (z > zmax) z = zmax;
        if (z > zb[y * W + x]) zb[y * W + x] = z;
      }
    }
    for (let i = 0; i < n; i++) {
      if (vis[i]) continue;
      const p = proj(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]), x = Math.floor(p[0]), y = Math.floor(p[1]);
      if (x < 1 || y < 1 || x >= W - 1 || y >= W - 1) continue;
      // nearest depth in the 3x3 neighbourhood: a sample next to a nearer surface (silhouette) is not counted as seen here
      let zm = -Infinity; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = zb[(y + dy) * W + x + dx]; if (q > zm) zm = q; }
      if (p[2] >= zm - eps) vis[i] = 1;
    }
  }
  return vis;
}
