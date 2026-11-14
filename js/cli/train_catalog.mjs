#!/usr/bin/env node
// Train a BrickPack part catalog from an LDraw parts directory (recursive `.dat` + `parts/s/` + `p/`)
// or a directory/list of 3D mesh files (`.obj`, `.glb`, `.ply`).
//
// Usage:
//   node cli/train_catalog.mjs --ldraw ../dataset/ldraw --rank ../dataset/omr_top99.json --out ../dataset/catalog_99.json
//   node cli/train_catalog.mjs --models ./my_parts_dir --out ./custom_catalog.json

import fs from 'node:fs';
import path from 'node:path';
import { loadModelFile } from '../src/mesh_io.js';
import {
  parseLDrawDat,
  trainPartFromLDrawGeom,
  trainPartFromMesh,
  serializeCatalog,
  partSDF,
} from '../src/dictionary.js';

function parseArgs(argv) {
  const args = { ldraw: null, rank: null, models: null, out: '../dataset/catalog_99.json', checkSdf: true };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--ldraw') args.ldraw = argv[++i];
    else if (k === '--rank') args.rank = argv[++i];
    else if (k === '--models') args.models = argv[++i];
    else if (k === '--out') args.out = argv[++i];
    else if (k === '--no-sdf-check') args.checkSdf = false;
  }
  return args;
}

function makeLDrawResolver(rootDir) {
  const roots = [
    path.join(rootDir, 'parts'),
    rootDir,
    path.join(rootDir, 'p'),
  ];
  const cache = new Map();
  return (subpath) => {
    const clean = subpath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (cache.has(clean)) return cache.get(clean);
    const candidates = [];
    for (const r of roots) {
      candidates.push(path.join(r, clean));
      candidates.push(path.join(r, clean.toLowerCase()));
      if (!clean.toLowerCase().endsWith('.dat')) {
        candidates.push(path.join(r, clean + '.dat'));
      }
    }
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        const txt = fs.readFileSync(c, 'utf8');
        cache.set(clean, txt);
        return txt;
      }
    }
    cache.set(clean, null);
    return null;
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const catalog = [];

  if (args.ldraw) {
    const ldrawDir = path.resolve(args.ldraw);
    const resolver = makeLDrawResolver(ldrawDir);
    let specs = [];
    if (args.rank && fs.existsSync(args.rank)) {
      const doc = JSON.parse(fs.readFileSync(args.rank, 'utf8'));
      const arr = Array.isArray(doc) ? doc : doc.parts || [];
      specs = arr.map((p) => ({
        id: String(p.id).replace(/\.dat$/i, ''),
        name: p.name || p.title || String(p.id),
        omr_count: p.count,
      }));
    } else {
      const partsDir = fs.existsSync(path.join(ldrawDir, 'parts')) ? path.join(ldrawDir, 'parts') : ldrawDir;
      specs = fs.readdirSync(partsDir)
        .filter((f) => f.toLowerCase().endsWith('.dat'))
        .sort()
        .map((f) => ({ id: f.replace(/\.dat$/i, ''), name: f }));
    }

    for (const sp of specs) {
      const entryFile = `${sp.id}.dat`;
      const parsed = parseLDrawDat(entryFile, resolver);
      if (!parsed.tris.length) continue;
      const entry = trainPartFromLDrawGeom(sp.id, parsed.title || sp.name, parsed.tris, parsed.studs);
      if (!entry) continue;
      if (sp.omr_count !== undefined) entry.omr_count = sp.omr_count;
      if (args.checkSdf) {
        const s = partSDF(entry, 2);
        entry.sdf_voxels = s.sdf.length;
      }
      catalog.push(entry);
    }
    console.log(`Trained ${catalog.length} LDraw parts from ${ldrawDir}`);
  } else if (args.models) {
    const modelDir = path.resolve(args.models);
    const files = fs.readdirSync(modelDir)
      .filter((f) => /\.(obj|glb|ply)$/i.test(f))
      .sort();
    for (const f of files) {
      const id = f.replace(/\.[^.]+$/, '');
      const m = await loadModelFile(path.join(modelDir, f));
      const entry = trainPartFromMesh(id, m.tris, { kind: 'slope' });
      if (entry) {
        if (args.checkSdf) {
          const s = partSDF(entry, 2);
          entry.sdf_voxels = s.sdf.length;
        }
        catalog.push(entry);
      }
    }
    console.log(`Trained ${catalog.length} mesh parts from ${modelDir}`);
  } else {
    console.error('Provide --ldraw <dir> or --models <dir>');
    process.exit(1);
  }

  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, serializeCatalog(catalog, { source: args.ldraw ? 'ldraw' : 'meshes' }));
  console.log(`Saved catalog -> ${outPath} (${catalog.length} parts, ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
