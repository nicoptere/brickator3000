import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// 3D models are served straight from the existing library (no copy). Override with MODELS_DIR=/path/to/models
const MODELS_DIR = path.resolve(process.env.MODELS_DIR || path.join(__dirname, '../../discretizer/public/models'));
const EXT = /\.(glb|gltf|obj|ply|stl)$/i;

function listModels(dir, base = '') {
  const out = [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listModels(path.join(dir, e.name), rel));
    else if (EXT.test(e.name)) {
      let size = 0; try { size = fs.statSync(path.join(dir, e.name)).size; } catch {}
      out.push({ path: rel, size });
    }
  }
  return out;
}

const modelsPlugin = {
  name: 'brickgen-models',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!req.url) return next();
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url === '/api/models') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ root: MODELS_DIR, models: listModels(MODELS_DIR) }));
      }
      if (url.startsWith('/models/')) {
        const f = path.join(MODELS_DIR, url.slice('/models/'.length));
        if (!f.startsWith(MODELS_DIR) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.statusCode = 404; return res.end('not found'); }
        res.setHeader('Cache-Control', 'no-cache');
        return fs.createReadStream(f).pipe(res);
      }
      if (url === '/dev' || url === '/dev/ui' || url.startsWith('/dev/')) {
        req.url = '/index.html';
      }
      next();
    });
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), modelsPlugin],
  worker: { format: 'es' },
  server: { host: '0.0.0.0', port: 5174 },
  preview: { host: '0.0.0.0', port: 5174 },
  build: { target: 'esnext' },
});
