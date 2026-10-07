// BrickLink Integration Module for Brickator3000
// Provides:
// 1. Definition and formatting of BrickLink MOC files (.ldr/.mpd and Studio .io container)
// 2. Generation of BrickLink Wanted List XML with authentic color mapping
// 3. Client-side authentication and session state management

import { toLDR, pieceCentre } from './brickgen/export.js';
import { snapToPalette } from './brickgen/colors.js';
import { orientPart, ldrMatrix } from './motifs/orient.js';

/**
 * Authentic mapping from LDraw Color Code -> Official BrickLink Color ID.
 * Based on official LEGO/LDraw/BrickLink color charts.
 */
export const LDRAW_TO_BRICKLINK_COLOR = {
  0: 11,    // Black
  1: 7,     // Blue
  2: 6,     // Green
  3: 39,    // Dark Turquoise
  4: 5,     // Red
  5: 47,    // Dark Pink
  6: 8,     // Brown
  7: 9,     // Light Gray
  8: 10,    // Dark Gray
  9: 15,    // Light Blue
  10: 36,   // Bright Green
  11: 40,   // Light Turquoise
  12: 25,   // Salmon
  13: 23,   // Pink
  14: 3,    // Yellow
  15: 1,    // White
  16: 0,    // (Not Applicable / Any)
  17: 38,   // Light Green
  18: 33,   // Light Yellow
  19: 2,    // Tan
  20: 44,   // Light Violet
  22: 24,   // Purple
  25: 4,    // Orange
  26: 71,   // Magenta
  27: 34,   // Lime
  28: 69,   // Dark Tan
  29: 104,  // Bright Pink
  30: 157,  // Medium Lavender
  31: 154,  // Lavender
  33: 14,   // Trans-Dark Blue
  34: 20,   // Trans-Green
  36: 17,   // Trans-Red
  38: 18,   // Trans-Orange
  40: 13,   // Trans-Black
  41: 108,  // Trans-Medium Blue
  42: 16,   // Trans-Neon Green
  43: 15,   // Trans-Light Blue
  46: 19,   // Trans-Yellow
  47: 12,   // Trans-Clear
  52: 51,   // Trans-Purple
  68: 99,   // Very Light Orange
  69: 93,   // Light Purple
  70: 88,   // Reddish Brown
  71: 86,   // Light Bluish Gray
  72: 85,   // Dark Bluish Gray
  73: 42,   // Medium Blue
  74: 37,   // Medium Green
  77: 103,  // Light Pink
  78: 90,   // Light Nougat
  84: 150,  // Medium Nougat
  85: 89,   // Dark Purple
  86: 91,   // Light Brown
  88: 9,    // Light Gray (legacy)
  89: 97,   // Royal Blue
  92: 28,   // Nougat
  100: 26,  // Light Salmon
  110: 43,  // Violet
  112: 73,  // Medium Bluish Violet
  115: 35,  // Medium Lime
  118: 41,  // Aqua
  120: 35,  // Light Lime
  125: 32,  // Light Orange
  134: 84,  // Copper
  151: 99,  // Very Light Bluish Gray
  158: 158, // Yellowish Green
  178: 81,  // Flat Dark Gold
  179: 95,  // Flat Silver
  191: 110, // Bright Light Orange
  212: 105, // Bright Light Blue
  216: 27,  // Rust
  226: 109, // Bright Light Yellow
  232: 87,  // Sky Blue
  272: 63,  // Dark Blue
  288: 80,  // Dark Green
  297: 115, // Pearl Gold
  308: 120, // Dark Brown
  313: 72,  // Maersk Blue
  320: 59,  // Dark Red
  321: 153, // Dark Azure
  322: 156, // Medium Azure
  323: 152, // Light Aqua
  326: 155, // Olive Green
  335: 58,  // Sand Red
  351: 94,  // Medium Dark Pink
  366: 31,  // Earth Orange
  373: 54,  // Sand Purple
  378: 48,  // Sand Green
  379: 55,  // Sand Blue
  462: 31,  // Medium Orange
  484: 68,  // Dark Orange
  503: 9,   // Very Light Gray
  1001: 73, // Medium Violet
  1050: 220,// Coral
  1051: 159,// Pastel Blue
  1062: 226,// Vibrant Yellow
  1065: 161,// Reddish Gold
  1067: 225,// Dark Nougat
  1088: 160,// Medium Brown
  1089: 228,// Warm Tan
  1091: 167,// Warm Yellowish Orange
  1093: 162,// Light Lilac
  1136: 232,// Reddish Orange
  1137: 165,// Sienna Brown
  1138: 164,// Umber Brown
  1146: 233 // Warm Pink
};

/**
 * Authentic mapping from LDraw Part ID -> Official BrickLink Catalog Item No.
 * LDraw frequently appends sub-part mold letters ('b', 'a') or historical numbers
 * (e.g. 6141 for round plate 1x1, 3062b for round brick, 3070b for 1x1 tile)
 * which BrickLink's Wanted List XML validator rejects if not translated to its canonical Item No.
 */
