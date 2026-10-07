// LEGO Pick a Brick (PaB) Integration Module for Brickator3000
// Generates official Pick a Brick CSV lists and BrickHunter cart payloads for direct ordering from LEGO.com

import PALETTE from './brickgen/palette.js';
import { snapToPalette } from './brickgen/colors.js';
import { getBrickLinkId } from './bricklink.js';

// Lookup map from LDraw color code -> official LEGO Color Name
export const LDRAW_TO_LEGO_COLOR_NAME = {};
for (const p of PALETTE) {
  LDRAW_TO_LEGO_COLOR_NAME[p.code] = p.name;
}

// Common official LEGO 6-digit Element IDs for high-frequency parts and colors
// [DesignID_ColorCode]: ElementID
export const KNOWN_ELEMENT_IDS = {
  // 3001 (Brick 2x4)
  '3001_15': '300101',  // White
  '3001_0':  '300126',  // Black
  '3001_4':  '300121',  // Red
  '3001_1':  '300123',  // Blue
  '3001_14': '300124',  // Yellow
  '3001_2':  '300128',  // Green
  '3001_71': '4211387', // Light Bluish Gray
  '3001_72': '4211085', // Dark Bluish Gray
  '3001_70': '4211186', // Reddish Brown
  '3001_19': '4114084', // Tan

  // 3003 (Brick 2x2)
  '3003_15': '300301',  // White
  '3003_0':  '300326',  // Black
  '3003_4':  '300321',  // Red
  '3003_1':  '300323',  // Blue
  '3003_14': '300324',  // Yellow
  '3003_71': '4211388', // Light Bluish Gray
  '3003_72': '4211052', // Dark Bluish Gray

  // 3004 (Brick 1x2)
  '3004_15': '300401',  // White
  '3004_0':  '300426',  // Black
  '3004_4':  '300421',  // Red
  '3004_1':  '300423',  // Blue
  '3004_14': '300424',  // Yellow
  '3004_71': '4211385', // Light Bluish Gray
  '3004_72': '4211053', // Dark Bluish Gray

  // 3005 (Brick 1x1)
  '3005_15': '300501',  // White
  '3005_0':  '300526',  // Black
  '3005_4':  '300521',  // Red
  '3005_1':  '300523',  // Blue
  '3005_14': '300524',  // Yellow
  '3005_71': '4211415', // Light Bluish Gray
  '3005_72': '4210719', // Dark Bluish Gray

  // 3020 (Plate 2x4)
  '3020_15': '302001',  // White
  '3020_0':  '302026',  // Black
  '3020_4':  '302021',  // Red
  '3020_1':  '302023',  // Blue
  '3020_14': '302024',  // Yellow
  '3020_71': '4211395', // Light Bluish Gray
  '3020_72': '4211055', // Dark Bluish Gray

  // 3022 (Plate 2x2)
  '3022_15': '302201',  // White
  '3022_0':  '302226',  // Black
  '3022_4':  '302221',  // Red
  '3022_1':  '302223',  // Blue
  '3022_14': '302224',  // Yellow
  '3022_71': '4211397', // Light Bluish Gray
  '3022_72': '4211056', // Dark Bluish Gray

  // 3023 (Plate 1x2)
  '3023_15': '302301',  // White
  '3023_0':  '302326',  // Black
  '3023_4':  '302321',  // Red
  '3023_1':  '302323',  // Blue
  '3023_14': '302324',  // Yellow
  '3023_71': '4211398', // Light Bluish Gray
  '3023_72': '4211054', // Dark Bluish Gray

  // 3024 (Plate 1x1)
  '3024_15': '302401',  // White
  '3024_0':  '302426',  // Black
  '3024_4':  '302421',  // Red
  '3024_1':  '302423',  // Blue
  '3024_14': '302424',  // Yellow
  '3024_71': '4211525', // Light Bluish Gray
  '3024_72': '4210718', // Dark Bluish Gray
};

/**
 * Resolves color details (name and code) for a piece.
 */
export function getLegoColor(piece) {
  let ldrCode = piece.code !== undefined ? piece.code : piece.color;
  let colorName = 'White';
  if (ldrCode === undefined || ldrCode >= 0x2000000) {
    const snapped = snapToPalette(piece.rgb || [255, 255, 255]);
    ldrCode = snapped.code;
    colorName = snapped.name;
  } else {
    colorName = LDRAW_TO_LEGO_COLOR_NAME[ldrCode] || 'White';
  }
  return { code: ldrCode, name: colorName };
}

/**
 * Aggregates a piece list into distinct parts with counts, design IDs, and color names.
 */
export function aggregateLegoParts(pieces) {
  const map = new Map();
  for (const p of pieces) {
    const col = getLegoColor(p);
    const designId = getBrickLinkId(p.id);
    const key = `${designId}__${col.code}`;
    const elemKey = `${designId}_${col.code}`;
    const elementId = KNOWN_ELEMENT_IDS[elemKey] || '';

    const cur = map.get(key) || {
      designId,
      colorCode: col.code,
      colorName: col.name,
      elementId,
      count: 0,
    };
    cur.count++;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/**
 * Generates official LEGO.com Pick a Brick CSV format.
 * Accepted by LEGO.com "Upload a list" at:
 * https://www.lego.com/en-gr/pick-and-build/pick-a-brick
 */
export function toLegoPickABrickCSV(pieces) {
  const aggregated = aggregateLegoParts(pieces);
  const rows = ['Design ID,Color,Quantity'];
  for (const item of aggregated) {
    rows.push(`${item.designId},"${item.colorName}",${item.count}`);
  }
  return rows.join('\r\n');
}

/**
 * Generates BrickHunter / Element ID CSV for direct cart injection.
 */
export function toBrickHunterCSV(pieces) {
  const aggregated = aggregateLegoParts(pieces);
  const rows = ['Item No,Color,Quantity,Element ID'];
  for (const item of aggregated) {
    rows.push(`${item.designId},"${item.colorName}",${item.count},${item.elementId}`);
  }
  return rows.join('\r\n');
}

/**
 * Builds the direct URL for LEGO Pick a Brick with optional locale.
 */
export function getLegoPickABrickUrl(locale = 'en-gr') {
  return `https://www.lego.com/${locale}/pick-and-build/pick-a-brick`;
}
