// Merge several mined motif libraries (tools/mine_motifs.mjs outputs) into one: same key -> counts and model counts add up,
// the part list is kept from the first file that has the key. Writes the merged .json and the motifs.js module next to it.
// usage: node tools/merge_motifs.mjs --out src/motifs/motifs.json a.json b.json [...] [--min 2] [--models 1]
import fs from 'node:fs';
import path from 'node:path';
import { packMotifs } from './pack_motifs.mjs';
const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
const out = arg('out', 'out/motifs_merged.json'), minN = +arg('min', 2), minModels = +arg('models', 1);
const files = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] || '').startsWith('--'));
const acc = new Map(); let models = 0, pieces = 0, windows = 0; const sources = [];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  models += j.models; pieces += j.pieces; windows += j.windows; sources.push({ file: f, source: j.source, models: j.models, motifs: j.motifs.length });
  for (const m of j.motifs) {
    const r = acc.get(m.key);
    if (r) { r.n += m.n; r.models += m.models; if (m.snot) r.snot = true; } else acc.set(m.key, { ...m });
  }
}
const list = [...acc.values()].filter((m) => m.n >= minN && m.models >= minModels).sort((a, b) => b.n - a.n);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ source: sources.map((s) => s.source).join(' + '), sources, snot: true, models, pieces, windows, keys: acc.size, minN, minModels, motifs: list }));
const packed = packMotifs(list, { note: sources.map((s) => `${path.basename(String(s.source))} (${s.models} models)`).join(' + ') });
fs.writeFileSync(path.join(path.dirname(out), 'motifs.js'), packed.text);
console.log(`packed ${packed.kept} motifs into motifs.js (${(packed.text.length / 1e6).toFixed(2)} MB)`);
console.log(`${files.length} libraries, ${models} models, ${acc.size} keys, ${list.length} motifs kept (n >= ${minN}, models >= ${minModels}), ${list.filter((m) => m.snot).length} snot -> ${out}`);
for (const s of sources) console.log(`  ${s.file}: ${s.models} models, ${s.motifs} motifs`);
