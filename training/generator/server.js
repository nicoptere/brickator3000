import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3005;
const LDRAW_DIR = path.resolve(__dirname, '../../app/public/ldraw');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath.startsWith('/ldraw/')) {
    reqPath = reqPath.slice(7);
  }
  reqPath = reqPath.replace(/\\/g, '/');

  const candidates = [
    path.join(LDRAW_DIR, reqPath),
    path.join(LDRAW_DIR, reqPath.toLowerCase()),
    path.join(LDRAW_DIR, 'parts', path.basename(reqPath)),
    path.join(LDRAW_DIR, 'parts', path.basename(reqPath).toLowerCase()),
    path.join(LDRAW_DIR, 'p', path.basename(reqPath)),
    path.join(LDRAW_DIR, 'p', path.basename(reqPath).toLowerCase())
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      fs.createReadStream(c).pipe(res);
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`[LDraw Static Server] Serving ${LDRAW_DIR} on http://localhost:${PORT}/ldraw/`);
});
