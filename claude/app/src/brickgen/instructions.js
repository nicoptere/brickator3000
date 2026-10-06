// The build booklet: a model -> steps -> a printable instruction leaflet.
//
// What real LEGO instructions do, and what is copied here (bricknerd.com's survey of 1988 vs 2022 booklets, and the LDraw
// community's own conventions):
//  - the build is LAYERED, rising at the same rate from bottom to top. A voxel model already is, so the steps follow the levels;
//  - every step carries a step inventory call-out - the parts that step adds, with their count (introduced in 2003 sets);
//  - the parts a step adds are drawn in their own colour and everything already built is drawn in a medium grey, so the eye
//    goes straight to what is new (modern sets colour the new parts and leave the rest as is; on a sculpture whose every
//    piece has its own shade the grey is what makes the new layer readable);
//  - the camera never turns: every picture is the same isometric view (orthographic, no perspective), framed on the pieces
//    the step adds with a little context around them - what a builder actually looks at;
//  - official sets place 1-4 pieces per step, which for a 1,300-piece sculpture would be 400 pages. The step size here is chosen
//    from a TARGET STEP COUNT instead (default 60) and clamped, so the leaflet stays a leaflet; the colour-vs-grey contrast and
//    the per-step inventory are what keep a 20-piece step followable.
// A step never spans more than `maxLevels` levels, and the pieces inside one step are taken in a serpentine order across the
// layer, so a step is always a contiguous run rather than a scatter. Pages are A4 landscape, four steps to a page.
// A sideways piece is built with (after) the host it hangs on, not at its own level (`buildLevels`).
const KIND_LABEL = { plate: 'plate', brick: 'brick', tile: 'tile', slope: 'slope', inverted: 'inverted slope', curved: 'curved slope', cheese: 'cheese slope', round: 'round', technic: 'technic', shaped: 'shaped', support: 'support' };
const hex = (rgb) => '#' + (rgb || [200, 200, 200]).map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
const shade = (rgb, f) => hex((rgb || [200, 200, 200]).map((x) => x * f));

/**
 * The level a piece is BUILT at. An upright piece: its own level. A sideways piece (the SNOT skin, a sideways motif part)
 * hangs on a side stud of its host and may start below the host's bottom (a 1x2 tile standing on a 22885's lower stud
 * reaches 10 LDU under the brick): ordered by its own level it would be placed before anything holds it and float in the
 * picture. The host and its sideways pieces share a rigid-assembly id `mi`, so a sideways piece is built at the level of the
 * highest upright piece of its assembly at the earliest, and after the upright pieces of that level.
 */
export function buildLevels(pieces) {
  const hostLevel = new Map();
  for (const p of pieces) if (p.mi != null && !p.snot) hostLevel.set(p.mi, Math.max(hostLevel.get(p.mi) ?? -Infinity, p.b));
  return pieces.map((p) => (p.snot && p.mi != null && hostLevel.has(p.mi) ? Math.max(p.b, hostLevel.get(p.mi)) : p.b));
}

/** pieces in build order: by build level, upright before sideways, then serpentine across the layer (so one step is a contiguous run, not a scatter) */
export function buildOrder(pieces, levels = buildLevels(pieces)) {
  return pieces.map((p, n) => n).sort((a, b) => {
    const p = pieces[a], q = pieces[b];
    if (levels[a] !== levels[b]) return levels[a] - levels[b];
    if (!!p.snot !== !!q.snot) return p.snot ? 1 : -1;              // the host first, what hangs on it after
    if (p.j !== q.j) return p.j - q.j;
    return (p.j % 2 ? -1 : 1) * (p.i - q.i);                       // serpentine: alternate rows run the other way
  });
}

/**
 * Partition a model into meaningful structural islands (subassemblies) such as ground stems/legs,
 * lower body / pelvis, appendages / wings, tail / rear, mid/upper torso, and crown / head.
 * Guarantees that foundation/support islands precede dependent islands so no pieces float during assembly.
 */
