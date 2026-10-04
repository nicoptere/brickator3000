// Profile chains: the sloped skin laid the way a builder lays a curved roof - row by row along the direction the surface falls,
// each row a chain of 1-stud-wide slope / curved / cheese parts chosen together (dynamic programming over the row) rather than one
// at a time by the greedy. Phase 'A-profile' in run.js, option `profiles`; the write-up is docs/CURVES.md.
//
// Why rows: a 2-wide part across a doubly curved surface fails on its cross slope; a 1-wide part fits any row whose profile it
// matches, and the next row fits its own. The greedy, scoring volume alone, mixes yaws and widths and leaves gaps that no part can
// fill; a chain chosen per row has no gaps except where no part matches the profile - there the fill phases lay the step.
// Why before the motifs: the mined assemblies (roof segments, stepped corners) fit a smooth slope well enough by volume and leave
// chaos behind; what the chains take, they cannot.
//
// Per stud cell the surface gradient (Solver.gradients: top surface for the upright parts, underside for the inverted ones) gives
// the facing direction: +x / -x / +z / -z by the dominant component. Rows along x take the cells facing +-x, columns along z the
// others; a part covers only cells of its own facing (or flat ones). Each candidate (part, position) is scored by the solver's
// own evaluate (coverage, overflow, collisions with what is already placed) at the best level near the surface; the DP then picks
// the chain maximising the sum of nets minus `profileSkip` per sloped stud left uncovered. 2-wide parts come back afterwards from
// post.widen, which fuses two identical chain parts side by side into the catalogue's 2-wide version where one exists.
import { G } from './constants.js';
import { Solver } from './solver.js';

const TAN11 = 0.2 / 4 * 0.97;      // 0.0485 plates / sample = tan 11 deg (a plate is 8 LDU, a sample 4)

/** facing per stud cell from a gradient map: 0 none, 1 +x, 2 -x, 3 +z, 4 -z (the sign is the gradient's: 1 = the surface rises towards +x) */
function facing(g, n, minMag = TAN11) {
  const out = new Uint8Array(n);
  for (let q = 0; q < n; q++) {
    const gx = g.gx[q], gz = g.gz[q]; if (Math.hypot(gx, gz) < minMag) continue;
    out[q] = Math.abs(gx) >= Math.abs(gz) ? (gx > 0 ? 1 : 2) : (gz > 0 ? 3 : 4);
  }
  return out;
}

/** the chain parts of one direction: 1-wide variants whose own slope runs along the row and rises the same way */
function chainVariants(variants, along, sign) {
  const out = [];
  for (const v of variants) {
    const s = Solver.slopeOf(v); if (!s) continue;
    if (along === 'x') { if (v.d !== 1 || Math.abs(s[0]) < 3 * Math.abs(s[1]) || Math.sign(s[0]) !== sign) continue; }
    else { if (v.w !== 1 || Math.abs(s[1]) < 3 * Math.abs(s[0]) || Math.sign(s[1]) !== sign) continue; }
    out.push(v);
  }
  return out;
}

/**
 * lay the chains. `variants`: the skin variants (partVariants of slope / curved / cheese / inverted). Returns { rows, pieces }.
 * opts: profileTol (solver tolerance), profileSkip (cost per sloped stud left uncovered), profileMaxLen (studs), profileExt (use the extended parts)
 */
