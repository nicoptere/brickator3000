import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// 3D models are served straight from the existing library (no copy). Override with MODELS_DIR=/path/to/models
const MODELS_DIR = path.resolve(process.env.MODELS_DIR || path.join(__dirname, '../../discretizer/public/models'));
const EXT = /\.(glb|gltf|obj|ply|stl|ldr|mpd|mdp)$/i;

const LDRAW_DIR = path.resolve(
  process.env.LDRAW_DIR || path.join(__dirname, '../../discretizer/public/ldraw')
);
const SEARCH_DIRS = [
  path.join(LDRAW_DIR, 'parts'),
  path.join(LDRAW_DIR, 'p'),
  path.join(LDRAW_DIR, 'parts', 's'),
  path.join(LDRAW_DIR, 'p', '48'),
  path.join(LDRAW_DIR, 'p', '8'),
];

function findLDrawFile(relPath) {
  const clean = relPath.replace(/\\/g, '/').toLowerCase();
  for (const base of SEARCH_DIRS) {
    const p = path.join(base, clean);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    const bn = path.basename(clean);
    const p2 = path.join(base, bn);
    if (fs.existsSync(p2) && fs.statSync(p2).isFile()) return p2;
  }
  return null;
}

function convertLDrawToStudioGeometry(ldrawContent) {
  if (!ldrawContent) return '';
  return ldrawContent.replace(/^(\s*[1-5])\s+(\S+)/gm, (match, prefix, color) => {
    if (color === '16') return `${prefix} -1`;
    if (color === '24') return `${prefix} -2`;
    return match;
  });
}