export function sliceIslands(pieces) {
  if (!pieces || pieces.length === 0) return { islands: [], pieceToIsland: [] };

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const p of pieces) {
    minX = Math.min(minX, p.i);
    maxX = Math.max(maxX, p.i + (p.w ?? 1) - 1);
    minY = Math.min(minY, p.b);
    maxY = Math.max(maxY, p.b + (p.h ?? 1) - 1);
    minZ = Math.min(minZ, p.j);
    maxZ = Math.max(maxZ, p.j + (p.d ?? 1) - 1);
  }

  const spanX = maxX - minX + 1;
  const spanY = maxY - minY + 1;
  const spanZ = maxZ - minZ + 1;
  const cenX = (minX + maxX) / 2;
  const cenZ = (minZ + maxZ) / 2;

  // Single island fallback for small or flat builds
  if (pieces.length < 30 || spanY < 6) {
    return {
      islands: [{ id: 0, name: 'Main Assembly', rank: 0, pieces: pieces.map((_, i) => i) }],
      pieceToIsland: new Array(pieces.length).fill(0)
    };
  }

  const getIsland = (p) => {
    const pw = p.w ?? 1, pd = p.d ?? 1;
    const px = p.i + pw / 2;
    const py = p.b;

    // Ground stems (legs / base)
    if (py <= minY + spanY * 0.18) {
      if (px < cenX - 1.2) return { id: 0, name: 'Left Foot & Leg', rank: 0 };
      if (px > cenX + 1.2) return { id: 1, name: 'Right Foot & Leg', rank: 1 };
      return { id: 0, name: 'Left Foot & Leg', rank: 0 };
    }

    // Appendages / Wings / Lateral arms
    if (spanX >= 10 && py <= minY + spanY * 0.68 && py >= minY + spanY * 0.20) {
      if (p.i + pw <= minX + spanX * 0.26) return { id: 3, name: 'Left Wing', rank: 5 };
      if (p.i >= maxX - spanX * 0.26) return { id: 4, name: 'Right Wing', rank: 6 };
    }

    // Tail / Rear protrusion
    if (spanZ >= 8 && py <= minY + spanY * 0.45 && p.j + pd <= minZ + spanZ * 0.26) {
      return { id: 2, name: 'Tail', rank: 3 };
    }

    // Head & Beak / Crown
    if (py >= minY + spanY * 0.68) {
      return { id: 7, name: 'Head & Beak', rank: 7 };
    }

    // Body: Lower vs Mid/Upper
    if (py <= minY + spanY * 0.42) {
      return { id: 5, name: 'Pelvis & Lower Torso', rank: 2 };
    }
    return { id: 6, name: 'Mid & Upper Torso', rank: 4 };
  };

  const islandMap = new Map();
  const pieceToIsland = new Array(pieces.length);

  for (let i = 0; i < pieces.length; i++) {
    const info = getIsland(pieces[i]);
    if (!islandMap.has(info.id)) {
      islandMap.set(info.id, { id: info.id, name: info.name, rank: info.rank, pieces: [] });
    }
    islandMap.get(info.id).pieces.push(i);
    pieceToIsland[i] = info.id;
  }

  const islands = [...islandMap.values()].sort((a, b) => a.rank - b.rank);
  return { islands, pieceToIsland };
}

function overlap2D(p, q) {
  const pw = p.w ?? 1, pd = p.d ?? 1;
  const qw = q.w ?? 1, qd = q.d ?? 1;
  return Math.max(p.i, q.i) < Math.min(p.i + pw, q.i + qw) &&
         Math.max(p.j, q.j) < Math.min(p.j + pd, q.j + qd);
}

function sharesVerticalFace(p, q) {
  const ph = p.h ?? 1, qh = q.h ?? 1;
  const yOver = Math.max(p.b, q.b) < Math.min(p.b + ph, q.b + qh);
  if (!yOver) return false;
  const pw = p.w ?? 1, pd = p.d ?? 1;
  const qw = q.w ?? 1, qd = q.d ?? 1;
  const xTouch = (p.i + pw === q.i || q.i + qw === p.i) && Math.max(p.j, q.j) < Math.min(p.j + pd, q.j + qd);
  const zTouch = (p.j + pd === q.j || q.j + qd === p.j) && Math.max(p.i, q.i) < Math.min(p.i + pw, q.i + qw);
  return xTouch || zTouch;
}

/**
 * Builds the physical support directed acyclic graph (DAG) rooted at the ground pieces.
 * Guarantees zero floating pieces by ensuring every piece's prerequisite support is built first.
 */
