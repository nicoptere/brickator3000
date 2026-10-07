// Pure JavaScript LDraw (.ldr, .mpd, .mdp) model parser and converter for Brickator3000.
// Parses LDraw lines, walks submodel hierarchies, canonicalizes rotations to 24 orthogonal
// orientations, resolves colors and catalog entries, and grounds model onto the LEGO plate grid.

import { FULL_CATALOG } from './brickgen/pipeline.js';
import { ORIENTATIONS } from './motifs/orient.js';
import PALETTE from './brickgen/palette.js';

const catMap = new Map(FULL_CATALOG.map((c) => [c.id, c]));
const palMap = new Map(PALETTE.map((p) => [p.code, p]));

const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const D = [1, -1, -1];

const mul3 = (A, B) => {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    }
  }
  return o;
};

const apply = (A, t, p) => [
  A[0] * p[0] + A[1] * p[1] + A[2] * p[2] + t[0],
  A[3] * p[0] + A[4] * p[1] + A[5] * p[2] + t[1],
  A[6] * p[0] + A[7] * p[1] + A[8] * p[2] + t[2],
];

const DMD = (M) => {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = D[r] * M[r * 3 + c] * D[c];
    }
  }
  return o;
};

const Dv = (v) => [v[0], -v[1], -v[2]];

/** Parse LDraw text into distinct file sections (supports MPD files and simple LDR files) */
export function parseLDraw(text) {
  const files = [];
  let cur = null;
  const open = (name) => {
    cur = { name: name.toLowerCase(), desc: null, refs: [] };
    files.push(cur);
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('0 FILE ')) {
      open(line.slice(7).trim());
      continue;
    }
    if (line.startsWith('0 NOFILE')) {
      cur = null;
      continue;
    }
    if (!cur) open('');
    const c = line[0];
    if (c === '0') {
      if (cur.desc === null && !cur.refs.length) {
        cur.desc = line.slice(1).trim().replace(/\s+/g, ' ');
      }
      continue;
    }
    if (c === '1') {
      const t = line.split(/\s+/);
      if (t.length < 15) continue;
      const v = t.slice(2, 14).map(Number);
      const file = t.slice(14).join(' ').toLowerCase().replace(/\\/g, '/');
      if (v.some((x) => Number.isNaN(x))) continue;
      cur.refs.push({ color: +t[1], t: [v[0], v[1], v[2]], M: v.slice(3, 12), file });
    }
  }
  return files;
}

/**
 * Converts an LDraw (.ldr, .mpd, .mdp) text string into a native Brickator3000 LEGO model result.
 * Bypasses continuous mesh discretization: returns pieces, dims, metrics ready for 3D rendering.
 */