export const LDRAW_TO_BRICKLINK_PART = {
  // Round plates & bricks
  '6141': '4073',    // Plate, Round 1 x 1 -> 4073
  '30086': '4073',   // Plate, Round 1 x 1
  '3062b': '3062',   // Brick, Round 1 x 1 -> 3062
  '3062a': '3062',
  '3063b': '3063',   // Brick, Curved 2 x 2 Macaroni -> 3063

  // Tiles with groove (LDraw appends 'b', BrickLink uses base number)
  '3070b': '3070',   // Tile 1 x 1 with Groove -> 3070
  '3070a': '3070',
  '3069b': '3069',   // Tile 1 x 2 with Groove -> 3069
  '3069a': '3069',
  '3068b': '3068',   // Tile 2 x 2 with Groove -> 3068
  '3068a': '3068',

  // Slopes with mold variations
  '3747': '3747b',   // Slope, Inverted 33 3 x 2 -> 3747b
  '3747a': '3747b',
  '4032a': '4032',   // Plate, Round 2 x 2 with Axle Hole -> 4032
  '4589': '4589b',   // Cone 1 x 1 -> 4589b
  '3942c': '3942b',  // Cone 2 x 2 x 2 -> 3942b
  '2654a': '2654',   // Plate, Round 2 x 2 Boat Stud -> 2654

  // Columns & Bricks
  '3245a': '3245',   // Brick 1 x 2 x 2 -> 3245
  '3044b': '3044',   // Slope 45 2 x 1 Double -> 3044
  '2453a': '2453b',  // Brick 1 x 1 x 5 (Solid Stud) -> 2453b
  '2436b': '2436',   // Bracket 1 x 2 - 1 x 4 -> 2436
  '2436a': '2436',
  '3684a': '3684',   // Slope 75 2 x 2 x 3 -> 3684
  '3678b': '3678',   // Slope 73 2 x 2 x 2 -> 3678
  '4460b': '4460',   // Slope 75 2 x 1 x 3 -> 4460
  '4460a': '4460',
  '3048b': '3048c',  // Slope 45 2 x 1 Triple -> 3048c
  '3048a': '3048c',
  '3049b': '3049c',  // Slope 45 2 x 1 Double Inverted -> 3049c
  '3049a': '3049c',

  // Panels
  '4865a': '4865',   // Panel 1 x 2 x 1 -> 4865
  '4865b': '4865',   // Panel 1 x 2 x 1 -> 4865
  '4864b': '4864',   // Panel 1 x 2 x 2 -> 4864

  // Wedges
  '41769a': '41769', // Wedge 4 x 2 Right -> 41769
  '41770a': '41770', // Wedge 4 x 2 Left -> 41770
  '43722a': '43722', // Wedge 3 x 2 Right -> 43722
  '43723a': '43723', // Wedge 3 x 2 Left -> 43723
};

/**
 * Resolves the canonical BrickLink Catalog Item No for an LDraw part.
 */
export function getBrickLinkId(rawId) {
  if (!rawId) return '3001';
  const clean = String(rawId).replace(/\.dat$/i, '').trim().toLowerCase();
  if (LDRAW_TO_BRICKLINK_PART[clean]) return LDRAW_TO_BRICKLINK_PART[clean];
  if (clean.length > 2 && /[a-z]$/i.test(clean)) {
    const base = clean.slice(0, -1);
    if (LDRAW_TO_BRICKLINK_PART[base]) return LDRAW_TO_BRICKLINK_PART[base];
    return base;
  }
  return clean;
}

/**
 * Resolves the BrickLink Color ID for a piece.
 * If piece has direct RGB (cheat mode), snaps to nearest LEGO palette color first.
 */
export function getBrickLinkColor(piece) {
  let ldrCode = piece.code !== undefined ? piece.code : piece.color;
  if (ldrCode === undefined || ldrCode >= 0x2000000) {
    const snapped = snapToPalette(piece.rgb || [200, 200, 200]);
    ldrCode = snapped.code;
  }
  return LDRAW_TO_BRICKLINK_COLOR[ldrCode] !== undefined ? LDRAW_TO_BRICKLINK_COLOR[ldrCode] : 0;
}

/**
 * Formal definition and technical specification of a MOC file on BrickLink.
 */
export const MOC_DEFINITION = {
  title: 'BrickLink MOC & Studio File Specification',
  summary:
    'A MOC ("My Own Creation") is an original custom LEGO model designed by an independent builder. On BrickLink and BrickLink Studio, MOCs are authored and exchanged as either formatted LDraw files (.ldr / .mpd) with step delimiters or BrickLink Studio container archives (.io).',
  formats: [
    {
      name: 'LDraw MOC (.ldr / .mpd)',
      description:
        'Standard plaintext LEGO CAD specification with official category headers and step breaks (0 STEP). Can be opened directly in BrickLink Studio (File > Open / Import) and uploaded to BrickLink Wanted Lists.',
    },
    {
      name: 'BrickLink Studio Package (.io)',
      description:
        'Official compressed ZIP container used natively by BrickLink Studio. Strictly packages model.ldr (Type-1 parts), modelv2.ldr (Studio v2 Type-11 parts with 6-decimal precision and sequential UIDs), and optional 3D thumbnail preview.',
    },
  ],
  usage: [
    'Open directly in BrickLink Studio (Studio 2.0) via File > Open to inspect, render, and order pieces.',
    'Both .io and .ldr can be imported into Studio or uploaded directly to BrickLink Wanted Lists.',
    'Submit to the BrickLink Studio Gallery (https://www.bricklink.com/v3/studio/gallery.page) to publish and share with the AFOL community.',
  ],
};

