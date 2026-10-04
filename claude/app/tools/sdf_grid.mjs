// load an SDF grid written by claude/siren/fit_siren.py (<name>.sdf.json + <name>.sdf.bin) into the `sdfGrid` option
import fs from 'node:fs';
import path from 'node:path';
export function loadSdfGrid(jsonPath) {
  const h = JSON.parse(fs.readFileSync(jsonPath, 'utf8')), b = fs.readFileSync(path.join(path.dirname(jsonPath), h.data));
  const data = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  if (data.length !== h.nx * h.ny * h.nz) throw new Error(`grid size mismatch: ${data.length} floats for ${h.nx}x${h.ny}x${h.nz}`);
  return { nx: h.nx, ny: h.ny, nz: h.nz, origin: h.origin, step: h.step, data, meta: h };
}