export function buildSupportDAG(pieces) {
  const N = pieces.length;
  if (N <= 1) return { parent: new Int32Array(N).fill(-1), dag: Array.from({ length: N }, () => []), inDegree: new Int32Array(N), minB: pieces[0]?.b ?? 0 };

  const adj = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) {
    const pi = pieces[i], pih = pi.h ?? 1;
    for (let j = i + 1; j < N; j++) {
      const pj = pieces[j], pjh = pj.h ?? 1;
      const iOnJ = (pi.b === pj.b + pjh && overlap2D(pi, pj));
      const jOnI = (pj.b === pi.b + pih && overlap2D(pi, pj));
      const lateral = sharesVerticalFace(pi, pj);
      const snot = (pi.mi != null && pi.mi === pj.mi);

      if (iOnJ) {
        adj[j].push({ to: i, weight: 1.0 });
        adj[i].push({ to: j, weight: 4.0 });
      } else if (jOnI) {
        adj[i].push({ to: j, weight: 1.0 });
        adj[j].push({ to: i, weight: 4.0 });
      } else if (lateral || snot) {
        adj[i].push({ to: j, weight: 2.0 });
        adj[j].push({ to: i, weight: 2.0 });
      }
    }
  }

  const minB = Math.min(...pieces.map((p) => p.b));
  const dist = new Float64Array(N).fill(Infinity);
  const parent = new Int32Array(N).fill(-1);

  for (let i = 0; i < N; i++) {
    if (pieces[i].b === minB) dist[i] = 0;
  }

  const visited = new Set();
  while (visited.size < N) {
    let u = -1, minDist = Infinity;
    for (let i = 0; i < N; i++) {
      if (!visited.has(i) && dist[i] < minDist) {
        minDist = dist[i]; u = i;
      }
    }
    if (u === -1) break;
    visited.add(u);

    for (const edge of adj[u]) {
      const v = edge.to;
      if (visited.has(v)) continue;
      const hCost = Math.max(0, pieces[v].b - pieces[u].b) * 1.5;
      const d = dist[u] + edge.weight + hCost;
      if (d < dist[v]) {
        dist[v] = d; parent[v] = u;
      }
    }
  }

  // Fallback for any unreachable components
  for (let i = 0; i < N; i++) {
    if (dist[i] === Infinity) dist[i] = (pieces[i].b - minB) * 10;
  }

  const inDegree = new Int32Array(N);
  const dag = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) {
    if (pieces[i].b === minB) continue;
    const p = parent[i];
    if (p !== -1) {
      dag[p].push(i);
      inDegree[i]++;
    }
  }

  return { parent, dag, inDegree, minB };
}

/**
 * Steps: runs of the build order planned using a physical support DAG and sticky step clustering.
 * Guarantees:
 *  1. Zero floating pieces: every piece's physical support is placed in prior steps or earlier in the same step.
 *  2. Cohesion ("always stick together"): pieces within a step physically touch each other and the existing build.
 *  3. Structural island grouping: steps stay within cohesive subassemblies (legs, pelvis, torso, wings, tail, head).
 * Returns [{ idx, levels: [lo, hi], island, islandName }].
 */
