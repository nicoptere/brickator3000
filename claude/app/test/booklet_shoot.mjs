// Shoot a booklet headlessly: vite serves the app, Chromium (Playwright) runs test/booklet.html on a piece list, the HTML is
// saved, then printed to PDF and its first pages screenshotted - so the layout can be looked at without the Studio.
// usage: node test/booklet_shoot.mjs pieces.json [dims=18,16,64] [title] [outdir] [spp for the path-traced cover, 0 = toon]
//   pieces.json comes from `OUT=pieces.json node test/run.mjs model.glb 16` (dims are printed by run.mjs). Needs `npm i -D playwright`
//   (and a Chromium for it); on a machine without a GPU the path-traced cover is minutes per view, so pass a small spp or 0.
import fs from 'fs';
import path from 'path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const [file, dimsArg = '16,16,32', title = 'test model', outdir = 'out/booklet', spp = '24'] = process.argv.slice(2);   // spp 0 = toon cover
if (!file) { console.error('usage: node test/booklet_shoot.mjs pieces.json [dims] [title] [outdir]'); process.exit(1); }
fs.mkdirSync(outdir, { recursive: true });
const served = path.join(outdir, '_pieces.json'); fs.copyFileSync(file, served);

const server = await createServer({ configFile: 'vite.config.js', server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('stage')) console.error('console:', m.text()); });
  const url = `http://localhost:5199/test/booklet.html?pieces=/${served.replace(/\\/g, '/')}&dims=[${dimsArg}]&title=${encodeURIComponent(title)}&spp=${spp}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__booklet, null, { timeout: 900000 });
  const r = await page.evaluate(() => window.__booklet);
  const html = path.join(outdir, 'booklet.html'); fs.writeFileSync(html, r.html);
  console.log(`${r.steps} steps, ${r.pages} pages, ${(r.html.length / 1e6).toFixed(1)} MB, shot in ${(r.ms / 1000).toFixed(1)} s -> ${html}`);
  // print it, and screenshot the cover, the first step page and the parts list
  const p2 = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await p2.goto('file://' + path.resolve(html));
  await p2.pdf({ path: path.join(outdir, 'booklet.pdf'), format: 'A4', landscape: true, printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
  const sheets = await p2.$$('.sheet');
  const want = [0, 1, 2, sheets.length - 2, sheets.length - 1];   // cover, two step pages, the finished model, the parts list
  for (const k of [...new Set(want)]) if (sheets[k]) await sheets[k].screenshot({ path: path.join(outdir, `page${k}.png`) });
  console.log(`pdf + ${Math.min(5, sheets.length)} page shots in ${outdir}/`);
} finally { await browser.close(); await server.close(); }