const rotY = (deg) => {
  const t = (deg * Math.PI) / 180,
    c = Math.round(Math.cos(t)),
    s = Math.round(Math.sin(t));
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};

const mul3 = (A, B) => {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    }
  }
  return o;
};

const TURNi = rotY(-90);

function getPiecePlacement(p, c) {
  if (!c || (!c.cover && !c.top)) {
    const w = p.w || (c && c.w) || 1;
    const d = p.d || (c && c.d) || 1;
    const h = p.h || (c && c.h) || 1;
    const rot = ((((p.rot || 0) % 360) + 360) % 360);
    const Rld = rotY(rot);
    const M = ldrMatrix(Rld);
    const ctr = [(p.i + w / 2) * 20, (p.b + h / 2) * 8, (p.j + d / 2) * 20];
    const t = [ctr[0], -ctr[1], -ctr[2]];
    return { t, M };
  }
  const ori = p.ori !== undefined ? p.ori : Math.round((((p.rot % 360) + 360) % 360) / 90);
  const ob = orientPart(c, ori);
  const Rld = c.source === 'analytic' && c.w !== c.d ? mul3(ob.R, TURNi) : ob.R;
  const M = ldrMatrix(Rld);
  const ctr = pieceCentre({ ...p, w: ob.w, d: ob.d, h: ob.h });
  const r = [ctr[0] + ob.origin[0], ctr[1] + ob.origin[1], ctr[2] + ob.origin[2]];
  const t = [r[0], -r[1], -r[2]];
  return { t, M };
}

function generateFallbackPartGeometry(blItemId, catEntry) {
  const w = (catEntry && catEntry.w) || 1;
  const d = (catEntry && catEntry.d) || 1;
  const h = (catEntry && catEntry.h) || (blItemId.startsWith('302') ? 1 : 3);
  const x0 = -w * 10, x1 = w * 10;
  const z0 = -d * 10, z1 = d * 10;
  const yTop = 0;
  const yBot = h * 8; // Y points down in LDraw coordinate system

  const lines = [
    `0 Fallback geometry for ${blItemId}`,
    `0 Name: ${blItemId}.dat`,
    '0 Author: Brickator',
    '0 IsSubModel False',
    // 6 quads forming the rectangular brick body
    `4 16 ${x0} ${yTop} ${z0} ${x0} ${yTop} ${z1} ${x1} ${yTop} ${z1} ${x1} ${yTop} ${z0}`,
    `4 16 ${x0} ${yBot} ${z0} ${x1} ${yBot} ${z0} ${x1} ${yBot} ${z1} ${x0} ${yBot} ${z1}`,
    `4 16 ${x0} ${yTop} ${z1} ${x1} ${yTop} ${z1} ${x1} ${yBot} ${z1} ${x0} ${yBot} ${z1}`,
    `4 16 ${x1} ${yTop} ${z0} ${x0} ${yTop} ${z0} ${x0} ${yBot} ${z0} ${x1} ${yBot} ${z0}`,
    `4 16 ${x0} ${yTop} ${z0} ${x0} ${yTop} ${z1} ${x0} ${yBot} ${z1} ${x0} ${yBot} ${z0}`,
    `4 16 ${x1} ${yTop} ${z1} ${x1} ${yTop} ${z0} ${x1} ${yBot} ${z0} ${x1} ${yBot} ${z1}`,
  ];

  // Add top studs
  for (let ix = 0; ix < w; ix++) {
    for (let iz = 0; iz < d; iz++) {
      const sx = x0 + 10 + ix * 20;
      const sz = z0 + 10 + iz * 20;
      lines.push(`1 16 ${sx} 0 ${sz} 1 0 0 0 1 0 0 0 1 stud.dat`);
    }
  }

  return lines.join('\n');
}

function getValidLDrawColor(p) {
  let code = p.code !== undefined ? p.code : p.color;
  if (code === undefined || code >= 0x2000000) {
    const snapped = snapToPalette(p.rgb || [200, 200, 200]);
    code = snapped.code;
  }
  return code;
}

/**
 * Official LEGO Color ID lookup for LEGO Digital Designer / Studio LXFML XML files.
 */