export function planSteps(pieces, o = {}) {
  const N = pieces.length;
  if (N === 0) return { steps: [], perStep: 1, order: [], islands: [] };
  if (N === 1) return { steps: [{ idx: [0], levels: [pieces[0].b, pieces[0].b + (pieces[0].h ?? 1)], island: 0, islandName: 'Main Model' }], perStep: 1, order: [0], islands: [] };

  const target = o.stepTarget ?? 60, maxLevels = o.stepLevels ?? 2;
  const perStep = Math.max(o.stepMin ?? 3, Math.min(o.stepMax ?? 40, Math.ceil(N / Math.max(1, target))));
  const useIslands = o.useIslands ?? true;

  const { islands, pieceToIsland } = sliceIslands(pieces);
  const { dag, inDegree } = buildSupportDAG(pieces);

  const readySet = new Set();
  for (let i = 0; i < N; i++) {
    if (inDegree[i] === 0) readySet.add(i);
  }

  const steps = [];
  const fullOrder = [];

  while (readySet.size > 0) {
    const readyArr = [...readySet];
    readyArr.sort((a, b) => {
      if (useIslands) {
        const islA = islands.findIndex((x) => x.id === pieceToIsland[a]);
        const islB = islands.findIndex((x) => x.id === pieceToIsland[b]);
        if (islA !== islB) return islA - islB;
      }
      if (pieces[a].b !== pieces[b].b) return pieces[a].b - pieces[b].b;
      if (pieces[a].j !== pieces[b].j) return pieces[a].j - pieces[b].j;
      return (pieces[a].j % 2 ? -1 : 1) * (pieces[a].i - pieces[b].i);
    });

    const seed = readyArr[0];
    const seedIsl = pieceToIsland[seed];
    const step = [seed];
    readySet.delete(seed);

    for (const child of dag[seed]) {
      inDegree[child]--;
      if (inDegree[child] === 0) readySet.add(child);
    }

    while (step.length < perStep && readySet.size > 0) {
      let best = -1, bestScore = Infinity;
      for (const cand of readySet) {
        const pc = pieces[cand];
        if (Math.abs(pc.b - pieces[seed].b) > maxLevels) continue;

        const sameIsl = !useIslands || (pieceToIsland[cand] === seedIsl);
        let touchesStep = false, minDist = Infinity;
        for (const s of step) {
          const ps = pieces[s];
          const touch = (pc.b === ps.b + (ps.h ?? 1) || ps.b === pc.b + (pc.h ?? 1)) && overlap2D(pc, ps) ||
                        sharesVerticalFace(pc, ps) || (pc.mi != null && pc.mi === ps.mi);
          if (touch) { touchesStep = true; minDist = 0; break; }
          const d = Math.hypot(pc.i - ps.i, pc.j - ps.j);
          if (d < minDist) minDist = d;
        }

        const levelDiff = Math.abs(pc.b - pieces[seed].b);
        const islPenalty = sameIsl ? 0 : 250;
        const score = islPenalty + (touchesStep ? 0 : 40) + levelDiff * 10 + minDist;
        if (score < bestScore) {
          bestScore = score; best = cand;
        }
      }

      if (best === -1 || bestScore > 90) break;

      step.push(best);
      readySet.delete(best);
      for (const child of dag[best]) {
        inDegree[child]--;
        if (inDegree[child] === 0) readySet.add(child);
      }
    }

    const islObj = islands.find((x) => x.id === seedIsl);
    const lo = Math.min(...step.map((idx) => pieces[idx].b));
    const hi = Math.max(...step.map((idx) => pieces[idx].b + (pieces[idx].h ?? 1)));
    steps.push({ idx: step, levels: [lo, hi], island: seedIsl, islandName: islObj ? islObj.name : 'Module' });
    for (const idx of step) fullOrder.push(idx);
  }

  // Camera view optimization: ensure newly added pieces face the camera with minimal occlusion
  const CANDIDATES = [
    { name: 'Front-Right', dir: [1, 1, 1], angle: 0 },
    { name: 'Front-Left', dir: [-1, 1, 1], angle: 90 },
    { name: 'Back-Left', dir: [-1, 1, -1], angle: 180 },
    { name: 'Back-Right', dir: [1, 1, -1], angle: 270 }
  ];

  function projectPiece(p, dir) {
    const dLen = Math.hypot(dir[0], dir[1], dir[2]);
    const dx = dir[0] / dLen, dy = dir[1] / dLen, dz = dir[2] / dLen;
    const cxLen = Math.hypot(dz, -dx);
    const cx = dz / cxLen, cy = 0, cz = -dx / cxLen;
    const cyX = dy * cz - dz * cy;
    const cyY = dz * cx - dx * cz;
    const cyZ = dx * cy - dy * cx;
    const pw = p.w ?? 1, ph = p.h ?? 1, pd = p.d ?? 1;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, depth0 = Infinity, depth1 = -Infinity;
    for (const x of [p.i, p.i + pw]) {
      for (const y of [p.b, p.b + ph]) {
        for (const z of [p.j, p.j + pd]) {
          const u = x * cx + y * cy + z * cz;
          const v = x * cyX + y * cyY + z * cyZ;
          const depth = x * dx + y * dy + z * dz;
          if (u < u0) u0 = u; if (u > u1) u1 = u;
          if (v < v0) v0 = v; if (v > v1) v1 = v;
          if (depth < depth0) depth0 = depth; if (depth > depth1) depth1 = depth;
        }
      }
    }
    return { u0, u1, v0, v1, depth0, depth1 };
  }

  function occlusionScore(newIdxs, builtIdxs, dir) {
    let occ = 0;
    for (const n of newIdxs) {
      const pn = projectPiece(pieces[n], dir);
      for (const b of builtIdxs) {
        const pb = projectPiece(pieces[b], dir);
        if (pb.depth0 > pn.depth1) {
          const ovU = Math.max(0, Math.min(pn.u1, pb.u1) - Math.max(pn.u0, pb.u0));
          const ovV = Math.max(0, Math.min(pn.v1, pb.v1) - Math.max(pn.v0, pb.v0));
          occ += ovU * ovV;
        }
      }
    }
    return occ;
  }

  const builtIdxs = [];
  let curCand = CANDIDATES[0];

  for (let k = 0; k < steps.length; k++) {
    const curOcc = occlusionScore(steps[k].idx, builtIdxs, curCand.dir);
    let best = curCand;
    let bestOcc = curOcc;

    if (curOcc > 0.05) {
      for (const cand of CANDIDATES) {
        if (cand === curCand) continue;
        const occ = occlusionScore(steps[k].idx, builtIdxs, cand.dir);
        if (occ < bestOcc * 0.5) {
          bestOcc = occ;
          best = cand;
        }
      }
    }

    const rotated = (best !== curCand && k > 0);
    steps[k].view = { dir: best.dir, name: best.name, angle: best.angle, rotated };
    curCand = best;
    for (const idx of steps[k].idx) builtIdxs.push(idx);
  }

  return { steps, perStep, order: fullOrder, islands };
}

