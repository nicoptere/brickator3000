import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(process.env.MODELS_DIR || path.join(__dirname, '../../../discretizer/public/models'));
const EXT = /\.(glb|gltf|obj|ply|stl)$/i;

function listModels(dir, base = '') {
  const out = [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name === 'mocs' || e.name === '.git') continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listModels(path.join(dir, e.name), rel));
    else if (EXT.test(e.name)) {
      let size = 0; try { size = fs.statSync(path.join(dir, e.name)).size; } catch {}
      out.push({ path: rel, size });
    }
  }
  return out;
}

const models = listModels(MODELS_DIR).sort((a, b) => a.path.localeCompare(b.path));
const outDir = path.join(__dirname, '../public/models');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const targetFile = path.join(outDir, 'models.json');
fs.writeFileSync(targetFile, JSON.stringify({ models }, null, 2));
console.log(`[build_manifest] Indexed ${models.length} models to ${targetFile}`);
