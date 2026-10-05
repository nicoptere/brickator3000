// End-to-end: the Studio itself (vite + headless Chromium), a run on a model, then the "instructions" button - so the React side
// of the booklet export is exercised, not only the viewport. Prints every page error / console error.
// usage: node test/studio_booklet.mjs [model substring=hen] [studs=16] [spp=8]
import fs from 'fs';
import path from 'path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const [model = 'hen', studs = '16', spp = '8'] = process.argv.slice(2);
process.env.MODELS_DIR = path.resolve('models');
const server = await createServer({ configFile: 'vite.config.js', server: { port: 5197, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let errors = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  page.on('pageerror', (e) => { errors++; console.error('PAGE ERROR:', e.message.split('\n')[0]); });
  page.on('console', (m) => { if (m.type() === 'error') { errors++; console.error('console error:', m.text().split('\n')[0]); } });
  await page.goto(`http://localhost:5197/#/?model=${model}&studs=${studs}&run=1`);
  // wait for the run: the results panel shows the piece count once `res` is set; the instructions button is enabled then
  const btn = page.getByRole('button', { name: /instructions/ });
  await btn.waitFor({ state: 'visible', timeout: 300000 });
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => /instructions/.test(x.textContent)); return b && !b.disabled; }, null, { timeout: 600000 });
  console.log('run done, exporting the booklet');
  await page.evaluate((n) => { window.__spp = n; window.__coverH = 160; }, +spp);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 900000 }), btn.click()]);
  const out = path.resolve('out/studio_booklet.html'); fs.mkdirSync(path.dirname(out), { recursive: true }); await download.saveAs(out);
  console.log(`booklet saved: ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB), ${errors} errors`);
} finally { await browser.close(); await server.close(); }
process.exit(errors ? 1 : 0);