/**
 * The parts a step adds, aggregated by PART ("2x4 plate x 4"), each with the colours it comes in (most used first) - the icon
 * takes the main colour and the swatches say when there is more than one: [{ id, name, kind, w, d, h, rgb, n, colours }]
 */
export function stepParts(pieces, idx, by) {
  return aggregate(idx.map((n) => pieces[n]), by);
}
/** the whole model's bill of materials, grouped the same way */
export function billOfMaterials(pieces, by) {
  return aggregate(pieces, by);
}
function aggregate(list, by) {
  const m = new Map();
  for (const p of list) {
    let e = m.get(p.id);
    if (!e) m.set(p.id, e = { id: p.id, name: (by[p.id] && by[p.id].name) || p.id, kind: p.kind, w: p.w, d: p.d, h: p.h, n: 0, cols: new Map() });
    e.n++; const k = hex(p.rgb); const c = e.cols.get(k) || { n: 0, rgb: p.rgb }; c.n++; e.cols.set(k, c);
  }
  return [...m.values()].map((e) => {
    const colours = [...e.cols.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, c]) => [k, c.n]);
    const rgb = e.cols.get(colours[0][0]).rgb;
    delete e.cols; return { ...e, rgb, colours };
  }).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
}

/**
 * A small isometric icon of a part: footprint w x d, height h plates, studs on top unless it is a tile or a slope. The two
 * faces drawn are the ones that FACE the viewer (x = w on the right, z = d on the left) - the first version drew the far
 * x = 0 wall instead, which made every icon look like an open box seen from inside. Slopes are drawn as wedges.
 */
export function partIcon(part, px = 34) {
  const { w, d, h, kind } = part, S = 7, PL = 2.6, H = h * PL;
  const wedge = kind === 'slope' || kind === 'cheese' || kind === 'curved', studs = !wedge && kind !== 'tile';
  const cx = (x, z) => (x - z) * S * 0.866, cy = (x, z, y) => (x + z) * S * 0.5 - y;      // isometric: +x to the right, +z to the left, y up
  const c = hex(part.rgb), dark = shade(part.rgb, 0.6), mid = shade(part.rgb, 0.8), ink = '#1a1a1a';
  const P = (pts) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const pt = (x, z, y) => [cx(x, z), cy(x, z, y)];
  const lip = wedge ? Math.min(H, PL * 0.7) : H;                                 // a wedge: full height at the back edge, a lip at the front
  const top = [pt(0, 0, H), pt(w, 0, H), pt(w, d, lip), pt(0, d, lip)];
  const right = [pt(w, 0, H), pt(w, d, lip), pt(w, d, 0), pt(w, 0, 0)];
  const front = [pt(0, d, lip), pt(w, d, lip), pt(w, d, 0), pt(0, d, 0)];
  const st = `stroke="${ink}" stroke-width="0.6" stroke-linejoin="round"`;
  let g = `<polygon points="${P(front)}" fill="${dark}" ${st}/><polygon points="${P(right)}" fill="${mid}" ${st}/><polygon points="${P(top)}" fill="${c}" ${st}/>`;
  if (studs) for (let a = 0; a < w; a++) for (let b = 0; b < d; b++)
    g += `<ellipse cx="${cx(a + 0.5, b + 0.5).toFixed(1)}" cy="${cy(a + 0.5, b + 0.5, H + 1.3).toFixed(1)}" rx="${(S * 0.36).toFixed(1)}" ry="${(S * 0.2).toFixed(1)}" fill="${c}" ${st}/>`;
  const all = [...top, ...right, ...front], xs = all.map((q) => q[0]), ys = all.map((q) => q[1]);
  const x0 = Math.min(...xs) - 2, y0 = Math.min(...ys) - 4, vw = Math.max(...xs) - x0 + 2, vh = Math.max(...ys) - y0 + 2;
  return `<svg class="ic" viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}" width="${px}" height="${Math.round(px * vh / vw)}" aria-hidden="true">${g}</svg>`;
}

