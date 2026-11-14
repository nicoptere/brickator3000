import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  loadModelFile,
  loadModelBuffer,
  buildBricksMesh,
  exportGLB,
  exportLDR,
} from '../src/mesh_io.js';
import { deserializeCatalog, buildVariants, partSDF, studSDF, parseLDrawDat, trainPartFromLDrawGeom, trainPartFromMesh } from '../src/dictionary.js';
import { encodeSdfVolume, targetFromSdfVolume } from '../src/target.js';
import { packModelAsync } from '../src/engine.js';
import { createPalette } from '../src/colors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATASET = path.join(ROOT, 'dataset');

test('99-part trained catalog & official colors (+ optional LDraw source parsing)', () => {
  const catPath = path.join(DATASET, 'catalog_99.json');
  assert.ok(fs.existsSync(catPath), 'dataset/catalog_99.json should exist');
  const catalog = deserializeCatalog(fs.readFileSync(catPath, 'utf8'));
  assert.equal(catalog.length, 99, `expected 99 parts, got ${catalog.length}`);
  const { list, byKey } = buildVariants(catalog);
  assert.ok(list.length > 100, `expected > 100 yaw variants, got ${list.length}`);
  assert.ok(byKey.has('3001|0'), 'classic 2x4 brick 3001 must exist in catalog');

  const brick = catalog.find((p) => p.id === '3001');
  const s = partSDF(brick, 2);
  assert.ok(s.vol > 10000, '3001 SDF volume sanity check');
  assert.ok(studSDF(s.studs, 10, s.studs[0][1] + 2, 10) <= 0, 'stud SDF inside check');

  if (fs.existsSync(path.join(DATASET, 'ldraw/parts/3001.dat'))) {
    const ldrawDir = path.join(DATASET, 'ldraw');
    const resolver = (ref) => {
      const clean = ref.replace(/\\/g, '/').replace(/^\/+/, '');
      for (const base of ['parts', 'p', 'parts/s', 'p/48']) {
        const p = path.join(ldrawDir, base, clean);
        if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
      }
      return null;
    };
    const geom = parseLDrawDat('3001.dat', resolver);
    const trained = trainPartFromLDrawGeom('3001', 'Brick 2x4', geom.tris, geom.studs);
    assert.equal(Math.min(trained.w, trained.d), 2);
    assert.equal(Math.max(trained.w, trained.d), 4);
    assert.equal(Math.round(Math.max(...trained.top) / 8), 3);
  }

  const colorsDoc = JSON.parse(fs.readFileSync(path.join(DATASET, 'colors.json'), 'utf8'));
  const colors = Array.isArray(colorsDoc) ? colorsDoc : colorsDoc.colors;
  assert.ok(colors.length >= 150, `expected >= 150 official colors, got ${colors.length}`);
  const pal = createPalette(colors);
  const brightRed = pal.snap([255, 0, 0]);
  assert.equal(typeof brightRed.code, 'number');
});

test('Stanford Bunny OBJ / GLB / PLY adapters', async () => {
  const bunnyObj = await loadModelFile(path.join(DATASET, 'models/stanford_bunny.obj'));
  assert.ok(bunnyObj.tris.length / 9 >= 5000, 'stanford_bunny.obj loaded');

  const bunnyGlb = await loadModelFile(path.join(DATASET, 'models/stanford_bunny.glb'));
  assert.equal(bunnyGlb.tris.length / 9, bunnyObj.tris.length / 9, 'stanford_bunny.glb triangle count');
  assert.equal(bunnyGlb.hasColor, true, 'stanford_bunny.glb should carry vertex colors');

  const bunnyPly = await loadModelFile(path.join(DATASET, 'models/stanford_bunny.ply'));
  assert.equal(bunnyPly.tris.length / 9, bunnyObj.tris.length / 9, 'stanford_bunny.ply triangle count');
  assert.equal(bunnyPly.hasColor, true, 'stanford_bunny.ply should carry vertex colors');
});

test('custom part catalog training from Stanford Bunny mesh', async () => {
  const bunny = await loadModelFile(path.join(DATASET, 'models/stanford_bunny.obj'));
  const customPart = trainPartFromMesh('custom_bunny', bunny.tris, { w: 2, d: 2, hPlates: 3 });
  assert.equal(customPart.w, 2);
  assert.equal(customPart.d, 2);
  assert.ok(customPart.top.some((v) => v > 0));
});

test('SDF encode + decode -> BrickPack -> valid GLB & LDR export (Stanford Bunny + 99-part catalog)', async () => {
  const catalog = deserializeCatalog(fs.readFileSync(path.join(DATASET, 'catalog_99.json'), 'utf8'));
  const colors = JSON.parse(fs.readFileSync(path.join(DATASET, 'colors.json'), 'utf8'));
  const bunny = await loadModelFile(path.join(DATASET, 'models/stanford_bunny.ply'));

  const encoded = await encodeSdfVolume(bunny, { res: 24, padVoxels: 2 });
  assert.equal(encoded.header.format, 'brickpack-sdf-v1');
  assert.equal(encoded.data.length, encoded.header.nx * encoded.header.ny * encoded.header.nz);

  const T = targetFromSdfVolume(encoded.header, encoded.data, 10);
  assert.ok(T.t.some((v) => v > 0.5), 'target field from SDF has interior voxels');

  const packed = await packModelAsync(bunny, {
    studs: 10,
    effort: 'quick',
    catalog,
    colors,
  });
  assert.ok(packed.pack.pieces >= 5, `packed ${packed.pack.pieces} bricks`);
  assert.ok(packed.pack.softIoU > 0.45, `softIoU=${packed.pack.softIoU}`);

  // Also test packing directly from encoded SDF header+data
  const packedFromSdf = await packModelAsync(encoded, {
    studs: 10,
    effort: 'quick',
    catalog,
    colors,
  });
  assert.ok(packedFromSdf.pack.pieces >= 5);

  const mesh = buildBricksMesh(packed.pieces, catalog);
  const glb = exportGLB(mesh);
  assert.ok(glb.byteLength > 200);
  const reloaded = await loadModelBuffer('bunny_bricks.glb', glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
  assert.equal(reloaded.tris.length / 9, mesh.idx.length / 3);
  assert.equal(reloaded.hasColor, true);

  const ldr = exportLDR(packed.pieces, catalog, 'stanford_bunny_test');
  assert.ok(ldr.includes('0 Name:'), 'LDR output has LDraw header');
});
