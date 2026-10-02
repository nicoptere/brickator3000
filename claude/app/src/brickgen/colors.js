// Piece colours: "cheat" colour (mean of the nearest surface samples) or snapped to the LEGO solid palette (CIEDE2000).
import PALETTE from './palette.js';
export { PALETTE };

export function rgbToLab(r, g, b) {
  const lin = (v) => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; };
  const rL = lin(r), gL = lin(g), bL = lin(b);
  const x = (rL * 0.4124564 + gL * 0.3575761 + bL * 0.1804375) / 0.95047;
  const y = rL * 0.2126729 + gL * 0.7151522 + bL * 0.072175;
  const z = (rL * 0.0193339 + gL * 0.119192 + bL * 0.9503041) / 1.08883;
  const f = (t) => (t > 0.008856451679 ? Math.cbrt(t) : 7.787037037 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [Math.max(0, 116 * fy - 16), 500 * (fx - fy), 200 * (fy - fz)];
}

export function ciede2000([L1, a1, b1], [L2, a2, b2]) {
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb7 = Math.pow((C1 + C2) / 2, 7);
  const Gf = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 6103515625)));
  const a1p = (1 + Gf) * a1, a2p = (1 + Gf) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const r2d = 180 / Math.PI, d2r = Math.PI / 180;
  let h1p = Math.atan2(b1, a1p) * r2d; if (h1p < 0) h1p += 360;
  let h2p = Math.atan2(b2, a2p) * r2d; if (h2p < 0) h2p += 360;
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { const d = h2p - h1p; dhp = Math.abs(d) <= 180 ? d : d > 180 ? d - 360 : d + 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * d2r) / 2);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) { const d = Math.abs(h1p - h2p); hbp = d <= 180 ? (h1p + h2p) / 2 : h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * d2r) + 0.24 * Math.cos(2 * hbp * d2r) + 0.32 * Math.cos((3 * hbp + 6) * d2r) - 0.2 * Math.cos((4 * hbp - 63) * d2r);
  const dTh = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2)), Cbp7 = Math.pow(Cbp, 7);
  const RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + 6103515625));
  const SL = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2)), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dTh * d2r) * RC, a = dLp / SL, b = dCp / SC, c = dHp / SH;
  return Math.sqrt(Math.max(0, a * a + b * b + c * c + RT * b * c));
}

const hexRgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
const memo = new Map();
/** nearest LEGO solid colour: { code, name, hex, rgb } */
export function snapToPalette(rgb) {
  const key = rgb.join(','); if (memo.has(key)) return memo.get(key);
  const lab = rgbToLab(...rgb); let best = PALETTE[0], bs = Infinity;
  for (const c of PALETTE) {
    const s = ciede2000(lab, c.lab) - Math.min(0.8, (Math.log10(Math.max(10, c.numSets)) - 1) * 0.2);
    if (s < bs) { bs = s; best = c; }
  }
  const out = { code: best.code, name: best.name, hex: best.hex, rgb: hexRgb(best.hex) }; memo.set(key, out); return out;
}