export const LDRAW_TO_LEGO_COLOR_ID = {
  0: 26,     // Black
  1: 23,     // Bright Blue (Blue)
  2: 28,     // Dark Green (Green)
  3: 107,    // Dark Turquoise
  4: 21,     // Bright Red (Red)
  5: 221,    // Dark Pink
  6: 217,    // Brown
  7: 2,      // Light Gray
  8: 27,     // Dark Gray
  9: 212,    // Light Blue
  10: 119,   // Bright Green
  14: 24,    // Bright Yellow (Yellow)
  15: 1,     // White
  19: 5,     // Brick Yellow (Tan)
  25: 106,   // Bright Orange (Orange)
  26: 124,   // Bright Reddish Violet (Magenta)
  27: 119,   // Bright Yellowish Green (Lime)
  28: 138,   // Sand Yellow (Dark Tan)
  70: 192,   // Reddish Brown
  71: 194,   // Medium Stone Grey (Light Bluish Gray)
  72: 199,   // Dark Stone Grey (Dark Bluish Gray)
  78: 283,   // Light Nougat
  84: 312,   // Medium Nougat
  85: 268,   // Medium Lilac (Dark Purple)
  86: 217,   // Light Brown
  92: 18,    // Nougat
  178: 297,  // Flat Dark Gold
  179: 131,  // Silver (Flat Silver)
  191: 191,  // Bright Light Orange
  226: 226,  // Cool Yellow (Bright Light Yellow)
  272: 140,  // Earth Blue (Dark Blue)
  308: 308,  // Dark Brown
  320: 154,  // Dark Red
  321: 321,  // Dark Azure
  322: 322,  // Medium Azure
  323: 323,  // Light Aqua
  326: 326,  // Olive Green
  378: 151,  // Sand Green
  379: 135,  // Sand Blue
  1050: 353, // Coral
  1088: 312, // Medium Brown
  1089: 138, // Warm Tan
};

export function getLegoColorId(piece) {
  const ldrCode = getValidLDrawColor(piece);
  if (LDRAW_TO_LEGO_COLOR_ID[ldrCode] !== undefined) return LDRAW_TO_LEGO_COLOR_ID[ldrCode];
  const blColor = getBrickLinkColor(piece);
  return blColor || 194;
}

/**
 * Formats a discretized LEGO model into an official BrickLink MOC (.ldr) file.
 * Includes official BrickLink headers, category declarations, layer step breaks,
 * and canonical BrickLink Catalog Item numbers.
 */
export function toBrickLinkMOC(pieces, cat = [], name = 'Brickator_MOC', { author = 'Brickator 3000' } = {}) {
  const safeName = (name || 'Brickator_MOC').replace(/\.[^.]+$/, '');
  const sorted = [...pieces].sort((a, b) => a.b - b.b || a.i - b.i || a.j - b.j);
  const by = {};
  for (const c of cat) by[c.id] = c;

  // Group by level (plate height) to create step-by-step building instructions
  const headerLines = [
    `0 ${safeName}`,
    `0 Name: ${safeName}.ldr`,
    `0 Author: ${author}`,
    '0 !CATEGORY MOC',
    '0 !HELP Generated by Brickator 3000 (Universal LEGO Discretization Engine)',
    '0 BFC CERTIFY CCW',
  ];

  const bodyLines = [];
  let currentLevel = -1;

  for (const p of sorted) {
    if (p.b !== currentLevel) {
      if (currentLevel !== -1) bodyLines.push('0 STEP');
      currentLevel = p.b;
    }
    const c = by[p.id] || { id: p.id, w: p.w || 1, d: p.d || 1, h: p.h || 1, origin: [0, 0, 0], source: 'analytic' };
    const { t, M } = getPiecePlacement(p, c);
    const colorCode = getValidLDrawColor(p);
    const blItemId = getBrickLinkId(p.id);
    bodyLines.push(`1 ${colorCode} ${t[0].toFixed(1)} ${t[1].toFixed(1)} ${t[2].toFixed(1)} ${M.map((x) => +x.toFixed(4)).join(' ')} ${blItemId}.dat`);
  }

  bodyLines.push('0 STEP');
  return [...headerLines, ...bodyLines].join('\n') + '\n';
}

/** Pre-computed CRC32 table for pure-JS PKZIP generation */
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c;
}

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function getDosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

async function deflateData(bytes) {
  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('deflate-raw');
      const writer = cs.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const reader = cs.readable.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const total = chunks.reduce((acc, c) => acc + c.length, 0);
      const out = new Uint8Array(total);
      let p = 0;
      for (const ch of chunks) {
        out.set(ch, p);
        p += ch.length;
      }
      return { data: out, method: 8 };
    } catch (e) {
      console.warn('CompressionStream deflate failed, falling back to stored:', e);
    }
  }
  return { data: bytes, method: 0 };
}

/**
 * Creates a valid PKZIP binary archive with standard DEFLATE compression (Method 8).
 * Fully compatible with BrickLink Studio and standard ZIP extractors.
 */
