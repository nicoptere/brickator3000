import * as THREE from 'three';

/**
 * ProceduralTextures: Generates micro-grain normal maps, procedural tabletop textures,
 * and whole-image blue-noise dithering for sensor noise emulation.
 */
export class ProceduralTextures {
  /**
   * Mulberry32 32-bit PRNG
   * @param {number} seed
   * @returns {() => number}
   */
  static createRng(seed = 12345) {
    let a = seed >>> 0;
    return function() {
      let t = (a += 0x6D2B79F5) >>> 0;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * 2D smooth value noise generator
   * @param {number} seed
   * @returns {(x: number, y: number) => number}
   */
  static createNoise2D(seed = 42) {
    const rng = this.createRng(seed);
    const perm = new Uint8Array(512);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
    }
    for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];

    function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function lerp(t, a, b) { return a + t * (b - a); }
    function grad(hash, x, y) {
      const h = hash & 7;
      const u = h < 4 ? x : y;
      const v = h < 4 ? y : x;
      return ((h & 1) ? -u : u) + ((h & 2) ? -2.0 * v : 2.0 * v);
    }

    return function(x, y) {
      const X = Math.floor(x) & 255;
      const Y = Math.floor(y) & 255;
      const xf = x - Math.floor(x);
      const yf = y - Math.floor(y);
      const u = fade(xf);
      const v = fade(yf);
      const aa = perm[perm[X] + Y];
      const ab = perm[perm[X] + Y + 1];
      const ba = perm[perm[X + 1] + Y];
      const bb = perm[perm[X + 1] + Y + 1];
      const x1 = lerp(u, grad(aa, xf, yf), grad(ba, xf - 1, yf));
      const x2 = lerp(u, grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1));
      return lerp(v, x1, x2);
    };
  }

  /**
   * Generates micro-grain normal map simulating injection mold surface imperfections
   * @param {number} size
   * @param {number} strength
   * @returns {THREE.CanvasTexture}
   */
  static generateNormalNoiseTexture(size = 256, strength = 1.6) {
    const data = new Uint8Array(size * size * 4);

    const noise1 = this.createNoise2D(101);
    const noise2 = this.createNoise2D(202);

    const heightMap = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = x * 0.2;
        const ny = y * 0.2;
        heightMap[y * size + x] = noise1(nx, ny) * 0.7 + noise2(nx * 2.5, ny * 2.5) * 0.3;
      }
    }

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const xPrev = (x - 1 + size) % size;
        const xNext = (x + 1) % size;
        const yPrev = (y - 1 + size) % size;
        const yNext = (y + 1) % size;

        const dx = (heightMap[y * size + xNext] - heightMap[y * size + xPrev]) * strength;
        const dy = (heightMap[yNext * size + x] - heightMap[yPrev * size + x]) * strength;
        const dz = 1.0;

        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const nx = (-dx / len) * 0.5 + 0.5;
        const ny = (-dy / len) * 0.5 + 0.5;
        const nz = (dz / len) * 0.5 + 0.5;

        const idx = (y * size + x) * 4;
        data[idx] = Math.round(nx * 255);
        data[idx + 1] = Math.round(ny * 255);
        data[idx + 2] = Math.round(nz * 255);
        data[idx + 3] = 255;
      }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(10, 10);
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Precomputes a 2D high-pass blue noise array
   * @param {number} size
   * @param {number} seed
   * @returns {{ size: number, data: Float32Array }}
   */
  static generateBlueNoisePattern(size = 128, seed = 8888) {
    const blueNoise = new Float32Array(size * size);
    const rng = this.createRng(seed);
    const raw = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) raw[i] = rng() - 0.5;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = raw[y * size + x] * 8.0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const px = (x + dx + size) % size;
            const py = (y + dy + size) % size;
            sum -= raw[py * size + px];
          }
        }
        blueNoise[y * size + x] = sum;
      }
    }

    let minVal = Infinity, maxVal = -Infinity;
    for (let i = 0; i < size * size; i++) {
      if (blueNoise[i] < minVal) minVal = blueNoise[i];
      if (blueNoise[i] > maxVal) maxVal = blueNoise[i];
    }
    const range = maxVal - minVal || 1.0;
    for (let i = 0; i < size * size; i++) {
      blueNoise[i] = (blueNoise[i] - minVal) / range - 0.5;
    }

    return { size, data: blueNoise };
  }

  /**
   * Applies blue noise dithering over a 2D canvas context
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   * @param {{ size: number, data: Float32Array }} pattern
   * @param {number} strength
   */
  static applyBlueNoise(ctx, width, height, pattern, strength = 0.024) {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const bData = pattern.data;
    const bSize = pattern.size;

    for (let y = 0; y < height; y++) {
      const by = y % bSize;
      for (let x = 0; x < width; x++) {
        const bx = x % bSize;
        const noise = bData[by * bSize + bx] * strength * 255.0;
        const idx = (y * width + x) * 4;
        data[idx] = Math.max(0, Math.min(255, data[idx] + noise));
        data[idx + 1] = Math.max(0, Math.min(255, data[idx + 1] + noise));
        data[idx + 2] = Math.max(0, Math.min(255, data[idx + 2] + noise));
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  /**
   * Generates procedural tabletop textures (wood, stone, plastic, felt, tile)
   * @param {'stone'|'wood'|'plastic'|'felt'|'tile'} type
   * @param {number} seed
   * @param {number} [size=512]
   * @param {string} [legoColorHex=null] Optional official LEGO color hex for tinting
   * @returns {THREE.CanvasTexture}
   */
  static generateBackgroundTexture(type = 'stone', seed = 1234, size = 512, legoColorHex = null) {
    const rng = this.createRng(seed);
    const data = new Uint8Array(size * size * 4);

    const noise1 = this.createNoise2D(seed);
    const noise2 = this.createNoise2D(seed + 333);

    // Resolve base color if LEGO color hex is passed
    let tintRgb = null;
    if (legoColorHex) {
      const c = new THREE.Color(legoColorHex);
      // Darken tint slightly for realistic desktop background contrast
      tintRgb = [Math.round(c.r * 180), Math.round(c.g * 180), Math.round(c.b * 180)];
    }

    if (type === 'wood') {
      // 1. Hardwood Studio Desk
      let baseH = 26 + rng() * 6; // warm wood hue
      let baseS = 28 + rng() * 10;
      let baseL = 16 + rng() * 8; // dark rich studio desk

      if (tintRgb) {
        const rNorm = tintRgb[0] / 255, gNorm = tintRgb[1] / 255, bNorm = tintRgb[2] / 255;
        const max = Math.max(rNorm, gNorm, bNorm), min = Math.min(rNorm, gNorm, bNorm);
        baseL = Math.max(8, Math.min(45, ((max + min) / 2) * 100));
        if (max !== min) {
          const d = max - min;
          baseS = Math.max(10, Math.min(50, (baseL > 50 ? d / (2 - max - min) : d / (max + min)) * 100));
          if (max === rNorm) baseH = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) * 60;
          else if (max === gNorm) baseH = ((bNorm - rNorm) / d + 2) * 60;
          else baseH = ((rNorm - gNorm) / d + 4) * 60;
        }
      }

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const warp = noise2(x * 0.007, y * 0.025) * 7.0;
          const grain = Math.sin((x + warp) * 0.075) * 0.5 + 0.5;
          const micro = noise1(x * 0.12, y * 0.02) * 0.15;
          const val = grain * 0.3 + micro;
          const l = Math.max(8, Math.min(48, baseL + (val - 0.2) * 12));
          const rgb = this.hslToRgb(baseH / 360, baseS / 100, l / 100);

          const idx = (y * size + x) * 4;
          data[idx] = rgb[0];
          data[idx + 1] = rgb[1];
          data[idx + 2] = rgb[2];
          data[idx + 3] = 255;
        }
      }
    } else if (type === 'slate') {
      // 2. Natural Foliated Slate with layered cleavage planes
      const baseCol = tintRgb || [42, 48, 56];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const strataWarp = noise1(x * 0.008, y * 0.04) * 6.0;
          const strata = Math.sin((y + strataWarp) * 0.12) * 3.5;
          const cleft = noise2(x * 0.03, y * 0.008) * 8.0;
          const fineGrain = (noise1(x * 0.25, y * 0.25) - 0.5) * 4.0;
          const val = strata + cleft + fineGrain;

          const idx = (y * size + x) * 4;
          data[idx] = Math.max(0, Math.min(255, Math.round(baseCol[0] + val)));
          data[idx + 1] = Math.max(0, Math.min(255, Math.round(baseCol[1] + val)));
          data[idx + 2] = Math.max(0, Math.min(255, Math.round(baseCol[2] + val)));
          data[idx + 3] = 255;
        }
      }
    } else if (type === 'stone') {
      // 3. Dark Slate Concrete Desk (with optional LEGO palette tinting)
      const baseR = tintRgb ? tintRgb[0] : (34 + Math.floor(rng() * 12));
      const baseG = tintRgb ? tintRgb[1] : (34 + Math.floor(rng() * 12));
      const baseB = tintRgb ? tintRgb[2] : (34 + Math.floor(rng() * 12));
      const tintB = (rng() - 0.5) * 4;

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const macro = noise1(x * 0.015, y * 0.015) * 8.0;
          const micro = noise2(x * 0.12, y * 0.12) * 6.0;
          const fleck = ((x * 19 + y * 47) % 31 === 0) ? (rng() * 12 - 6) : 0;
          const delta = macro + micro + fleck;

          const idx = (y * size + x) * 4;
          data[idx] = Math.max(0, Math.min(255, Math.round(baseR + delta)));
          data[idx + 1] = Math.max(0, Math.min(255, Math.round(baseG + delta)));
          data[idx + 2] = Math.max(0, Math.min(255, Math.round(baseB + delta + tintB)));
          data[idx + 3] = 255;
        }
      }
    } else if (type === 'felt') {
      // 4. Soft Crafting Felt / Fabric Mat (grain reduced by 5x)
      const baseCol = tintRgb || [45, 52, 60];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          // Fine micro-weave fiber pattern (5x finer grain)
          const weaveX = Math.sin(x * 2.0) * 2.0;
          const weaveY = Math.cos(y * 2.0) * 2.0;
          const fuzz = (noise1(x * 1.75, y * 1.75) - 0.5) * 8.0;
          const val = weaveX + weaveY + fuzz;

          const idx = (y * size + x) * 4;
          data[idx] = Math.max(0, Math.min(255, Math.round(baseCol[0] + val)));
          data[idx + 1] = Math.max(0, Math.min(255, Math.round(baseCol[1] + val)));
          data[idx + 2] = Math.max(0, Math.min(255, Math.round(baseCol[2] + val)));
          data[idx + 3] = 255;
        }
      }
    } else if (type === 'tile') {
      // 5. Ceramic / Polished Stone Grid Tile
      const baseCol = tintRgb || [40, 44, 50];
      const tileSize = Math.max(16, Math.floor(size / 8));
      const jointWidth = 2;

      for (let y = 0; y < size; y++) {
        const inJointY = (y % tileSize) < jointWidth || (y % tileSize) >= (tileSize - jointWidth);
        for (let x = 0; x < size; x++) {
          const inJointX = (x % tileSize) < jointWidth || (x % tileSize) >= (tileSize - jointWidth);
          const isJoint = inJointX || inJointY;

          const marbleVein = noise2(x * 0.02, y * 0.02) * 12.0;
          const fineNoise = noise1(x * 0.15, y * 0.15) * 5.0;

          const idx = (y * size + x) * 4;
          if (isJoint) {
            data[idx] = Math.max(0, Math.min(255, Math.round(baseCol[0] * 0.35)));
            data[idx + 1] = Math.max(0, Math.min(255, Math.round(baseCol[1] * 0.35)));
            data[idx + 2] = Math.max(0, Math.min(255, Math.round(baseCol[2] * 0.35)));
          } else {
            data[idx] = Math.max(0, Math.min(255, Math.round(baseCol[0] + marbleVein + fineNoise)));
            data[idx + 1] = Math.max(0, Math.min(255, Math.round(baseCol[1] + marbleVein + fineNoise)));
            data[idx + 2] = Math.max(0, Math.min(255, Math.round(baseCol[2] + marbleVein + fineNoise)));
          }
          data[idx + 3] = 255;
        }
      }
    } else {
      // 6. Sorting Tray / Technical Matte Plastic Surface
      const palette = [
        [32, 36, 40],   // Dark Slate Plastic
        [26, 30, 36],   // Dark Technical Navy
        [36, 34, 32],   // Dark Muted Walnut Plastic
        [28, 28, 30],   // Dark Graphite
        [22, 24, 26]    // Deep Obsidian Plastic
      ];
      const baseCol = tintRgb || palette[Math.floor(rng() * palette.length)];

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const pebble = noise1(x * 0.35, y * 0.35) * 3.0;
          const grit = (noise2(x * 0.7, y * 0.7) > 0.3 ? 1.0 : -1.0);
          const varVal = pebble + grit;

          const idx = (y * size + x) * 4;
          data[idx] = Math.max(0, Math.min(255, Math.round(baseCol[0] + varVal)));
          data[idx + 1] = Math.max(0, Math.min(255, Math.round(baseCol[1] + varVal)));
          data[idx + 2] = Math.max(0, Math.min(255, Math.round(baseCol[2] + varVal)));
          data[idx + 3] = 255;
        }
      }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    tex.needsUpdate = true;
    return tex;
  }

  static hslToRgb(h, s, l) {
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      Math.round(hue2rgb(p, q, h + 1/3) * 255),
      Math.round(hue2rgb(p, q, h) * 255),
      Math.round(hue2rgb(p, q, h - 1/3) * 255)
    ];
  }
}