export function parseLDrawToModel(text, filename = 'model.ldr') {
  const files = parseLDraw(text);
  if (!files.length) throw new Error('No valid LDraw content found');

  const byName = new Map(files.map((f) => [f.name, f]));
  const root = files[0];
  const placements = [];

  const walk = (f, M, t, color, depth) => {
    if (depth > 32) return;
    for (const r of f.refs) {
      const M2 = mul3(M, r.M);
      const t2 = apply(M, t, r.t);
      const col = r.color === 16 ? color : r.color;
      const name = r.file.replace(/^.*\//, '');
      const isDat = name.endsWith('.dat');
      const sub = byName.get(r.file.toLowerCase());
      if (sub && !isDat) {
        walk(sub, M2, t2, col, depth + 1);
        continue;
      }
      placements.push({ part: name.replace(/\.dat$/, ''), color: col, M: M2, t: t2 });
    }
  };

  walk(root, I3, [0, 0, 0], 16, 0);

  if (!placements.length) {
    throw new Error('No LEGO part placements (type 1 lines) found in LDraw file');
  }

  const pieces = [];
  const dynamicCatalog = new Map();

  for (const p of placements) {
    const Re = DMD(p.M);
    const te = Dv(p.t);

    // Find best match among the 24 orthogonal 3D orientations
    let bestOri = 0;
    let bestDiff = Infinity;
    for (let o = 0; o < ORIENTATIONS.length; o++) {
      let diff = 0;
      for (let k = 0; k < 9; k++) diff += Math.abs(Re[k] - ORIENTATIONS[o][k]);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestOri = o;
      }
    }
    const ori = bestOri;
    const rot = (ori % 4) * 90;

    let partId = p.part;
    let catEntry = catMap.get(partId);
    if (!catEntry) {
      const base = partId.replace(/[a-z]+$/, '');
      catEntry = catMap.get(base);
      if (catEntry) partId = base;
    }
    if (!catEntry && (partId === '4073' || partId === '30057')) {
      catEntry = catMap.get('6141');
      if (catEntry) partId = '6141';
    }
    if (!catEntry) {
      // Find embedded description or parse part dimensions
      const emb = byName.get(p.part.toLowerCase() + '.dat');
      const desc = emb?.desc || p.part;
      let w = 1, d = 1, h = 3, kind = 'brick';
      const m = /(Brick|Plate|Tile|Panel|Slope|Support|Round)\s+(\d+)\s*x\s*(\d+)(?:\s*x\s*(\d+))?/i.exec(desc);
      if (m) {
        kind = m[1].toLowerCase();
        w = +m[2] || 1;
        d = +m[3] || 1;
        h = m[4] ? +m[4] * 3 : kind === 'plate' || kind === 'tile' ? 1 : 3;
      }
      catEntry = {
        id: partId,
        name: desc,
        kind,
        w,
        d,
        h,
        minx: -w * 10,
        minz: -d * 10,
        stud_cells: Array.from({ length: w * d }, (_, i) => [i % w, Math.floor(i / w)]),
        source: 'analytic',
      };
      dynamicCatalog.set(partId, catEntry);
    }

    const w = catEntry.w, d = catEntry.d, h = catEntry.h;
    const i = te[0] / 20 - w / 2;
    const j = te[2] / 20 - d / 2;
    const b = te[1] / 8;

    let rgb = [160, 165, 169], colorName = 'Light Gray', code = p.color;
    if (p.color >= 0x2000000) {
      rgb = [(p.color >> 16) & 255, (p.color >> 8) & 255, p.color & 255];
      colorName = '#' + rgb.map((x) => x.toString(16).padStart(2, '0')).join('');
    } else if (palMap.has(p.color)) {
      const pal = palMap.get(p.color);
      colorName = pal.name;
      code = pal.code;
      const hex = pal.hex.replace('#', '');
      rgb = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    }

    pieces.push({
      id: partId,
      name: catEntry.name,
      kind: catEntry.kind,
      ori,
      rot,
      i,
      j,
      b,
      w,
      d,
      h,
      color: p.color,
      code,
      colorName,
      rgb,
    });
  }

  // Shift to origin so model is grounded at b=0, i>=0, j>=0
  let minI = Infinity, minJ = Infinity, minB = Infinity;
  for (const pc of pieces) {
    if (pc.i < minI) minI = pc.i;
    if (pc.j < minJ) minJ = pc.j;
    if (pc.b < minB) minB = pc.b;
  }
  minI = Math.floor(minI);
  minJ = Math.floor(minJ);
  minB = Math.floor(minB);
  let maxI = 0, maxJ = 0, maxB = 0;
  for (const pc of pieces) {
    pc.i = Math.round((pc.i - minI) * 2) / 2;
    pc.j = Math.round((pc.j - minJ) * 2) / 2;
    pc.b = Math.round((pc.b - minB) * 2) / 2;
    if (pc.i + pc.w > maxI) maxI = pc.i + pc.w;
    if (pc.j + pc.d > maxJ) maxJ = pc.j + pc.d;
    if (pc.b + pc.h > maxB) maxB = pc.b + pc.h;
  }

  const kinds = {};
  for (const pc of pieces) kinds[pc.kind] = (kinds[pc.kind] || 0) + 1;

  const nx = Math.max(1, Math.ceil(maxI));
  const nz = Math.max(1, Math.ceil(maxJ));
  const ny = Math.max(1, Math.ceil(maxB));

  return {
    isLDraw: true,
    name: filename,
    pieces,
    dims: [nx, nz, ny],
    metrics: {
      pieces: pieces.length,
      kinds,
      grounded: 1.0,
      components: 1,
      iou: 1.0,
      recall: 1.0,
      overfill: 0.0,
    },
    timing: { total: 0 },
    post: { brace: 0, splice: 0, bridge: 0, supports: 0 },
    maxLevel: ny,
    extraCatalog: Array.from(dynamicCatalog.values()),
    srcTris: new Float32Array(0),
    srcCols: new Float32Array(0),
  };
}