async function createZip(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;
  const { time, date } = getDosDateTime();

  for (const file of files) {
    const uncompressed = typeof file.data === 'string' ? new TextEncoder().encode(file.data) : file.data;
    const { data: compressed, method } = await deflateData(uncompressed);
    const nameBytes = new TextEncoder().encode(file.name);
    const crc = crc32(uncompressed);
    const uncompressedSize = uncompressed.length;
    const compressedSize = compressed.length;

    // Local file header (30 bytes + filename)
    const lh = new Uint8Array(30 + nameBytes.length);
    const dvL = new DataView(lh.buffer);
    dvL.setUint32(0, 0x04034b50, true);
    dvL.setUint16(4, 20, true);     // version needed to extract (2.0)
    dvL.setUint16(6, 0, true);      // general purpose bit flag
    dvL.setUint16(8, method, true); // compression method (8 = deflate, 0 = stored)
    dvL.setUint16(10, time, true);
    dvL.setUint16(12, date, true);
    dvL.setUint32(14, crc, true);
    dvL.setUint32(18, compressedSize, true);
    dvL.setUint32(22, uncompressedSize, true);
    dvL.setUint16(26, nameBytes.length, true);
    dvL.setUint16(28, 0, true);     // extra field length
    lh.set(nameBytes, 30);
    localHeaders.push({ header: lh, data: compressed, offset });

    // Central directory header (46 bytes + filename)
    const ch = new Uint8Array(46 + nameBytes.length);
    const dvC = new DataView(ch.buffer);
    dvC.setUint32(0, 0x02014b50, true);
    dvC.setUint16(4, 20, true);     // version made by
    dvC.setUint16(6, 20, true);     // version needed to extract
    dvC.setUint16(8, 0, true);      // flags
    dvC.setUint16(10, method, true);
    dvC.setUint16(12, time, true);
    dvC.setUint16(14, date, true);
    dvC.setUint32(16, crc, true);
    dvC.setUint32(20, compressedSize, true);
    dvC.setUint32(24, uncompressedSize, true);
    dvC.setUint16(28, nameBytes.length, true);
    dvC.setUint16(30, 0, true);     // extra field length
    dvC.setUint16(32, 0, true);     // file comment length
    dvC.setUint16(34, 0, true);     // disk number start
    dvC.setUint16(36, 0, true);     // internal file attributes
    dvC.setUint32(38, 0, true);     // external file attributes
    dvC.setUint32(42, offset, true); // relative offset of local header
    ch.set(nameBytes, 46);
    centralHeaders.push(ch);

    offset += lh.length + compressedSize;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const ch of centralHeaders) centralDirSize += ch.length;

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const dvE = new DataView(eocd.buffer);
  dvE.setUint32(0, 0x06054b50, true);
  dvE.setUint16(4, 0, true);      // disk number
  dvE.setUint16(6, 0, true);      // disk with central dir
  dvE.setUint16(8, files.length, true); // total entries on this disk
  dvE.setUint16(10, files.length, true); // total entries
  dvE.setUint32(12, centralDirSize, true);
  dvE.setUint32(16, centralDirOffset, true);
  dvE.setUint16(20, 0, true);     // comment length

  const totalLength = centralDirOffset + centralDirSize + eocd.length;
  const out = new Uint8Array(totalLength);
  let p = 0;
  for (const lh of localHeaders) {
    out.set(lh.header, p);
    p += lh.header.length;
    out.set(lh.data, p);
    p += lh.data.length;
  }
  for (const ch of centralHeaders) {
    out.set(ch, p);
    p += ch.length;
  }
  out.set(eocd, p);
  return out;
}

function generateUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const FALLBACK_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAmklEQVR4nO3QMRHAIADAQEAIAyv+9RUZPzSvIJe5z/3Gjy0doDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA1gAdoDVAB2gN0AFaA3SA9gAsJgHqpfqZlQAAAABJRU5ErkJggg==';

