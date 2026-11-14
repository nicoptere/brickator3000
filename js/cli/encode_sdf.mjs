#!/usr/bin/env node
// Encode an OBJ, GLB, or PLY mesh into an interoperable `.sdf.json` + `.sdf.bin` volume.
//
// Usage:
//   node cli/encode_sdf.mjs ../dataset/models/stanford_bunny.obj --res 64 --out ./out/bunny.sdf.json

import fs from 'node:fs';
import path from 'node:path';
import { loadModelFile } from '../src/mesh_io.js';
import { encodeSdfVolume } from '../src/target.js';

function parseArgs(argv) {
  const args = { input: null, res: 64, pad: 3, out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--res') args.res = Number(argv[++i]);
    else if (a === '--pad') args.pad = Number(argv[++i]);
    else if (a === '--out' || a === '-o') args.out = argv[++i];
    else if (!args.input) args.input = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.error('Usage: encode_sdf.mjs <model.(obj|glb|ply)> [--res 64] [--out out.sdf.json]');
    process.exit(1);
  }
  const inPath = path.resolve(args.input);
  const outJson = path.resolve(args.out || inPath.replace(/\.[^.]+$/, '.sdf.json'));
  const outBin = outJson.replace(/\.sdf\.json$|\.json$/i, '.sdf.bin');

  const model = await loadModelFile(inPath);
  console.log(`Loaded ${path.basename(inPath)}: ${model.tris.length / 9} triangles, hasColor=${model.hasColor}`);

  const { header, data } = await encodeSdfVolume(model, {
    res: args.res,
    padVoxels: args.pad,
    log: (m) => console.log(m),
  });

  header.source = path.basename(inPath);
  header.binFile = path.basename(outBin);

  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(header, null, 2));
  fs.writeFileSync(outBin, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  console.log(`Wrote SDF header -> ${outJson}`);
  console.log(`Wrote SDF float32 grid -> ${outBin} (${(data.byteLength / 1024).toFixed(1)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
