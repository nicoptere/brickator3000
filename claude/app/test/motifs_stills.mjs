// still images of a model solved with motifs off / on (kind colours), through claude/generator/render.html
// usage: node test/motifs_stills.mjs model.glb [studs] [outdir]   (needs: npm i three, python playwright + chromium)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseGLB, srgb2lin } from '../src/brickgen/mesh.js';
import { generate, catalogFor } from '../src/brickgen/pipeline.js';
import { buildMesh, KIND_COL, toLDR } from '../src/brickgen/export.js';
const [file, n = '16', outdir = 'out/motifs'] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const buf = fs.readFileSync(file), model = parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const name = path.basename(file, '.glb');
for (const motifs of [false, true]) {
  const r = generate(model, { studs: +n, motifs }), cat = catalogFor(r.options);
  const mesh = buildMesh(r.pieces, cat), kinds = buildMesh(r.pieces, cat, 'kind');
  // motif pieces in a highlight colour on the kind view
  const soup = (m, a, s) => { const o = []; for (const i of m.idx) for (let c = 0; c < 3; c++) o.push(s(m[a][i * 3 + c])); return o; };
  const legend = Object.entries(r.metrics.kinds).map(([k, c]) => `<i style="background:rgb(${KIND_COL[k].map((x) => Math.round(x * 255)).join(',')})"></i>${k} ${c}<br>`).join('') + (motifs ? `<i style="background:rgb(255,80,160)"></i>from motifs ${r.pieces.filter((p) => p.motif).length}<br>` : '');
  let kcol = soup(kinds, 'col', (v) => +srgb2lin(v / 255).toFixed(3));
  if (motifs && kinds.triPiece) { for (let t = 0; t < kinds.triPiece.length; t++) if (r.pieces[kinds.triPiece[t]] && r.pieces[kinds.triPiece[t]].motif) for (let k = 0; k < 9; k++) kcol[t * 9 + k] = [1, 0.1, 0.35][k % 3]; }
  const sc = { lego_pos: soup(mesh, 'pos', (v) => +v.toFixed(2)), lego_col: soup(mesh, 'col', (v) => +srgb2lin(v / 255).toFixed(3)), lego_kind: kcol, edges: Array.from(mesh.edges, (v) => +v.toFixed(2)),
    src_pos: Array.from(r.srcTris, (v) => +v.toFixed(2)), src_col: Array.from(r.srcCols, (v) => +v.toFixed(3)),
    meta: { src: `${name}.glb`, lego: `${r.metrics.pieces} pieces, IoU ${r.metrics.iou.toFixed(3)}, motifs ${motifs ? 'on' : 'off'}`, legend } };
  const tag = `${outdir}/${name}_${n}_${motifs ? 'on' : 'off'}`;
  fs.writeFileSync(`${tag}.json`, JSON.stringify(sc)); fs.writeFileSync(`${tag}.ldr`, toLDR(r.pieces, cat, name));
  console.log(tag, r.metrics.pieces, r.metrics.iou.toFixed(3));
}
