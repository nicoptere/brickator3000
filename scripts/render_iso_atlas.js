#!/usr/bin/env node
/**
 * render_iso_atlas.js — High-Precision 64x64 Isometric LDraw Part Atlas & Thumbnail Generator
 *
 * Renders all 936 recognized parts in orthographic isometric projection with:
 * - Awaited full model and subpart resolution via Three.js LoadingManager
 * - Consistent neutral studio plastic (#a0a0a0) and crisp outlines (#1a1a1a)
 * - Smart LDraw path resolution with DOS backslash normalization
 * - Automatic stitch into 2048x2048 master sprite sheet and atlas_index.json
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_DIR = '/mnt/storage/lego';
const LDRAW_DIR = path.join(BASE_DIR, 'brickator3000/app/public/ldraw');
const CLASSES_FILE = path.join(BASE_DIR, 'brickator3000/app/public/data/classes.json');

const THUMB_DIRS = [
  path.join(BASE_DIR, 'brickator3000/app/public/thumbnails'),
  path.join(BASE_DIR, 'detect/atlas_64/thumbnails')
];

const ATLAS_OUTPUTS = [
  path.join(BASE_DIR, 'brickator3000/app/public/atlas_64.png'),
  path.join(BASE_DIR, 'detect/atlas_64/atlas_64.png'),
  path.join(BASE_DIR, 'detect/mobile_app/public/atlas_64.png')
];

const INDEX_OUTPUTS = [
  path.join(BASE_DIR, 'brickator3000/app/public/data/atlas_index.json'),
  path.join(BASE_DIR, 'detect/atlas_64/atlas_index.json'),
  path.join(BASE_DIR, 'detect/mobile_app/public/data/atlas_index.json')
];

function createLDrawServer(port) {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.dat': 'text/plain',
    '.ldr': 'text/plain',
    '.png': 'image/png'
  };

  const server = http.createServer((req, res) => {
    let reqUrl = decodeURI(req.url.split('?')[0]);
    if (reqUrl === '/') reqUrl = '/detect/headless_iso_atlas.html';

    if (reqUrl.startsWith('/ldraw/')) {
      let sub = reqUrl.replace(/^\/ldraw\//, '').replace(/\\/g, '/');
      sub = sub.replace(/^(parts\/)+/i, 'parts/');
      sub = sub.replace(/^(p\/)+/i, 'p/');
      sub = sub.replace(/^(p|models|parts)\/parts\//i, 'parts/');

      const fname = path.basename(sub);
      const candidates = [
        path.join(LDRAW_DIR, sub),
        path.join(LDRAW_DIR, sub.toLowerCase()),
        path.join(LDRAW_DIR, 'parts', sub),
        path.join(LDRAW_DIR, 'parts', sub.toLowerCase()),
        path.join(LDRAW_DIR, 'parts', fname),
        path.join(LDRAW_DIR, 'parts', fname.toLowerCase()),
        path.join(LDRAW_DIR, 'parts', 's', fname),
        path.join(LDRAW_DIR, 'parts', 's', fname.toLowerCase()),
        path.join(LDRAW_DIR, 'p', fname),
        path.join(LDRAW_DIR, 'p', fname.toLowerCase()),
        path.join(LDRAW_DIR, 'p', '48', fname),
        path.join(LDRAW_DIR, 'p', '48', fname.toLowerCase()),
        path.join(LDRAW_DIR, 'p', '8', fname),
        path.join(LDRAW_DIR, 'p', '8', fname.toLowerCase())
      ];

      for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) {
          res.writeHead(200, {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          });
          fs.createReadStream(c).pipe(res);
          return;
        }
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + reqUrl);
      return;
    }

    if (reqUrl === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    const filePath = path.join(BASE_DIR, reqUrl);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    console.warn('  [Server 404]:', reqUrl);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404');
  });

  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

async function main() {
  const args = process.argv.slice(2);
  const testMode = args.includes('--test');
  const partArg = args.find(a => a.startsWith('--part='));
  const specificPart = partArg ? partArg.split('=')[1] : null;
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : (testMode ? 10 : null);
  const PORT = 8092;

  console.log('================================================================');
  console.log(' ★ BRICKATOR 3000: 64x64 ISOMETRIC THUMBNAIL & ATLAS RENDERER');
  console.log('================================================================');
  console.log(`  Classes File : ${CLASSES_FILE}`);
  console.log(`  LDraw Path   : ${LDRAW_DIR}`);
  console.log(`  Target       : ${specificPart ? 'Single Part ' + specificPart : (limit ? limit + ' parts' : 'All 936')}`);
  console.log('================================================================\n');

  THUMB_DIRS.forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  const classesData = JSON.parse(fs.readFileSync(CLASSES_FILE, 'utf8'));
  let parts = classesData.classes; // 936 classes
  if (specificPart) parts = parts.filter(p => p.id === specificPart);
  else if (limit) parts = parts.slice(0, limit);

  // Load existing aliases to preserve metadata
  let existingAliases = {};
  const oldIndexFile = path.join(BASE_DIR, 'detect/atlas_64/atlas_index.json');
  if (fs.existsSync(oldIndexFile)) {
    try {
      const oldIndex = JSON.parse(fs.readFileSync(oldIndexFile, 'utf8'));
      if (oldIndex && oldIndex.parts) {
        for (const [pid, pdata] of Object.entries(oldIndex.parts)) {
          if (pdata.aliases) existingAliases[pid] = pdata.aliases;
        }
      }
    } catch (_) {}
  }

  // Start internal static server
  console.log(`[*] Starting internal LDraw static server on port ${PORT}...`);
  const server = await createLDrawServer(PORT);

  // Launch Chromium
  console.log('[*] Launching headless Chromium via Puppeteer...');
  const browser = await puppeteer.launch({
    executablePath: '/snap/bin/chromium',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--use-gl=angle',
      '--use-angle=gl-egl',
      '--ignore-gpu-blocklist',
      '--window-size=200,200'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 64, height: 64 });

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('Material properties for code') || text.includes('favicon.ico')) return;
    if (msg.type() === 'error') {
      console.error('  [Browser Error]:', text);
    }
  });
  page.on('pageerror', err => {
    console.error('  [Browser PageError]:', err.message, err.stack);
  });
  page.on('requestfailed', req => {
    console.error('  [Browser ReqFailed]:', req.url(), req.failure()?.errorText);
  });

  const studioUrl = `http://localhost:${PORT}/detect/headless_iso_atlas.html`;
  console.log(`[*] Navigating to ${studioUrl}...`);
  await page.goto(studioUrl, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(() => window.isReady === true, { timeout: 15000 });
  console.log('✓ Isometric Studio initialized and ready on GPU.\n');

  const renderedList = [];
  const failedList = [];
  const tStart = Date.now();

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const relLdraw = part.ldraw || `parts/${part.id}.dat`;

    try {
      const res = await page.evaluate(async (filePath) => {
        return await window.renderPartIso(filePath);
      }, relLdraw);

      if (res && res.success && res.dataUrl) {
        const base64Data = res.dataUrl.replace(/^data:image\/png;base64,/, '');
        const buf = Buffer.from(base64Data, 'base64');

        // Save to all target thumbnail folders
        for (const tDir of THUMB_DIRS) {
          fs.writeFileSync(path.join(tDir, `${part.id}.png`), buf);
        }

        renderedList.push({
          idx: part.idx,
          id: part.id,
          name: part.name,
          projWidth: res.projWidth,
          projHeight: res.projHeight
        });

        if ((i + 1) % 50 === 0 || i === parts.length - 1 || testMode || specificPart) {
          const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
          const fps = ((i + 1) / (Date.now() - tStart) * 1000).toFixed(1);
          console.log(`  [${i + 1}/${parts.length}] Part ${part.id} rendered (${res.meshCount} meshes, ${res.lineCount} lines, ${elapsed}s elapsed, ~${fps} parts/sec)`);
        }
      } else {
        console.warn(`  [Warning] Part ${part.id} render failed: ${res ? res.reason : 'unknown'}`);
        failedList.push(part.id);
      }
    } catch (err) {
      console.error(`  [Error] Part ${part.id} exception:`, err.message);
      failedList.push(part.id);
    }
  }

  await browser.close();
  server.close();

  const totalTime = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log(`\n✓ Render pass finished: ${renderedList.length} parts rendered (${failedList.length} failed) in ${totalTime}s.`);

  if (testMode) {
    console.log('\n★ Test mode complete. Check /mnt/storage/lego/brickator3000/app/public/thumbnails for samples.');
    return;
  }

  // 4. Build Master Sprite Atlas & atlas_index.json
  console.log('\n[*] Stitching master 2048x2048 Sprite Atlas & generating atlas_index.json...');
  const COLS = 32;
  const ROWS = 32;
  const TILE_SIZE = 64;
  const ATLAS_WIDTH = COLS * TILE_SIZE;  // 2048
  const ATLAS_HEIGHT = ROWS * TILE_SIZE; // 2048

  const atlasIndex = {
    tileSize: TILE_SIZE,
    cols: COLS,
    rows: ROWS,
    atlasWidth: ATLAS_WIDTH,
    atlasHeight: ATLAS_HEIGHT,
    totalParts: renderedList.length,
    parts: {}
  };

  for (let i = 0; i < renderedList.length; i++) {
    const item = renderedList[i];
    const col = item.idx % COLS;
    const row = Math.floor(item.idx / COLS);

    const uMin = col / COLS;
    const vMin = row / ROWS;
    const uMax = (col + 1) / COLS;
    const vMax = (row + 1) / ROWS;

    atlasIndex.parts[item.id] = {
      idx: item.idx,
      id: item.id,
      name: item.name,
      col,
      row,
      x: col * TILE_SIZE,
      y: row * TILE_SIZE,
      uMin,
      vMin,
      uMax,
      vMax,
      aliases: existingAliases[item.id] || [],
      thumbnail: `thumbnails/${item.id}.png`
    };
  }

  // Write atlas_index.json to all targets
  const indexJson = JSON.stringify(atlasIndex, null, 2);
  for (const idxPath of INDEX_OUTPUTS) {
    fs.mkdirSync(path.dirname(idxPath), { recursive: true });
    fs.writeFileSync(idxPath, indexJson, 'utf8');
    console.log(`✓ Saved atlas index: ${idxPath}`);
  }

  console.log('✓ Atlas index metadata written successfully.');

  // Run stitcher to generate master atlas_64.png across all targets
  console.log('\n[*] Stitching master 2048x2048 Sprite Atlas via stitch_atlas.py...');
  try {
    execSync('python3 /mnt/storage/lego/detect/stitch_atlas.py', { stdio: 'inherit' });
    console.log('✓ Sprite Atlas generation and distribution complete!\n');
  } catch (err) {
    console.error('[!] Atlas stitching failed:', err.message);
  }
}

main().catch(err => {
  console.error('[!] Fatal error:', err);
  process.exit(1);
});
