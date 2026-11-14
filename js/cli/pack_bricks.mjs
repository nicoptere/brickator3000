#!/usr/bin/env node
// Pack an OBJ / GLB / PLY mesh OR pre-encoded `.sdf.json` into LEGO bricks using BrickPack,
// map colors onto official LDraw colors via CIEDE2000, and export binary `.glb` (+ optional `.ldr`).
//
// Usage:
//   node cli/pack_bricks.mjs ../dataset/models/stanford_bunny.glb --studs 16 --out ./out/bunny_bricks.glb --ldr ./out/bunny_bricks.ldr

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModelFile, buildBricksMesh, exportGLB, exportLDR } from '../src/mesh_io.js';
import { deserializeCatalog } from '../src/dictionary.js';
import { packModelAsync } from '../src/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATASET_DIR = path.resolve(__dirname, '../../dataset');

function parseArgs(argv) {
  const args = {
    input: null,
    catalog: path.join(DATASET_DIR, 'catalog_99.json'),
    colors: path.join(DATASET_DIR, 'colors.json'),
    policy: null,
    studs: 16,
    effort: 'normal',
    out: null,
    ldr: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--catalog') args.catalog = argv[++i];
    else if (a === '--colors') args.colors = argv[++i];
    else if (a === '--policy') args.policy = argv[++i];
    else if (a === '--studs') args.studs = Number(argv[++i]);
    else if (a === '--effort') args.effort = argv[++i];
    else if (a === '--out' || a === '-o') args.out = argv[++i];
    else if (a === '--ldr') args.ldr = argv[++i];
    else if (!args.input) args.input = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.error('Usage: pack_bricks.mjs <model.(obj|glb|ply) | model.sdf.json> [--studs 16] [--effort quick|normal|thorough] [--out bricks.glb]');
    process.exit(1);
  }
  const inPath = path.resolve(args.input);
  const catalog = deserializeCatalog(fs.readFileSync(path.resolve(args.catalog), 'utf8'));
  const colors = fs.existsSync(path.resolve(args.colors))
    ? JSON.parse(fs.readFileSync(path.resolve(args.colors), 'utf8'))
    : undefined;
  const policy = args.policy && fs.existsSync(args.policy)
    ? JSON.parse(fs.readFileSync(path.resolve(args.policy), 'utf8')).genes || JSON.parse(fs.readFileSync(path.resolve(args.policy), 'utf8'))
    : undefined;

  let inputData;
  if (inPath.endsWith('.sdf.json')) {
    const header = JSON.parse(fs.readFileSync(inPath, 'utf8'));
    const binPath = path.resolve(path.dirname(inPath), header.binFile || path.basename(inPath).replace(/\.sdf\.json$/, '.sdf.bin'));
    const buf = fs.readFileSync(binPath);
    const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    inputData = { header, data };
    console.log(`Loaded SDF: ${header.nx} x ${header.ny} x ${header.nz}`);
  } else {
    inputData = await loadModelFile(inPath);
    console.log(`Loaded mesh: ${inputData.tris.length / 9} triangles, hasColor=${inputData.hasColor}`);
  }

  const res = await packModelAsync(inputData, {
    studs: args.studs,
    effort: args.effort,
    catalog,
    colors,
    policy,
    log: (m) => console.log(' ', m),
  });

  console.log(`BrickPack complete: ${res.pack.pieces} bricks | softIoU=${res.pack.softIoU} | components=${res.pack.components} | ${res.pack.ms.total} ms`);

  const outGlb = path.resolve(args.out || inPath.replace(/(\.sdf)?\.[^.]+$/, '_bricks.glb'));
  fs.mkdirSync(path.dirname(outGlb), { recursive: true });
  const mesh = buildBricksMesh(res.pieces, catalog);
  const glbBuf = exportGLB(mesh);
  fs.writeFileSync(outGlb, glbBuf);
  console.log(`Saved GLB -> ${outGlb} (${(glbBuf.byteLength / 1024).toFixed(1)} KB, ${mesh.idx.length / 3} tris)`);

  if (args.ldr) {
    const outLdr = path.resolve(args.ldr);
    fs.writeFileSync(outLdr, exportLDR(res.pieces, catalog, path.basename(inPath)));
    console.log(`Saved LDraw -> ${outLdr}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