function getFallbackThumbnailBytes() {
  const binary = atob(FALLBACK_PNG_B64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Packages all MOC presentation materials:
 * - Cover hero image
 * - Building step illustration renders (isometric captures)
 * - Self-contained printable building booklet HTML
 * into a single ZIP archive for publishing to BrickLink Studio Gallery or sharing.
 */
export async function toMocIllustrationsZip({ title = 'model', cover = null, images = [], html = null } = {}) {
  const files = [];
  const safeName = (title || 'model').replace(/\.[^.]+$/, '');

  if (cover && cover.startsWith('data:image/png;base64,')) {
    try {
      const base64 = cover.split(',')[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      files.push({ name: `${safeName}_cover_hero.png`, data: bytes });
    } catch (e) {
      console.warn('Failed to parse cover image for illustrations zip:', e);
    }
  }

  images.forEach((imgUrl, idx) => {
    if (imgUrl && imgUrl.startsWith('data:image/png;base64,')) {
      try {
        const base64 = imgUrl.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const stepNum = String(idx + 1).padStart(3, '0');
        files.push({ name: `steps/step_${stepNum}.png`, data: bytes });
      } catch (e) {
        console.warn(`Failed to parse step image ${idx} for illustrations zip:`, e);
      }
    }
  });

  if (html) {
    files.push({ name: `${safeName}_instructions.html`, data: html });
  }

  return await createZip(files);
}

/**
 * Packages a discretized LEGO model into an authentic BrickLink Studio container (.io) file.
 * Strictly adheres to BrickLink Studio specifications:
 * - model.ldr: standard LDraw Type-1 lines with LDraw colors, step markers, and Studio directives
 * - model.lxfml: LEGO Digital Designer / Studio XML brick definitions with UUIDs, materials, and BuildingInstructions
 * - modelv2.ldr: Studio v2 format with Type-11 lines (sequential UID, 6-decimal floats)
 * - model2.ldr: Studio sub-model format using BrickLink Color IDs
 * - thumbnail.png: embedded 3D preview snapshot (Hero cover image)
 * - errorPartList.err: empty JSON array indicating no missing custom parts
 * - .info: mandatory Studio JSON metadata with version, total_parts, and parts_db_version
 */
export async function toBrickLinkStudioContainer(pieces, cat = [], name = 'Brickator_MOC', {
  author = 'Brickator 3000',
  snapshotDataUrl = null,
  stepsData = null,
  stepImages = null,
} = {}) {
  const safeName = (name || 'Brickator_MOC').replace(/\.[^.]+$/, '');
  const cleanAuthor = author || 'Brickator 3000';
  const numOfBricks = pieces.length;
  const by = {};
  for (const c of cat) by[c.id] = c;

  // Official BrickLink Studio header directives
  const ldrHeader = [
    `0 FILE ${safeName}`,
    '0 Untitled Model',
    `0 Name: ${safeName}`,
    `0 Author: ${cleanAuthor}`,
    '0 CustomBrick',
    `0 NumOfBricks ${numOfBricks}`,
  ];

  const m2Header = [
    `0 FILE ${safeName}`,
    '0 Untitled Model',
    `0 Name: ${safeName}`,
    `0 Author: ${cleanAuthor}`,
    '0 IsSubModel True',
    '0 CustomBrick',
    `0 NumOfBricks ${numOfBricks}`,
  ];

  const v2Header = [
    `0 FILE ${safeName}`,
    '0 Untitled Model',
    `0 Name: ${safeName}`,
    `0 Author: ${cleanAuthor}`,
    '0 CustomBrick',
    `0 NumOfBricks ${numOfBricks}`,
  ];

  const ldrBody = [];
  const m2Body = [];
  const v2Body = [];
  const lxfmlBricks = [];
  let uid = 1;

  // Pre-generate piece UUIDs so LXFML Bricks and BuildingInstructions share matching references
  const pieceUuids = pieces.map(() => generateUuid());
  const hasSteps = stepsData && Array.isArray(stepsData) && stepsData.length > 0;

  if (hasSteps) {
    for (let sIdx = 0; sIdx < stepsData.length; sIdx++) {
      const stepObj = stepsData[sIdx];
      const indices = stepObj.idx || [];
      for (const n of indices) {
        const p = pieces[n];
        if (!p) continue;
        const c = by[p.id] || { id: p.id, w: p.w || 1, d: p.d || 1, h: p.h || 1, origin: [0, 0, 0], source: 'analytic' };
        const { t, M } = getPiecePlacement(p, c);
        const ldrColor = getValidLDrawColor(p);
        const blColor = getBrickLinkColor(p);
        const legoColor = getLegoColorId(p);
        const blItemId = getBrickLinkId(p.id);

        const x6 = t[0].toFixed(6), y6 = t[1].toFixed(6), z6 = t[2].toFixed(6);
        const m6Arr = M.map((v) => Number(v.toFixed(6)));
        const m6Str = m6Arr.map((v) => v.toFixed(6)).join(' ');

        // 1. model.ldr (Standard LDraw Type-1 line)
        ldrBody.push(`1 ${ldrColor} ${x6} ${y6} ${z6} ${m6Str} ${blItemId}.dat`);

        // 2. model2.ldr (BrickLink Studio Type-1 line using BrickLink Color IDs)
        m2Body.push(`1 ${blColor} ${x6} ${y6} ${z6} ${m6Str} ${blItemId}.dat`);

        // 3. modelv2.ldr (Studio v2 Type-11 line with sequential UID)
        v2Body.push(`11 ${ldrColor} ${uid++} False 0 ${x6} ${y6} ${z6} ${m6Str} ${blItemId}.dat`);

        // 4. model.lxfml (LEGO Digital Designer / Studio XML Brick definition)
        const brickUuid = pieceUuids[n];
        const partUuid = generateUuid();
        const boneUuid = generateUuid();
        const lx = (t[0] * 0.04).toFixed(6);
        const ly = (-t[1] * 0.04).toFixed(6);
        const lz = (-t[2] * 0.04).toFixed(6);
        const tf = `${m6Arr.map((v) => v.toFixed(6)).join(',')},${lx},${ly},${lz}`;
        lxfmlBricks.push(
          `    <Brick designID="${blItemId}" uuid="${brickUuid}">\n` +
          `      <Part uuid="${partUuid}" designID="${blItemId}" partType="rigid" materials="${legoColor}:0">\n` +
          `        <Bone uuid="${boneUuid}" transformation="${tf}" />\n` +
          `      </Part>\n` +
          `    </Brick>`
        );
      }
      ldrBody.push('0 STEP');
      m2Body.push('0 STEP');
      v2Body.push('0 STEP');
    }
  } else {
    const sorted = [...pieces].sort((a, b) => a.b - b.b || a.i - b.i || a.j - b.j);
    let currentLevel = -1;
    for (let k = 0; k < sorted.length; k++) {
      const p = sorted[k];
      if (p.b !== currentLevel) {
        if (currentLevel !== -1) {
          ldrBody.push('0 STEP');
          m2Body.push('0 STEP');
          v2Body.push('0 STEP');
        }
        currentLevel = p.b;
      }

      const c = by[p.id] || { id: p.id, w: p.w || 1, d: p.d || 1, h: p.h || 1, origin: [0, 0, 0], source: 'analytic' };
      const { t, M } = getPiecePlacement(p, c);
      const ldrColor = getValidLDrawColor(p);
      const blColor = getBrickLinkColor(p);
      const legoColor = getLegoColorId(p);
      const blItemId = getBrickLinkId(p.id);

      const x6 = t[0].toFixed(6), y6 = t[1].toFixed(6), z6 = t[2].toFixed(6);
      const m6Arr = M.map((v) => Number(v.toFixed(6)));
      const m6Str = m6Arr.map((v) => v.toFixed(6)).join(' ');

      // 1. model.ldr (Standard LDraw Type-1 line)
      ldrBody.push(`1 ${ldrColor} ${x6} ${y6} ${z6} ${m6Str} ${blItemId}.dat`);

      // 2. model2.ldr (BrickLink Studio Type-1 line using BrickLink Color IDs)
      m2Body.push(`1 ${blColor} ${x6} ${y6} ${z6} ${m6Str} ${blItemId}.dat`);

      // 3. modelv2.ldr (Studio v2 Type-11 line with sequential UID)
      v2Body.push(`11 ${ldrColor} ${uid++} False 0 ${x6} ${y6} ${z6} ${m6Str} ${blItemId}.dat`);

      // 4. model.lxfml (LEGO Digital Designer / Studio XML Brick definition)
      const brickUuid = pieceUuids[k] || generateUuid();
      const partUuid = generateUuid();
      const boneUuid = generateUuid();
      const lx = (t[0] * 0.04).toFixed(6);
      const ly = (-t[1] * 0.04).toFixed(6);
      const lz = (-t[2] * 0.04).toFixed(6);
      const tf = `${m6Arr.map((v) => v.toFixed(6)).join(',')},${lx},${ly},${lz}`;
      lxfmlBricks.push(
        `    <Brick designID="${blItemId}" uuid="${brickUuid}">\n` +
        `      <Part uuid="${partUuid}" designID="${blItemId}" partType="rigid" materials="${legoColor}:0">\n` +
        `        <Bone uuid="${boneUuid}" transformation="${tf}" />\n` +
        `      </Part>\n` +
        `    </Brick>`
      );
    }
  }

  ldrBody.push('0 NOFILE');
  m2Body.push('0 NOFILE');
  v2Body.push('0 NOFILE');

  // Collect all unique part IDs used in the model
  const uniquePartIds = [...new Set(pieces.map((p) => getBrickLinkId(p.id)))];
  let inlinedPartsMap = {};

  try {
    const res = await fetch('/api/ldraw/resolve-bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partIds: uniquePartIds }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json && json.parts) {
        inlinedPartsMap = json.parts;
      }
    }
  } catch (e) {
    console.warn('LDraw bundle resolver not reachable, using synthetic geometry fallback:', e);
  }

  // Ensure every part ID has at least a fallback geometry so getMeshes in MOCViewer.js never fails
  for (const pId of uniquePartIds) {
    const fn = `${pId.toLowerCase()}.dat`;
    if (!inlinedPartsMap[fn]) {
      const catEntry = by[pId] || pieces.find((p) => getBrickLinkId(p.id) === pId);
      inlinedPartsMap[fn] = generateFallbackPartGeometry(pId, catEntry);
    }
  }

  if (!inlinedPartsMap['stud.dat']) {
    inlinedPartsMap['stud.dat'] = [
      '0 Stud Fallback',
      '0 Name: stud.dat',
      '0 Author: Brickator',
      '0 IsSubModel False',
      '4 16 -6 -4 -6 6 -4 -6 6 -4 6 -6 -4 6',
      '4 16 -6 0 6 6 0 6 6 -4 6 -6 -4 6',
      '4 16 6 0 -6 -6 0 -6 -6 -4 -6 6 -4 -6',
      '4 16 -6 0 -6 -6 0 6 -6 -4 6 -6 -4 -6',
      '4 16 6 0 6 6 0 -6 6 -4 -6 6 -4 6',
    ].join('\n');
  }

  // Append inlined part definitions to model2.ldr
  const m2InlinedParts = [];
  const seenPartNames = new Set();
  for (const [fn, rawContent] of Object.entries(inlinedPartsMap)) {
    const cleanFn = fn.replace(/\\/g, '/').toLowerCase();
    if (seenPartNames.has(cleanFn)) continue;
    seenPartNames.add(cleanFn);

    let content = (rawContent || '').trim();
    if (!content.startsWith('0 FILE')) {
      content = `0 FILE ${cleanFn}\n${content}`;
    }
    if (!content.endsWith('0 NOFILE')) {
      content = `${content}\n0 NOFILE`;
    }
    m2InlinedParts.push(content);

    // Also register base filename alias if fn contained subdirectories (e.g. s/3024s01.dat -> 3024s01.dat)
    if (cleanFn.includes('/')) {
      const bn = cleanFn.split('/').pop();
      if (!seenPartNames.has(bn)) {
        seenPartNames.add(bn);
        let bnContent = (rawContent || '').trim();
        if (!bnContent.startsWith('0 FILE')) {
          bnContent = `0 FILE ${bn}\n${bnContent}`;
        }
        if (!bnContent.endsWith('0 NOFILE')) {
          bnContent = `${bnContent}\n0 NOFILE`;
        }
        m2InlinedParts.push(bnContent);
      }
    }
  }

  // Text files in BrickLink Studio .io containers start with UTF-8 BOM (\ufeff)
  const BOM = '\ufeff';
  const modelLdrContent = BOM + [...ldrHeader, ...ldrBody].join('\n') + '\n';
  const model2LdrContent = BOM + [...m2Header, ...m2Body, ...m2InlinedParts].join('\n') + '\n';
  const modelv2LdrContent = BOM + [...v2Header, ...v2Body].join('\n') + '\n';

  let buildingInstructionsXml = '';
  if (hasSteps) {
    const instructionUuid = generateUuid();
    const stepXml = stepsData
      .map((s) => {
        const stepUuid = generateUuid();
        const ins = (s.idx || []).map((n) => `        <In brickRef="${pieceUuids[n]}" />`).join('\n');
        return `      <Step uuid="${stepUuid}">\n${ins}\n      </Step>`;
      })
      .join('\n');
    buildingInstructionsXml =
      `  <BuildingInstructions>\n` +
      `    <BuildingInstruction uuid="${instructionUuid}">\n` +
      `      <Steps>\n${stepXml}\n      </Steps>\n` +
      `    </BuildingInstruction>\n` +
      `  </BuildingInstructions>\n`;
  }

  const modelLxfmlContent =
    BOM +
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<LXFML versionMajor="9" versionMinor="0" versionPatch="0">\n' +
    '  <Bricks>\n' +
    lxfmlBricks.join('\n') + '\n' +
    '  </Bricks>\n' +
    buildingInstructionsXml +
    '</LXFML>\n';

  const errorPartListContent = '[]';
  const infoContent = JSON.stringify({
    version: '2.26.8_1',
    total_parts: numOfBricks,
    parts_db_version: 238,
  });

  // Embedded viewport thumbnail PNG (Hero cover image from booklet or snapshot)
  let thumbnailBytes = null;
  if (snapshotDataUrl && snapshotDataUrl.startsWith('data:image/png;base64,')) {
    try {
      const base64 = snapshotDataUrl.split(',')[1];
      const binary = atob(base64);
      thumbnailBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) thumbnailBytes[i] = binary.charCodeAt(i);
    } catch (e) {
      console.warn('Failed to parse snapshotDataUrl for thumbnail.png:', e);
    }
  }
  if (!thumbnailBytes) {
    thumbnailBytes = getFallbackThumbnailBytes();
  }

  // Official BrickLink Studio .io package layout (all 7 required files)
  const files = [
    { name: 'model.ldr', data: modelLdrContent },
    { name: 'model.lxfml', data: modelLxfmlContent },
    { name: 'modelv2.ldr', data: modelv2LdrContent },
    { name: 'model2.ldr', data: model2LdrContent },
    { name: 'thumbnail.png', data: thumbnailBytes },
    { name: 'errorPartList.err', data: errorPartListContent },
    { name: '.info', data: infoContent },
  ];

  return await createZip(files);
}

/**
 * Generates an official BrickLink Wanted List XML document from the pieces array.
 * Converts every piece's color into authentic BrickLink Color IDs and groups quantities.
 */
export function toBrickLinkWantedListXML(pieces, { condition = 'X' } = {}) {
  const counts = new Map();

  for (const p of pieces) {
    const blColor = getBrickLinkColor(p);
    const blItemId = getBrickLinkId(p.id);
    const key = `${blItemId}|${blColor}`;
    const cur = counts.get(key) || { itemId: blItemId, color: blColor, count: 0 };
    cur.count++;
    counts.set(key, cur);
  }

  const lines = [
    '<INVENTORY>',
  ];

  for (const item of counts.values()) {
    lines.push('  <ITEM>');
    lines.push('    <ITEMTYPE>P</ITEMTYPE>');
    lines.push(`    <ITEMID>${item.itemId}</ITEMID>`);
    lines.push(`    <COLOR>${item.color}</COLOR>`);
    lines.push(`    <MINQTY>${item.count}</MINQTY>`);
    lines.push(`    <CONDITION>${condition}</CONDITION>`);
    lines.push('  </ITEM>');
  }

  lines.push('</INVENTORY>');
  return lines.join('\n');
}

/**
 * Attempts connection / login to BrickLink via the local backend proxy.
 */
export async function loginBrickLink({ username, password, sessionCookie }) {
  try {
    const res = await fetch('/api/bricklink/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, sessionCookie }),
    });
    return await res.json();
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
}

/**
 * Fetches user's Wanted Lists via the local backend proxy.
 */
export async function fetchWantedLists(sessionCookie) {
  try {
    const res = await fetch('/api/bricklink/wanted-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionCookie }),
    });
    return await res.json();
  } catch (e) {
    return { success: false, wantedLists: [], error: String(e.message || e) };
  }
}

/**
 * Uploads parts list XML to BrickLink Wanted List via backend proxy.
 */
export async function uploadWantedList({ name, xml, sessionCookie }) {
  try {
    const res = await fetch('/api/bricklink/wanted-list/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, xml, sessionCookie }),
    });
    return await res.json();
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
}
