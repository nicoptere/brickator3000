#!/usr/bin/env node
// Minimal HTTP server for the BrickPack Browser Studio (WebGPU compute + WebGL2 viewer).
// Serves js/web at `/`, js/src at `/src/`, and dataset at `/dataset/`.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JS_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(JS_DIR, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.ply': 'application/octet-stream',
  '.obj': 'text/plain; charset=utf-8',
  '.dat': 'text/plain; charset=utf-8',
  '.ldr': 'text/plain; charset=utf-8',
  '.bin': 'application/octet-stream',
};

const port = Number(process.env.PORT || 4173);

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  let filePath;
  if (urlPath === '/' || urlPath === '/index.html') {
    filePath = path.join(__dirname, 'index.html');
  } else if (urlPath.startsWith('/src/')) {
    filePath = path.join(JS_DIR, urlPath);
  } else if (urlPath.startsWith('/dataset/')) {
    filePath = path.join(ROOT_DIR, urlPath);
  } else {
    filePath = path.join(__dirname, urlPath);
  }

  filePath = path.normalize(filePath);
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`BrickPack Web Studio -> http://127.0.0.1:${port}/`);
});
