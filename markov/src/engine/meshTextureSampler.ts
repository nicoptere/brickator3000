/**
 * Mesh Texture Sampler Utility for Brickator3000.
 *
 * Samples pixel colors from THREE.Texture (in browser via Canvas 2D)
 * and decoded GLB PNG buffers (in Node.js / headless test environments).
 */

import * as THREE from 'three';

export interface DecodedTextureBuffer {
  width: number;
  height: number;
  pixels: Uint8Array;
}

const canvasCache = new WeakMap<object, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }>();

/**
 * Samples a pixel from a browser THREE.Texture at UV coordinates.
 */
export function sampleTexturePixel(texture: THREE.Texture, u: number, v: number): THREE.Color | null {
  if (typeof document === 'undefined' || !texture.image) return null;
  const img = texture.image as any;

  if (typeof img.complete === 'boolean' && !img.complete) return null;
  if (img.width === 0 || img.height === 0) return null;

  let cached = canvasCache.get(img);
  if (!cached) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.width || 256;
      canvas.height = img.height || 256;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      cached = { canvas, ctx };
      canvasCache.set(img, cached);
    } catch {
      return null;
    }
  }

  let curU = u % 1;
  let curV = v % 1;
  if (curU < 0) curU += 1;
  if (curV < 0) curV += 1;
  if (texture.flipY !== false) {
    curV = 1 - curV;
  }

  const px = Math.min(cached.canvas.width - 1, Math.max(0, Math.floor(curU * cached.canvas.width)));
  const py = Math.min(cached.canvas.height - 1, Math.max(0, Math.floor(curV * cached.canvas.height)));

  try {
    const p = cached.ctx.getImageData(px, py, 1, 1).data;
    if (p[3] < 10) return null;
    return new THREE.Color(p[0] / 255, p[1] / 255, p[2] / 255);
  } catch {
    return null;
  }
}

/**
 * Samples a pixel from a decoded buffer (RGBA Uint8Array) at UV coordinates.
 */
export function sampleDecodedPixel(
  tex: DecodedTextureBuffer,
  u: number,
  v: number
): THREE.Color | null {
  if (!tex || !tex.pixels || tex.width <= 0 || tex.height <= 0) return null;
  let curU = u % 1;
  let curV = v % 1;
  if (curU < 0) curU += 1;
  if (curV < 0) curV += 1;

  const px = Math.min(tex.width - 1, Math.max(0, Math.floor(curU * tex.width)));
  const py = Math.min(tex.height - 1, Math.max(0, Math.floor((1 - curV) * tex.height)));
  const idx = (py * tex.width + px) * 4;
  if (tex.pixels[idx + 3] <= 20) return null;

  return new THREE.Color(
    tex.pixels[idx] / 255,
    tex.pixels[idx + 1] / 255,
    tex.pixels[idx + 2] / 255
  );
}

/**
 * Universal texture sampler supporting both browser THREE.Texture and Node.js DecodedTextureBuffer.
 */
export function sampleAnyTexture(
  tex: any,
  u: number,
  v: number
): THREE.Color | null {
  if (!tex) return null;
  if (tex.pixels && tex.width && tex.height) {
    return sampleDecodedPixel(tex, u, v);
  }
  if (tex.userData?.decodedTexture) {
    return sampleDecodedPixel(tex.userData.decodedTexture, u, v);
  }
  if (tex.isTexture) {
    return sampleTexturePixel(tex, u, v);
  }
  return null;
}