/** a faint pattern of brick outlines for the cover, the way the real leaflets have it */
function brickPattern() {
  const b = (x, y, w, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="#9aa0a8" stroke-width="1.2" stroke-opacity=".35">` +
    `<path d="M0 16 L${w * 16} 16 L${w * 16 + 10} 8 L10 8 Z M0 16 v18 h${w * 16} v-18 M${w * 16} 34 l10 -8 v-18"/>` +
    [...Array(w)].map((_, k) => `<ellipse cx="${k * 16 + 12}" cy="8" rx="4.5" ry="2.2"/>`).join('') + `</g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="260" viewBox="0 0 420 260">${b(20, 30, 2, 1.4)}${b(150, 120, 4, 1.1)}${b(300, 40, 1, 1.6)}${b(60, 190, 3, 0.9)}${b(330, 170, 2, 1.2)}${b(230, 10, 1, 1)}</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
/** a stable five-digit "set number" from the title and size, so the same model always gets the same one */
const setNumber = (title, n) => { let h = 7; for (const ch of `${title}:${n}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return 10000 + (h % 90000); };

/**
 * The booklet, as one self-contained HTML file: cover, the steps (four to a page: number, parts call-out, picture), and the
 * parts list. `images[k]` is a data URI for step k (the model built up to and including that step, the new pieces in colour
 * and the rest grey, isometric); `cover` one for the title page. Print CSS is set up for A4 landscape, so the browser's
 * "Save as PDF" produces the leaflet directly. The cover is laid out like a real set's: logo tile, the model's name as the
 * theme, the set number, the finished model on a pale band, the booklet number, the warning box.
 */
export function bookletHTML({ title = 'model', cover = null, covers = null, coverPortrait = false, final = null, finals = null, steps = [], images = [], bom = [], meta = {}, perPage = 4, brand = 'LOGO' }) {
  const hero = cover || (covers && covers[0]) || null;                 // the cover is ONE picture, as large as the page allows
  // the last page of the build is the finished model, from a couple of angles (quick renders, not the cover's long one)
  const done = (finals && finals.length ? finals : [final || (covers && covers[covers.length - 1])]).filter(Boolean);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const pages = []; for (let k = 0; k < steps.length; k += perPage) pages.push(steps.slice(k, k + perPage).map((s, q) => ({ s, n: k + q })));
  const swatches = (p) => p.colours && p.colours.length > 1 ? `<span class="sw">${p.colours.slice(0, 8).map(([c]) => `<em style="background:${c}"></em>`).join('')}</span>` : '';
  const rotBadge = (v) => (v && v.rotated ? `<span class="rot-badge" title="Model rotated to view new parts"><svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-1px;margin-right:2px"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>${esc(v.name)}</span>` : '');
  const stepCard = ({ s, n }) => `<figure class="step">
      <div class="head"><span class="num">${n + 1}</span>
        ${s.islandName ? `<span class="isl-badge">${esc(s.islandName)}</span>` : ''}
        ${rotBadge(s.view)}
        <div class="inv">${s.parts.map((p) => `<span class="pi" title="${esc(p.name)}">${partIcon(p, 30)}<b>${p.n}&times;</b>${swatches(p)}</span>`).join('')}</div></div>
      <div class="shot">${images[n] ? `<img src="${images[n]}" alt="step ${n + 1}">` : '<div class="miss">no image</div>'}</div>
    </figure>`;
  const bomRow = (p) => `<li>${partIcon(p, 30)}<span class="bn">${esc(p.name)}${p.colours && p.colours.length > 1 ? `<i> &middot; ${p.colours.length} colours</i>` : ''}</span>` +
    `<span class="sw">${(p.colours || []).slice(0, 6).map(([c]) => `<em style="background:${c}"></em>`).join('')}</span><b>${p.n}&times;</b></li>`;
  const name = title.replace(/[_-]+/g, ' ').trim() || 'model';
  const setNo = meta.setNumber || setNumber(name, meta.pieces || 0);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(name)} - building instructions</title>
<style>
  :root { --ink: #16181d; --ink2: #6b7280; --line: #d9dbe0; --soft: #f4f5f7; --red: #d7141a; --yellow: #f8e71c; --band: #f3f0d6; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif; color: var(--ink); background: #e9eaee; }
  .sheet { width: 297mm; height: 210mm; margin: 8mm auto; padding: 10mm; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.18); position: relative; overflow: hidden; }
  .bar { position: sticky; top: 0; z-index: 9; background: #16181d; color: #fff; padding: 8px 14px; display: flex; gap: 14px; align-items: center; font-size: 12px; }
  .bar button { font: inherit; padding: 4px 12px; border: 0; border-radius: 4px; background: #fff; color: #16181d; cursor: pointer; font-weight: 600; }
  /* ---- cover: the title block and the facts above, then one picture filling everything that is left */
  .cover { padding: 8mm 10mm 7mm; background: var(--band) url("${brickPattern()}") repeat; display: flex; flex-direction: column; gap: 3mm; }
  .cover.portrait { width: 210mm; height: 297mm; }
  .cover .top { display: flex; align-items: center; gap: 7mm; height: 26mm; flex: none; }
  .logo { width: 24mm; height: 24mm; background: var(--red); border-radius: 2.5mm; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 0 0 1.4mm #fff, inset 0 0 0 2.2mm var(--red); flex: none; }
  .logo span { font: 900 7.8mm/1 "Arial Black", "Helvetica Neue", Arial, sans-serif; letter-spacing: -.02em; color: #fff; -webkit-text-stroke: .55mm #000; paint-order: stroke fill; text-shadow: 0 0 0 var(--yellow), 0 0 1.2mm var(--yellow); }
  .theme { font: 900 15mm/1 "Arial Black", "Helvetica Neue", Arial, sans-serif; letter-spacing: -.03em; text-transform: uppercase; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cover.portrait .theme { font-size: 11mm; }
  .theme i { font-style: normal; color: var(--red); }
  .setno { font: 700 6.5mm/1 "Helvetica Neue", Arial, sans-serif; margin-left: auto; align-self: flex-end; padding-bottom: 1mm; }
  /* one picture, centred, as large as the space under the title block allows (it is transparent: the band shows through) */
  .hero { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
  .hero img { width: 100%; height: 100%; object-fit: contain; }
  .cover .cbar { display: flex; align-items: center; gap: 5mm; flex: none; }
  .book { width: 13mm; height: 13mm; background: #fff; border: .5mm solid #888; display: flex; align-items: center; justify-content: center; font: 900 8mm/1 Arial, sans-serif; flex: none; }
  .warn { border: .5mm solid #111; background: #fff; padding: 1.6mm 3mm; font-size: 11px; line-height: 1.25; }
  .warn b { font-weight: 800; }
  .facts { margin-left: auto; display: flex; gap: 6mm; background: #fff; border: .4mm solid #111; padding: 1.6mm 3mm; }
  .facts div { text-align: center; }
  .facts div b { display: block; font-size: 15px; line-height: 1.1; }
  .facts div span { color: var(--ink2); font-size: 9px; letter-spacing: .06em; text-transform: uppercase; }
  /* ---- steps */
  .grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 4mm 8mm; height: 100%; }
  .step { margin: 0; display: flex; flex-direction: column; min-height: 0; break-inside: avoid; }
  .head { display: flex; align-items: flex-start; gap: 3mm; min-height: 15mm; flex-wrap: wrap; }
  .num { font: 900 9mm/1 "Arial Black", "Helvetica Neue", Arial, sans-serif; color: #111; padding-top: 1mm; min-width: 12mm; }
  .isl-badge { font-size: 8px; font-weight: 700; color: #2563eb; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 3px; padding: 1.5px 5px; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; margin-top: 2mm; }
  .rot-badge { font-size: 8px; font-weight: 700; color: #2563eb; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 3px; padding: 1.5px 5px; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; margin-top: 2mm; display: inline-flex; align-items: center; }
  .inv { display: flex; flex-wrap: wrap; gap: 2px 9px; align-items: center; padding: 1.5mm 2.5mm; border: .4mm solid #111; border-radius: 1.5mm; background: #fff; max-width: 100%; }
  .pi { display: inline-flex; align-items: center; gap: 3px; }
  .pi b { font-size: 13px; }
  .ic { vertical-align: middle; }
  .shot { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; background: #fff; }
  .shot img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
  .miss { color: var(--ink2); }
  .foot { position: absolute; left: 10mm; right: 10mm; bottom: 4mm; color: var(--ink2); font-size: 9px; display: flex; justify-content: space-between; }
  .legend { color: var(--ink2); }
  .legend em { display: inline-block; width: 9px; height: 9px; border-radius: 2px; vertical-align: -1px; margin: 0 2px 0 6px; }
  /* ---- the finished model (last page of the build) */
  .done { display: flex; flex-direction: column; align-items: center; }
  .done .big { flex: 1; min-height: 0; width: 100%; display: flex; align-items: center; justify-content: center; gap: 6mm; }
  .done .big img { max-height: 100%; max-width: ${(100 / Math.max(1, done.length) - 2).toFixed(0)}%; object-fit: contain; }
  .done .cap { display: flex; align-items: flex-end; gap: 6mm; width: 100%; padding-top: 3mm; }
  .done h1 { font: 900 11mm/1 "Arial Black", "Helvetica Neue", Arial, sans-serif; letter-spacing: -.03em; text-transform: uppercase; margin: 0; }
  .done h1 i { font-style: normal; color: var(--red); }
  .done .cap p { margin: 1.5mm 0 0; color: var(--ink2); font-size: 11px; }
  /* ---- parts list */
  h2 { font-size: 13px; margin: 0 0 6px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .bom { list-style: none; padding: 0; margin: 0; columns: 3; column-gap: 8mm; }
  .bom li { display: flex; align-items: center; gap: 7px; padding: 2px 0; break-inside: avoid; border-bottom: 1px solid var(--soft); }
  .bn { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--ink2); }
  .bn i { font-style: normal; opacity: .65; }
  .sw { display: inline-flex; gap: 1px; flex: none; }
  .sw em { width: 6px; height: 10px; border-radius: 1px; display: block; border: 1px solid rgba(0,0,0,.15); }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .sheet { width: 277mm; height: 190mm; margin: 0; padding: 0; box-shadow: none; break-after: page; overflow: visible; }
    .cover { width: 297mm; height: 210mm; margin: -10mm; padding: 14mm 18mm 13mm; }
    .cover.portrait { width: 210mm; height: 297mm; page: coverpage; }
    @page coverpage { size: A4 portrait; margin: 10mm; }
    .foot { bottom: -6mm; left: 0; right: 0; }
    .sheet:last-child { break-after: auto; }
    @page { size: A4 landscape; margin: 10mm; }
  }
</style></head><body>
<div class="bar"><b>${esc(name)}</b> building instructions &mdash; ${steps.length} steps, ${pages.length + (done.length ? 3 : 2)} pages
  <button onclick="window.print()">Print / Save as PDF</button></div>

<section class="sheet cover${coverPortrait ? ' portrait' : ''}">
  <div class="top"><div class="logo"><span>${esc(brand)}</span></div><div class="theme">${esc(name)}</div><div class="setno">${setNo}</div></div>
  <div class="cbar">
    <div class="book">1</div>
    <div class="warn">&#9888; <b>WARNING: CHOKING HAZARD.</b> Toy contains small parts.<br>Not for children under 3 years.</div>
    <div class="facts">
      <div><b>${meta.pieces || 0}</b><span>pieces</span></div>
      <div><b>${bom.length}</b><span>parts</span></div>
      <div><b>${meta.levels || 0}</b><span>layers</span></div>
      <div><b>${steps.length}</b><span>steps</span></div>
      ${meta.studs ? `<div><b>${meta.studs}</b><span>studs</span></div>` : ''}
    </div>
  </div>
  ${hero ? `<div class="hero"><img src="${hero}" alt="the finished model"></div>` : ''}
</section>

${pages.map((pg, k) => `<section class="sheet"><div class="grid">${pg.map(stepCard).join('')}</div>
  <div class="foot"><span>${esc(name)} &middot; ${setNo}</span><span class="legend">new pieces in colour<em style="background:#acacac"></em>already built${meta.weld ? ' &middot; weld plates hold separate parts together and may not follow the surface' : ''}</span><span>${k + 1} / ${pages.length}</span></div></section>`).join('\n')}

${done.length ? `<section class="sheet done">
  <div class="big">${done.map((u) => `<img src="${u}" alt="the finished model">`).join('')}</div>
  <div class="cap">
    <div><h1>Finished<i>.</i></h1><p>${esc(name)} &middot; ${meta.pieces || 0} pieces in ${steps.length} steps</p></div>
    <div class="facts">
      <div><b>${meta.pieces || 0}</b><span>pieces</span></div>
      <div><b>${bom.length}</b><span>parts</span></div>
      <div><b>${meta.levels || 0}</b><span>layers</span></div>
      ${meta.studs ? `<div><b>${meta.studs}</b><span>studs</span></div>` : ''}
    </div>
  </div>
  <div class="foot"><span>${esc(name)} &middot; ${setNo}</span><span>the finished model</span></div></section>` : ''}

<section class="sheet"><h2>Parts list &mdash; ${meta.pieces || 0} pieces, ${bom.length} different parts</h2>
  <ul class="bom">${bom.map(bomRow).join('')}</ul>
  <div class="foot"><span>${esc(name)} &middot; ${setNo}</span><span>parts list</span></div></section>
</body></html>`;
}