export function placeProfiles(S, variants, o, log = () => {}) {
  const NXc = S.NXc, NZc = S.NZc, NL = S.NL, tol = o.profileTol || o.skinTol, skip = o.profileSkip ?? 0.4, maxLen = o.profileMaxLen ?? 4;
  const g = S.gradients(), F = S.Mfull || S.M0, NX = S.NXs, NZ = S.NZs;
  // top / bottom height per stud cell (plates): the highest / lowest sample column with mass, for the level search window
  const topCell = new Float32Array(NXc * NZc).fill(-1), botCell = new Float32Array(NXc * NZc).fill(-1);
  for (let cz = 0; cz < NZc; cz++) for (let cx = 0; cx < NXc; cx++) {
    let t = -1, bt = 1e9;
    for (let dz = 0; dz < G; dz++) for (let dx = 0; dx < G; dx++) {
      const z = cz * G + dz, x = cx * G + dx;
      for (let l = NL - 1; l >= 0; l--) { const m = F[S.idx(l, z, x)]; if (m > 0.05) { t = Math.max(t, l + m); break; } }
      for (let l = 0; l < NL; l++) { const m = F[S.idx(l, z, x)]; if (m > 0.05) { bt = Math.min(bt, l + 1 - m); break; } }
    }
    topCell[cz * NXc + cx] = t; botCell[cz * NXc + cx] = bt < 1e9 ? bt : -1;
  }
  const usable = variants.filter((v) => (v.w <= maxLen && v.d <= maxLen) && (o.profileExt || !v.c.ext));
  let rows = 0, pieces = 0;
  for (const side of ['top', 'bot']) {
    const inv = side === 'bot', vs = usable.filter((v) => (v.c.kind === 'inverted') === inv); if (!vs.length) continue;
    const face = facing(inv ? g.bot : g.top, NXc * NZc), H = inv ? botCell : topCell;
    for (const along of ['x', 'z']) {
      const n = along === 'x' ? NXc : NZc, m = along === 'x' ? NZc : NXc;
      const cellAt = (r, p) => (along === 'x' ? r * NXc + p : p * NXc + r);        // row r, position p -> cell index
      const lenOf = (v) => (along === 'x' ? v.w : v.d);
      const dirs = along === 'x' ? [[1, 1], [2, -1]] : [[3, 1], [4, -1]];
      for (const [code, sign] of dirs) {
        const cv = chainVariants(vs, along, sign); if (!cv.length) continue;
        for (let r = 0; r < m; r++) {
          // sloped studs of this facing in the row; nothing to do when there are none
          let any = false; for (let p = 0; p < n; p++) if (face[cellAt(r, p)] === code) { any = true; break; }
          if (!any) continue;
          // candidates: for each position and part, the best level near the surface; a part may only cover cells of its facing or flat ones
          const best = new Float64Array(n + 1).fill(Infinity), from = new Array(n + 1).fill(null); best[0] = 0;
          for (let p = 0; p < n; p++) {
            if (best[p] === Infinity) continue;
            const c0 = cellAt(r, p), sk = face[c0] === code ? skip : 0;
            if (best[p] + sk < best[p + 1]) { best[p + 1] = best[p] + sk; from[p + 1] = { p, v: null }; }
            for (const v of cv) {
              const L = lenOf(v); if (p + L > n) continue;
              let ok = true, hmax = -1, hmin = 1e9, sloped = 0;
              for (let q = 0; q < L; q++) { const c = cellAt(r, p + q), f = face[c]; if (f !== 0 && f !== code) { ok = false; break; } if (f === code) sloped++; const h = H[c]; if (h < 0) { ok = false; break; } hmax = Math.max(hmax, h); hmin = Math.min(hmin, h); }
              if (!ok || !sloped) continue;
              const i = along === 'x' ? p : r, j = along === 'x' ? r : p;
              let bb = -1, bn = 0, bo = 0, be = 0;
              const lo = inv ? Math.max(0, Math.floor(hmin) - 1) : Math.max(0, Math.floor(hmin) - v.h), hi = inv ? Math.min(NL - v.h, Math.ceil(hmax)) : Math.min(NL - v.h, Math.ceil(hmax) - 1);
              for (let b = lo; b <= hi; b++) { const e = S.evaluate(v, b, j, i, tol); if (e && e[0] > bn) { bn = e[0]; bb = b; bo = e[1]; be = e[2]; } }
              if (bb < 0) continue;
              const cost = best[p] - bn;
              if (cost < best[p + L]) { best[p + L] = cost; from[p + L] = { p, v, b: bb, i, j, ov: bo, over: be }; }
            }
          }
          // backtrack and place (re-evaluated: the chain's parts never overlap each other, but the level search above saw the field as it was)
          let p = n, placed = 0;
          while (p > 0) { const f = from[p]; if (!f) break; if (f.v) { const e = S.evaluate(f.v, f.b, f.j, f.i, tol); if (e) { S.place(f.v, f.b, f.j, f.i, e[1], e[2], inv ? 'A-profile-inv' : 'A-profile'); placed++; } } p = f.p; }
          if (placed) { rows++; pieces += placed; }
          if (o.profileDebug) { let line = `  ${side} ${along}${sign > 0 ? '+' : '-'} row ${r}: `; let q = n; const segs = []; while (q > 0) { const f = from[q]; if (!f) { segs.push('?'); break; } segs.push(f.v ? `${f.v.c.id}@${f.p}b${f.b}` : (face[cellAt(r, f.p)] === code ? `skip${f.p}` : '.')); q = f.p; } console.log(line + segs.reverse().join(' ')); }
        }
      }
    }
  }
  log(`phase A-profile: ${rows} chains, ${pieces} parts`);
  return { rows, pieces };
}