export const FLOOR_PATTERNS = ['stone', 'wood', 'slate', 'tray', 'felt', 'tile'];

export const TABLETOP_PALETTES = [
  // Natural Slate & Stone
  { name: 'Charcoal Slate', hex: '#2A2E33', type: 'slate' },
  { name: 'Dark Blue Slate', hex: '#34424D', type: 'slate' },
  { name: 'Ash Slate', hex: '#40454B', type: 'slate' },
  { name: 'Deep Graphite', hex: '#1F2226', type: 'slate' },
  { name: 'Concrete Grey', hex: '#6C747D', type: 'stone' },
  { name: 'Limestone', hex: '#82776E', type: 'stone' },
  { name: 'Warm Granite', hex: '#544C44', type: 'stone' },
  { name: 'Dark Basalt', hex: '#2C2F33', type: 'stone' },

  // Natural Hardwood
  { name: 'Warm Oak', hex: '#82522C', type: 'wood' },
  { name: 'Dark Walnut', hex: '#3B2414', type: 'wood' },
  { name: 'Birch Table', hex: '#BFA075', type: 'wood' },
  { name: 'Studio Mahogany', hex: '#4A2518', type: 'wood' },
  { name: 'Ash Desk', hex: '#6A5F54', type: 'wood' },
  { name: 'Light Pine', hex: '#D2B48C', type: 'wood' },

  // Sorting Tray / Studio Plastic
  { name: 'White Melamine Tray', hex: '#F4F5F7', type: 'tray' },
  { name: 'Light Grey Sorting Tray', hex: '#D3D6DC', type: 'tray' },
  { name: 'Dark Obsidian Tray', hex: '#1C2024', type: 'tray' },
  { name: 'Technical Navy Tray', hex: '#28303C', type: 'tray' },
  { name: 'Sorting Blue Tray', hex: '#2C405A', type: 'tray' },
  { name: 'Classic Green Tray', hex: '#2D483A', type: 'tray' },
  { name: 'Yellow Studio Tray', hex: '#C29D28', type: 'tray' },

  // Crafting Felt / Work Mats
  { name: 'Forest Green Felt', hex: '#1E4334', type: 'felt' },
  { name: 'Neutral Grey Felt', hex: '#3F4347', type: 'felt' },
  { name: 'Navy Blue Felt', hex: '#202B3C', type: 'felt' },
  { name: 'Tan Cork Mat', hex: '#8C6B46', type: 'felt' },
  { name: 'Burgundy Crafting Mat', hex: '#4A1E24', type: 'felt' },

  // Ceramic & Stone Tile
  { name: 'White Ceramic Tile', hex: '#E0E3E8', type: 'tile' },
  { name: 'Slate Grey Tile', hex: '#363C44', type: 'tile' },
  { name: 'Terracotta Tile', hex: '#8E3E2B', type: 'tile' },
  { name: 'Beige Sandstone Tile', hex: '#BFB29E', type: 'tile' },
  { name: 'Charcoal Tile', hex: '#262A2E', type: 'tile' }
];

ProceduralTextures.FLOOR_PATTERNS = FLOOR_PATTERNS;
ProceduralTextures.TABLETOP_PALETTES = TABLETOP_PALETTES;

