// Download the OMR model files listed in docs/omr/index.json that are not yet in docs/omr_gallery (run on a machine with internet).
// usage: node tools/omr_fetch.mjs [--index ../../docs/omr/index.json] [--dir ../../docs/omr_gallery] [--all]
import fs from 'node:fs';
import path from 'node:path';
const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
const index = JSON.parse(fs.readFileSync(arg('index', path.resolve('../../docs/omr/index.json'))));
const dir = arg('dir', path.resolve('../../docs/omr_gallery')); fs.mkdirSync(dir, { recursive: true });
const have = new Set(fs.readdirSync(dir).map((f) => f.toLowerCase()));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const haveNorm = new Set([...have].map((f) => norm(f.replace(/\.mpd$/, ''))));
let n = 0, skipped = 0, failed = [];
for (const set of index) for (const m of set.models) {
  const file = m.file;
  // earlier downloads were saved as <num>_<Set_Name>.mpd for the main model: treat those as present
  const present = have.has(file.toLowerCase()) || haveNorm.has(norm(file.replace(/\.mpd$/, ''))) ||
    (set.models.length === 1 && [...haveNorm].some((h) => h === norm(set.num) || h === norm(set.num + '_' + set.name)));
  if (present && !process.argv.includes('--all')) { skipped++; continue; }
  try {
    const r = await fetch(m.url); if (!r.ok) { failed.push([file, r.status]); continue; }
    fs.writeFileSync(path.join(dir, file), await r.text()); n++; console.log('fetched', file);
  } catch (e) { failed.push([file, String(e)]); }
}
console.log(`${n} fetched, ${skipped} already present, ${failed.length} failed`); if (failed.length) console.log(failed);
