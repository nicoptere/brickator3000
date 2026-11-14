// Quadric edge-collapse decimation: a typed-array port of Sven Forstmann's
// Fast-Quadric-Mesh-Simplification (MIT), the same algorithm that the Python
// prototype calls through fast_simplification / pyfqmr.

const hyp = (x, y, z = 0) => Math.sqrt(x * x + y * y + z * z);

export function simplify(Vin, Fin, targetCount, { aggressiveness = 7, maxIter = 100, lossless = false, thresholdLossless = 1e-3 } = {}) {
  let T = Fin.length / 3;
  const NV = Vin.length / 3;
  const tv = Int32Array.from(Fin);
  const terr = new Float64Array(4 * T);
  const tdel = new Uint8Array(T), tdirty = new Uint8Array(T);
  const tn = new Float64Array(3 * T);
  const vp = Float64Array.from(Vin);
  const vq = new Float64Array(10 * NV);
  const vts = new Int32Array(NV), vtc = new Int32Array(NV);
  const vb = new Uint8Array(NV);
  let cap = 3 * T + 1024, rtid = new Int32Array(cap), rtv = new Int32Array(cap), nref = 0;
  let del0 = new Uint8Array(64), del1 = new Uint8Array(64);
  const P = new Float64Array(3);

  function pushRef(tid, tvx) {
    if (nref >= cap) {
      cap *= 2;
      const a = new Int32Array(cap); a.set(rtid); rtid = a;
      const b = new Int32Array(cap); b.set(rtv); rtv = b;
    }
    rtid[nref] = tid; rtv[nref] = tvx; nref++;
  }

  // q = q1 + q2 lives in Q
  const Q = new Float64Array(10);
  function det(a11, a12, a13, a21, a22, a23, a31, a32, a33) {
    return Q[a11] * Q[a22] * Q[a33] + Q[a13] * Q[a21] * Q[a32] + Q[a12] * Q[a23] * Q[a31]
         - Q[a13] * Q[a22] * Q[a31] - Q[a11] * Q[a23] * Q[a32] - Q[a12] * Q[a21] * Q[a33];
  }
  function verr(x, y, z) {
    return Q[0] * x * x + 2 * Q[1] * x * y + 2 * Q[2] * x * z + 2 * Q[3] * x + Q[4] * y * y
         + 2 * Q[5] * y * z + 2 * Q[6] * y + Q[7] * z * z + 2 * Q[8] * z + Q[9];
  }
  function calcError(i1, i2) {
    for (let k = 0; k < 10; k++) Q[k] = vq[10 * i1 + k] + vq[10 * i2 + k];
    const border = vb[i1] & vb[i2];
    const d = det(0, 1, 2, 1, 4, 5, 2, 5, 7);
    if (d !== 0 && !border) {
      P[0] = -1 / d * det(1, 2, 3, 4, 5, 6, 5, 7, 8);
      P[1] = 1 / d * det(0, 2, 3, 1, 5, 6, 2, 7, 8);
      P[2] = -1 / d * det(0, 1, 3, 1, 4, 6, 2, 5, 8);
      return verr(P[0], P[1], P[2]);
    }
    const ax = vp[3 * i1], ay = vp[3 * i1 + 1], az = vp[3 * i1 + 2];
    const bx = vp[3 * i2], by = vp[3 * i2 + 1], bz = vp[3 * i2 + 2];
    const cx = (ax + bx) / 2, cy = (ay + by) / 2, cz = (az + bz) / 2;
    const e1 = verr(ax, ay, az), e2 = verr(bx, by, bz), e3 = verr(cx, cy, cz);
    const e = Math.min(e1, e2, e3);
    if (e1 === e) { P[0] = ax; P[1] = ay; P[2] = az; }
    if (e2 === e) { P[0] = bx; P[1] = by; P[2] = bz; }
    if (e3 === e) { P[0] = cx; P[1] = cy; P[2] = cz; }
    return e;
  }

  function flipped(px, py, pz, i0, i1, v0, del) {
    const s0 = vts[v0], c0 = vtc[v0];
    for (let k = 0; k < c0; k++) {
      const t = rtid[s0 + k];
      if (tdel[t]) continue;
      const s = rtv[s0 + k];
      const id1 = tv[3 * t + (s + 1) % 3], id2 = tv[3 * t + (s + 2) % 3];
      if (id1 === i1 || id2 === i1) { del[k] = 1; continue; }
      let d1x = vp[3 * id1] - px, d1y = vp[3 * id1 + 1] - py, d1z = vp[3 * id1 + 2] - pz;
      let l = hyp(d1x, d1y, d1z) || 1; d1x /= l; d1y /= l; d1z /= l;
      let d2x = vp[3 * id2] - px, d2y = vp[3 * id2 + 1] - py, d2z = vp[3 * id2 + 2] - pz;
      l = hyp(d2x, d2y, d2z) || 1; d2x /= l; d2y /= l; d2z /= l;
      if (Math.abs(d1x * d2x + d1y * d2y + d1z * d2z) > 0.999) return true;
      let nx = d1y * d2z - d1z * d2y, ny = d1z * d2x - d1x * d2z, nz = d1x * d2y - d1y * d2x;
      l = hyp(nx, ny, nz) || 1;
      del[k] = 0;
      if ((nx * tn[3 * t] + ny * tn[3 * t + 1] + nz * tn[3 * t + 2]) / l < 0.2) return true;
    }
    return false;
  }

  let deletedTriangles = 0;
  function updateTriangles(i0, v, del) {
    const s0 = vts[v], c0 = vtc[v];
    for (let k = 0; k < c0; k++) {
      const t = rtid[s0 + k], tvx = rtv[s0 + k];
      if (tdel[t]) continue;
      if (del[k]) { tdel[t] = 1; deletedTriangles++; continue; }
      tv[3 * t + tvx] = i0;
      tdirty[t] = 1;
      const a = tv[3 * t], b = tv[3 * t + 1], c = tv[3 * t + 2];
      terr[4 * t] = calcError(a, b);
      terr[4 * t + 1] = calcError(b, c);
      terr[4 * t + 2] = calcError(c, a);
      terr[4 * t + 3] = Math.min(terr[4 * t], terr[4 * t + 1], terr[4 * t + 2]);
      pushRef(t, tvx);
    }
  }

  function updateMesh(iteration) {
    if (iteration > 0) {
      let dst = 0;
      for (let i = 0; i < T; i++) if (!tdel[i]) {
        if (dst !== i) {
          tv[3 * dst] = tv[3 * i]; tv[3 * dst + 1] = tv[3 * i + 1]; tv[3 * dst + 2] = tv[3 * i + 2];
          for (let k = 0; k < 4; k++) terr[4 * dst + k] = terr[4 * i + k];
          tn[3 * dst] = tn[3 * i]; tn[3 * dst + 1] = tn[3 * i + 1]; tn[3 * dst + 2] = tn[3 * i + 2];
          tdirty[dst] = tdirty[i]; tdel[dst] = 0;
        }
        dst++;
      }
      T = dst;
    }
    if (iteration === 0) {
      vq.fill(0);
      for (let i = 0; i < T; i++) {
        const a = 3 * tv[3 * i], b = 3 * tv[3 * i + 1], c = 3 * tv[3 * i + 2];
        const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
        const wx = vp[c] - vp[a], wy = vp[c + 1] - vp[a + 1], wz = vp[c + 2] - vp[a + 2];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const l = hyp(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        tn[3 * i] = nx; tn[3 * i + 1] = ny; tn[3 * i + 2] = nz;
        const d = -(nx * vp[a] + ny * vp[a + 1] + nz * vp[a + 2]);
        const m = [nx * nx, nx * ny, nx * nz, nx * d, ny * ny, ny * nz, ny * d, nz * nz, nz * d, d * d];
        for (let j = 0; j < 3; j++) { const o = 10 * tv[3 * i + j]; for (let k = 0; k < 10; k++) vq[o + k] += m[k]; }
      }
      for (let i = 0; i < T; i++) {
        const a = tv[3 * i], b = tv[3 * i + 1], c = tv[3 * i + 2];
        terr[4 * i] = calcError(a, b); terr[4 * i + 1] = calcError(b, c); terr[4 * i + 2] = calcError(c, a);
        terr[4 * i + 3] = Math.min(terr[4 * i], terr[4 * i + 1], terr[4 * i + 2]);
      }
    }
    vtc.fill(0);
    for (let i = 0; i < 3 * T; i++) vtc[tv[i]]++;
    let ts = 0;
    for (let i = 0; i < NV; i++) { vts[i] = ts; ts += vtc[i]; vtc[i] = 0; }
    if (3 * T > cap) { cap = 3 * T + 1024; rtid = new Int32Array(cap); rtv = new Int32Array(cap); }
    nref = 3 * T;
    for (let i = 0; i < T; i++) for (let j = 0; j < 3; j++) {
      const v = tv[3 * i + j], p = vts[v] + vtc[v];
      rtid[p] = i; rtv[p] = j; vtc[v]++;
    }
    if (iteration === 0) {
      // border: a vertex seen once around a fan of a neighbour
      vb.fill(0);
      const ids = [], cnt = [];
      for (let i = 0; i < NV; i++) {
        ids.length = 0; cnt.length = 0;
        for (let j = 0; j < vtc[i]; j++) {
          const t = rtid[vts[i] + j];
          for (let k = 0; k < 3; k++) {
            const id = tv[3 * t + k];
            let o = 0;
            while (o < ids.length && ids[o] !== id) o++;
            if (o === ids.length) { ids.push(id); cnt.push(1); } else cnt[o]++;
          }
        }
        for (let j = 0; j < ids.length; j++) if (cnt[j] === 1) vb[ids[j]] = 1;
      }
    }
  }

  const triangleCount = T;
  for (let iteration = 0; iteration < maxIter; iteration++) {
    if (!lossless && triangleCount - deletedTriangles <= targetCount) break;
    if (lossless || iteration % 5 === 0) updateMesh(iteration);
    tdirty.fill(0, 0, T);
    const threshold = lossless ? thresholdLossless : 1e-9 * Math.pow(iteration + 3, aggressiveness);
    let collapsed = 0;
    for (let i = 0; i < T; i++) {
      if (terr[4 * i + 3] > threshold || tdel[i] || tdirty[i]) continue;
      for (let j = 0; j < 3; j++) {
        if (terr[4 * i + j] >= threshold) continue;
        const i0 = tv[3 * i + j], i1 = tv[3 * i + (j + 1) % 3];
        if (vb[i0] !== vb[i1]) continue;
        calcError(i0, i1);
        const px = P[0], py = P[1], pz = P[2];
        if (vtc[i0] > del0.length) del0 = new Uint8Array(2 * vtc[i0]);
        if (vtc[i1] > del1.length) del1 = new Uint8Array(2 * vtc[i1]);
        del0.fill(0, 0, vtc[i0]); del1.fill(0, 0, vtc[i1]);
        if (flipped(px, py, pz, i0, i1, i0, del0)) continue;
        if (flipped(px, py, pz, i1, i0, i1, del1)) continue;
        vp[3 * i0] = px; vp[3 * i0 + 1] = py; vp[3 * i0 + 2] = pz;
        for (let k = 0; k < 10; k++) vq[10 * i0 + k] += vq[10 * i1 + k];
        const tstart = nref;
        updateTriangles(i0, i0, del0);
        updateTriangles(i0, i1, del1);
        const tcount = nref - tstart;
        if (tcount <= vtc[i0]) {
          if (tcount) { rtid.copyWithin(vts[i0], tstart, tstart + tcount); rtv.copyWithin(vts[i0], tstart, tstart + tcount); }
        } else vts[i0] = tstart;
        vtc[i0] = tcount;
        collapsed++;
        break;
      }
      if (!lossless && triangleCount - deletedTriangles <= targetCount) break;
    }
    if (lossless && collapsed === 0) break;
  }

  // compact
  const keepV = new Int32Array(NV).fill(-1);
  let mo = 0;
  for (let i = 0; i < T; i++) if (!tdel[i]) mo++;
  const Fo = new Int32Array(3 * mo);
  let nvo = 0, k = 0;
  for (let i = 0; i < T; i++) if (!tdel[i]) {
    for (let j = 0; j < 3; j++) {
      const v = tv[3 * i + j];
      if (keepV[v] < 0) keepV[v] = nvo++;
      Fo[3 * k + j] = keepV[v];
    }
    k++;
  }
  const Vo = new Float64Array(3 * nvo);
  for (let i = 0; i < NV; i++) if (keepV[i] >= 0) {
    const o = 3 * keepV[i];
    Vo[o] = vp[3 * i]; Vo[o + 1] = vp[3 * i + 1]; Vo[o + 2] = vp[3 * i + 2];
  }
  return { V: Vo, F: Fo };
}
