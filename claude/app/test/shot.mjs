// Pictures of a piece list (JSON from `OUT=... node test/run.mjs`, or any pieces array) through the real viewport, headless:
// isometric from the four corners and two elevations, written as PNGs. Needs `npm i -D playwright`.
// usage: node test/shot.mjs pieces.json [dims=18,16,64] [outdir] [tint=1]   (tint: sideways pieces cyan, their hosts magenta)
import fs from 'fs';
import path from 'path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const [file, dimsArg = '16,16,32', outdir = 'out/shots', tint = '1'] = process.argv.slice(2);
if (!file) { console.error('usage: node test/shot.mjs pieces.json [dims] [outdir] [tint]'); process.exit(1); }
fs.mkdirSync(outdir, { recursive: true });
const base = path.basename(file).replace(/\.json$/, ''), served = path.join(outdir, `_${base}.json`); fs.copyFileSync(file, served);
const server = await createServer({ configFile: 'vite.config.js', server: { port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`http://localhost:5198/test/shot.html?pieces=/${served.replace(/\\/g, '/')}&dims=[${dimsArg}]&tint=${tint}`);
  await page.waitForFunction(() => window.__shots, null, { timeout: 120000 });
  const shots = await page.evaluate(() => window.__shots);
  for (const [k, uri] of Object.entries(shots)) fs.writeFileSync(path.join(outdir, `${base}_${k}.jpg`), Buffer.from(uri.split(',')[1], 'base64'));
  console.log(`${Object.keys(shots).length} shots of ${base} in ${outdir}/`);
} finally { await browser.close(); await server.close(); }