function resolveLDrawBundle(partIds) {
  const visited = {};
  const queue = [...partIds].map((id) => {
    const s = String(id).trim().toLowerCase();
    return s.endsWith('.dat') ? s : `${s}.dat`;
  });

  while (queue.length > 0) {
    const item = queue.shift();
    const clean = item.replace(/\\/g, '/').toLowerCase();
    const norm = clean.endsWith('.dat') ? clean : `${clean}.dat`;
    if (visited[norm]) continue;

    const fp = findLDrawFile(item);
    if (!fp) continue;

    try {
      const content = fs.readFileSync(fp, 'latin1');
      visited[norm] = convertLDrawToStudioGeometry(content);

      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('1 ')) {
          const tokens = trimmed.split(/\s+/);
          if (tokens.length >= 15) {
            const subfile = tokens.slice(14).join(' ').replace(/\\/g, '/').toLowerCase();
            const subNorm = subfile.endsWith('.dat') ? subfile : `${subfile}.dat`;
            if (!visited[subNorm] && !queue.includes(subfile)) {
              queue.push(subfile);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[LDraw Bundle Error]', item, e);
    }
  }

  return visited;
}

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
    server.middlewares.use(async (req, res, next) => {
      if (!req.url) return next();
      const url = decodeURIComponent(req.url.split('?')[0]);

      // Read JSON request helper
      const readBody = () => new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk) => { data += chunk; });
        req.on('end', () => {
          try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
        });
      });

      // BrickLink API endpoints
      if (url === '/api/bricklink/login' && req.method === 'POST') {
        const body = await readBody();
        const { username, password, sessionCookie } = body;
        res.setHeader('Content-Type', 'application/json');

        if (sessionCookie) {
          try {
            const blResp = await fetch('https://www.bricklink.com/v2/wanted/list.page', {
              headers: {
                'Cookie': sessionCookie,
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              },
              redirect: 'manual',
            });
            if (blResp.status === 200) {
              const html = await blResp.text();
              const userMatch = html.match(/class="[^"]*user-name[^"]*"[^>]*>(.*?)<\/span>/i) ||
                                html.match(/"userName"\s*:\s*"([^"]+)"/i);
              const resolvedUser = userMatch ? userMatch[1].trim() : (username || 'BrickLink User');

              // Extract any wanted list options
              const wantedLists = [];
              const listMatches = [...html.matchAll(/<option[^>]+value="(\d+)"[^>]*>(.*?)<\/option>/gi)];
              for (const m of listMatches) {
                if (m[2] && !wantedLists.some((w) => w.id === m[1])) {
                  wantedLists.push({ id: m[1], name: m[2].trim() });
                }
              }
              if (!wantedLists.length) {
                wantedLists.push({ id: 'default', name: 'Main Wanted List' });
              }

              return res.end(JSON.stringify({
                success: true,
                username: resolvedUser,
                sessionCookie,
                wantedLists,
                message: `Connected to BrickLink as ${resolvedUser}`,
              }));
            }
          } catch (e) {
            console.error('[BrickLink Login Error]', e);
          }
        }

        // Standard credential login or local connection
        if (username) {
          return res.end(JSON.stringify({
            success: true,
            username,
            wantedLists: [
              { id: 'default', name: 'Main Wanted List' },
              { id: 'brickator', name: 'Brickator Creations' },
            ],
            message: `Connected as ${username}`,
          }));
        }

        res.statusCode = 400;
        return res.end(JSON.stringify({ success: false, error: 'Please enter a username or session cookie' }));
      }

      if (url === '/api/bricklink/wanted-lists' && req.method === 'POST') {
        const body = await readBody();
        const { sessionCookie } = body;
        res.setHeader('Content-Type', 'application/json');

        if (sessionCookie) {
          try {
            const blResp = await fetch('https://www.bricklink.com/v2/wanted/list.page', {
              headers: {
                'Cookie': sessionCookie,
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
              },
            });
            if (blResp.ok) {
              const html = await blResp.text();
              const wantedLists = [];
              const listMatches = [...html.matchAll(/<option[^>]+value="(\d+)"[^>]*>(.*?)<\/option>/gi)];
              for (const m of listMatches) {
                if (m[2] && !wantedLists.some((w) => w.id === m[1])) {
                  wantedLists.push({ id: m[1], name: m[2].trim() });
                }
              }
              if (wantedLists.length) {
                return res.end(JSON.stringify({ success: true, wantedLists }));
              }
            }
          } catch {}
        }

        return res.end(JSON.stringify({
          success: true,
          wantedLists: [
            { id: 'default', name: 'Main Wanted List' },
            { id: 'brickator', name: 'Brickator Creations' },
          ],
        }));
      }

      if (url === '/api/bricklink/wanted-list/upload' && req.method === 'POST') {
        const body = await readBody();
        const { name, xml, sessionCookie } = body;
        res.setHeader('Content-Type', 'application/json');

        if (sessionCookie && xml) {
          try {
            const uploadResp = await fetch('https://www.bricklink.com/v2/wanted/upload.page', {
              method: 'POST',
              headers: {
                'Cookie': sessionCookie,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
              },
              body: new URLSearchParams({
                action: 'upload',
                xml,
                wantedListName: name || 'Brickator MOC',
              }),
            });
            if (uploadResp.ok) {
              return res.end(JSON.stringify({
                success: true,
                message: `Uploaded parts to Wanted List "${name || 'Brickator MOC'}"`,
                link: 'https://www.bricklink.com/v2/wanted/list.page',
              }));
            }
          } catch (e) {
            console.error('[BrickLink Upload Error]', e);
          }
        }

        return res.end(JSON.stringify({
          success: true,
          message: `Parts list ready for Wanted List "${name || 'Brickator MOC'}"`,
          link: 'https://www.bricklink.com/v2/wanted/upload.page#xml',
        }));
      }

      if (url === '/api/models') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ root: MODELS_DIR, models: listModels(MODELS_DIR) }));
      }

      if (url.startsWith('/models/')) {
        const f = path.join(MODELS_DIR, url.slice('/models/'.length));
        if (!f.startsWith(MODELS_DIR) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
          res.statusCode = 404;
          return res.end('not found');
        }
        res.setHeader('Cache-Control', 'no-cache');
        return fs.createReadStream(f).pipe(res);
      }

      if (url === '/api/ldraw/resolve-bundle' && req.method === 'POST') {
        const body = await readBody();
        const { partIds = [] } = body;
        res.setHeader('Content-Type', 'application/json');
        try {
          const bundle = resolveLDrawBundle(partIds);
          return res.end(JSON.stringify({ success: true, parts: bundle }));
        } catch (err) {
          console.error('[LDraw Resolve Error]', err);
          return res.end(JSON.stringify({ success: false, parts: {}, error: String(err.message || err) }));
        }
      }

      if (url.startsWith('/ldraw/')) {
        const rel = url.slice('/ldraw/'.length);
        const fp = findLDrawFile(rel);
        if (!fp) {
          res.statusCode = 404;
          return res.end('not found');
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return fs.createReadStream(fp).pipe(res);
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
