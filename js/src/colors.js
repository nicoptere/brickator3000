// Official LDraw colors + CIE Lab / CIEDE2000 perceptual palette snapping.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function srgbToLin(c) {
  c = Math.max(0, Math.min(1, c));
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linToSrgb(c) {
  c = Math.max(0, Math.min(1, c));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * (c ** (1 / 2.4)) - 0.055;
}

export function rgbToLab([R, G, B]) {
  const r = srgbToLin(R / 255), g = srgbToLin(G / 255), b = srgbToLin(B / 255);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b);
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function ciede2000([L1, a1, b1], [L2, a2, b2]) {
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt((Cb ** 7) / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (b, a) => (b === 0 && a === 0 ? 0 : ((Math.atan2(b, a) * R2D) + 360) % 360);
  const h1p = h(b1, a1p), h2p = h(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
    else dhp = h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * D2R);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let Hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) Hbp = (h1p + h2p) / 2;
    else Hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T = 1 - 0.17 * Math.cos((Hbp - 30) * D2R) + 0.24 * Math.cos(2 * Hbp * D2R)
    + 0.32 * Math.cos((3 * Hbp + 6) * D2R) - 0.20 * Math.cos((4 * Hbp - 63) * D2R);
  const dth = 30 * Math.exp(-(((Hbp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt((Cbp ** 7) / (Cbp ** 7 + 25 ** 7));
  const L50 = (Lbp - 50) ** 2;
  const SL = 1 + (0.015 * L50) / Math.sqrt(20 + L50);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dth * D2R) * RC;
  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
}

export function parseLDConfig(text) {
  const colors = [];
  const re = /^\s*0\s+!COLOUR\s+(\S+)\s+CODE\s+(\d+)\s+VALUE\s+(#[0-9A-Fa-f]{6})\s+EDGE\s+(#[0-9A-Fa-f]{6})(.*)$/;
  for (const line of text.split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m) continue;
    const [, rawName, codeStr, hex, edge, rest] = m;
    const u = rest.toUpperCase();
    if (/ALPHA |MATERIAL |CHROME|PEARL|METAL|RUBBER|LUMINANCE/.test(u)) continue;
    const code = +codeStr;
    if (code === 16 || code === 24 || code === 32 || (code >= 493 && code <= 495)) continue;
    const h = hex.slice(1);
    const rgb = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    colors.push({ code, name: rawName.replace(/_/g, ' '), ldraw_name: rawName, hex: hex.toUpperCase(), edge: edge.toUpperCase(), rgb, lab: rgbToLab(rgb) });
  }
  return colors;
}

// Fallback minimal official subset if no dataset/colors.json is loaded explicitly
export const FALLBACK_COLORS = [
  { code: 0, name: 'Black', hex: '#1B2A34', rgb: [27, 42, 52] },
  { code: 1, name: 'Blue', hex: '#1E5AA8', rgb: [30, 90, 168] },
  { code: 2, name: 'Green', hex: '#00852B', rgb: [0, 133, 43] },
  { code: 4, name: 'Red', hex: '#B40000', rgb: [180, 0, 0] },
  { code: 14, name: 'Yellow', hex: '#FAC80A', rgb: [250, 200, 10] },
  { code: 15, name: 'White', hex: '#F4F4F4', rgb: [244, 244, 244] },
  { code: 19, name: 'Tan', hex: '#DEC69C', rgb: [222, 198, 156] },
  { code: 25, name: 'Orange', hex: '#FE8A18', rgb: [254, 138, 24] },
  { code: 28, name: 'Dark Tan', hex: '#B89869', rgb: [184, 152, 105] },
  { code: 70, name: 'Reddish Brown', hex: '#582A12', rgb: [88, 42, 18] },
  { code: 71, name: 'Light Bluish Gray', hex: '#A0A5A9', rgb: [160, 165, 169] },
  { code: 72, name: 'Dark Bluish Gray', hex: '#6C6E68', rgb: [108, 110, 104] },
].map((c) => ({ ...c, lab: rgbToLab(c.rgb) }));

export function createPalette(colorsJsonOrList = FALLBACK_COLORS) {
  const list = Array.isArray(colorsJsonOrList) ? colorsJsonOrList : (colorsJsonOrList.colors || FALLBACK_COLORS);
  const pal = list.map((c) => ({ ...c, lab: c.lab || rgbToLab(c.rgb) }));
  const cache = new Map();
  const snap = (rgb) => {
    const r = Math.max(0, Math.min(255, Math.round(rgb[0])));
    const g = Math.max(0, Math.min(255, Math.round(rgb[1])));
    const b = Math.max(0, Math.min(255, Math.round(rgb[2])));
    const k = (r << 16) | (g << 8) | b;
    let hit = cache.get(k);
    if (hit) return hit;
    const lab = rgbToLab([r, g, b]);
    let best = pal[0], bd = Infinity;
    for (const c of pal) {
      const d = ciede2000(lab, c.lab);
      if (d < bd) { bd = d; best = c; }
    }
    cache.set(k, best);
    return best;
  };
  return { list: pal, snap };
}
