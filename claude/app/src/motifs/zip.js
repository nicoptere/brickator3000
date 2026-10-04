// Tiny zip reader (stored / deflated entries), enough to open BrickLink Studio .io files (a zip holding model.ldr) in Node.
import zlib from 'node:zlib';

/** entries of a zip buffer: [{ name, data: Buffer }] */
export function readZip(buf) {
  const out = [];
  let eocd = buf.length - 22; while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip');
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lh = off, lnlen = buf.readUInt16LE(lh + 26), lelen = buf.readUInt16LE(lh + 28), start = lh + 30 + lnlen + lelen;
    const raw = buf.subarray(start, start + csize);
    out.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : method === 0 ? Buffer.from(raw) : null, method });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

/** LDraw text of a model file: .mpd / .ldr as is, .io (Studio) -> its model.ldr */
export function modelText(file, buf) {
  if (/\.io$/i.test(file)) {
    const e = readZip(buf).find((x) => /^model\.ldr$/i.test(x.name)) || readZip(buf).find((x) => /\.(ldr|mpd)$/i.test(x.name));
    if (!e || !e.data) throw new Error('no model.ldr in ' + file);
    return e.data.toString('latin1');
  }
  return buf.toString('latin1');
}
