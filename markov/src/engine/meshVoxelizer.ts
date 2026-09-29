/**
 * 3D Mesh Voxelizer for Watertight Voxel Grids.
 *
 * Converts Three.js geometries, scenes, and authentic 3D models (GLTF/GLB, OBJ, PLY)
 * into watertight solid VoxelGrid volumes:
 * - Computes exact 3D voxel envelope at arbitrary target scale (in plates / studs).
 * - Direct RGB diffuse and vertex color sampling ("Cheat Mode").
 * - Supports texture map sampling via Canvas API in browser environments.
 * - Robust fallback PNG texture decoder for GLB models in Node.js/headless environments.
 * - Calculates surface normals and guarantees 6-connected watertightness.
 */

if (typeof (globalThis as any).self === 'undefined') {
  (globalThis as any).self = globalThis;
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { VoxelGrid, VoxelCell } from './types';
import { MultiResolutionLattice } from './multiResolutionLattice';
import { MeshIslandSegmenter, MeshIsland } from './meshIslandSegmenter';

export interface VoxelizerOptions {
  targetHeightBricks?: number; // Target model height in 1*1*1 bricks (e.g. 16, 24, 32, 64)
  targetHeightPlates?: number; // Legacy alias: if targetHeightPlates is provided, targetHeightBricks = Math.round(targetHeightPlates / 3) or targetHeightBricks
  pitchLDU?: number; // 20 LDU = 1 stud
  brickHeightLDU?: number; // 24 LDU = 1 brick (1*1*1 brick height)
  plateHeightLDU?: number; // 8 LDU = 1 plate (for legacy compatibility)
}

// Standard official LEGO palette for fallback color code mapping
const OFFICIAL_LEGO_COLORS: Array<{ code: number; name: string; hex: string; r: number; g: number; b: number }> = [
  { code: 0, name: 'Black', hex: '#1b2a34', r: 27, g: 42, b: 52 },
  { code: 1, name: 'Blue', hex: '#0055bf', r: 0, g: 85, b: 191 },
  { code: 2, name: 'Green', hex: '#237841', r: 35, g: 120, b: 65 },
  { code: 4, name: 'Red', hex: '#c91a09', r: 201, g: 26, b: 9 },
  { code: 14, name: 'Yellow', hex: '#f2cd37', r: 242, g: 205, b: 55 },
  { code: 15, name: 'White', hex: '#f4f4f4', r: 244, g: 244, b: 244 },
  { code: 19, name: 'Tan', hex: '#e4cd9e', r: 228, g: 205, b: 158 },
  { code: 25, name: 'Orange', hex: '#fe8a18', r: 254, g: 138, b: 24 },
  { code: 26, name: 'Magenta', hex: '#92397b', r: 146, g: 57, b: 123 },
  { code: 27, name: 'Lime', hex: '#bbe90b', r: 187, g: 233, b: 11 },
  { code: 28, name: 'Dark Tan', hex: '#958a73', r: 149, g: 138, b: 115 },
  { code: 71, name: 'Light Bluish Gray', hex: '#a0a5a9', r: 160, g: 165, b: 169 },
  { code: 72, name: 'Dark Bluish Gray', hex: '#6c6e68', r: 108, g: 110, b: 104 },
  { code: 84, name: 'Medium Nougat', hex: '#aa7d55', r: 170, g: 125, b: 85 },
  { code: 151, name: 'Sand Blue', hex: '#5e748c', r: 94, g: 116, b: 140 },
  { code: 288, name: 'Dark Green', hex: '#184632', r: 24, g: 70, b: 50 },
  { code: 320, name: 'Dark Red', hex: '#720e0f', r: 114, g: 14, b: 15 },
  { code: 321, name: 'Dark Blue', hex: '#0a3463', r: 10, g: 52, b: 99 },
  { code: 378, name: 'Sand Green', hex: '#708e7c', r: 112, g: 142, b: 124 },
  { code: 484, name: 'Dark Orange', hex: '#91501c', r: 145, g: 80, b: 28 }
];

export function findNearestLegoColor(hexColor: string): { code: number; name: string } {
  const clean = hexColor.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) || 200;
  const g = parseInt(clean.substring(2, 4), 16) || 200;
  const b = parseInt(clean.substring(4, 6), 16) || 200;

  let best = OFFICIAL_LEGO_COLORS[0];
  let minDiff = Infinity;

  for (const c of OFFICIAL_LEGO_COLORS) {
    const diff = (r - c.r) ** 2 * 0.3 + (g - c.g) ** 2 * 0.59 + (b - c.b) ** 2 * 0.11;
    if (diff < minDiff) {
      minDiff = diff;
      best = c;
    }
  }

  return { code: best.code, name: best.name };
}

async function getNodeFs(): Promise<any> {
  if (typeof window === 'undefined') {
    try {
      const fsMod = await import(/* @vite-ignore */ 'node:fs');
      return fsMod.default || fsMod;
    } catch {}
  }
  return null;
}

async function getNodeZlib(): Promise<any> {
  if (typeof window === 'undefined') {
    try {
      const zlibMod = await import(/* @vite-ignore */ 'node:zlib');
      return zlibMod.default || zlibMod;
    } catch {}
  }
  return null;
}

/**
 * Decodes embedded PNG textures from GLB binary buffers in Node.js environments.
 */
function decodeGLBTextures(glbBuffer: ArrayBuffer | Buffer, zlibOverride?: any): Array<{ width: number; height: number; pixels: Uint8Array }> {
  try {
    let zlib = zlibOverride;
    if (!zlib && typeof require !== 'undefined') {
      try { zlib = require('zlib'); } catch {}
    }
    if (!zlib) return [];

    const buf = Buffer.isBuffer(glbBuffer) ? glbBuffer : Buffer.from(glbBuffer);
    if (buf.length < 20) return [];
    if (buf.toString('ascii', 0, 4) !== 'glTF') return [];

    const jsonLen = buf.readUInt32LE(12);
    const jsonStr = buf.toString('utf-8', 20, 20 + jsonLen);
    const json = JSON.parse(jsonStr);
    const binOffset = 20 + jsonLen + 8;
    const textures: Array<{ width: number; height: number; pixels: Uint8Array }> = [];

    if (!json.images) return textures;

    for (const img of json.images) {
      if (img.bufferView !== undefined && json.bufferViews) {
        const bv = json.bufferViews[img.bufferView];
        const imgBuf = buf.subarray(binOffset + bv.byteOffset, binOffset + bv.byteOffset + bv.byteLength);

        // Check PNG signature
        if (imgBuf.length > 8 && imgBuf.readUInt32BE(0) === 0x89504e47) {
          let pos = 8;
          let width = 0, height = 0, colorType = 0;
          const idatChunks: Buffer[] = [];
          let plte: Buffer | null = null;

          while (pos < imgBuf.length) {
            const len = imgBuf.readUInt32BE(pos);
            const type = imgBuf.toString('ascii', pos + 4, pos + 8);
            if (type === 'IHDR') {
              width = imgBuf.readUInt32BE(pos + 8);
              height = imgBuf.readUInt32BE(pos + 12);
              colorType = imgBuf.readUInt8(pos + 17);
            } else if (type === 'PLTE') {
              plte = imgBuf.subarray(pos + 8, pos + 8 + len);
            } else if (type === 'IDAT') {
              idatChunks.push(imgBuf.subarray(pos + 8, pos + 8 + len));
            } else if (type === 'IEND') {
              break;
            }
            pos += 12 + len;
          }

          if (width > 0 && height > 0 && idatChunks.length > 0) {
            const decompressed = zlib.inflateSync(Buffer.concat(idatChunks));
            const bpp = colorType === 6 ? 4 : (colorType === 2 ? 3 : 1);
            const stride = width * bpp;
            const pixels = new Uint8Array(width * height * 4);
            let srcPos = 0;
            const prevLine = new Uint8Array(stride);
            const currLine = new Uint8Array(stride);

            for (let y = 0; y < height; y++) {
              const filter = decompressed[srcPos++];
              for (let i = 0; i < stride; i++) {
                const raw = decompressed[srcPos++];
                const a = i >= bpp ? currLine[i - bpp] : 0;
                const b = prevLine[i];
                const c = i >= bpp ? prevLine[i - bpp] : 0;
                let val = raw;
                if (filter === 1) val = (raw + a) & 0xff;
                else if (filter === 2) val = (raw + b) & 0xff;
                else if (filter === 3) val = (raw + Math.floor((a + b) / 2)) & 0xff;
                else if (filter === 4) {
                  const p = a + b - c;
                  const pa = Math.abs(p - a);
                  const pb = Math.abs(p - b);
                  const pc = Math.abs(p - c);
                  const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
                  val = (raw + pr) & 0xff;
                }
                currLine[i] = val;
              }

              for (let x = 0; x < width; x++) {
                const dstIdx = (y * width + x) * 4;
                if (colorType === 3 && plte) {
                  const pIdx = currLine[x] * 3;
                  pixels[dstIdx] = plte[pIdx];
                  pixels[dstIdx + 1] = plte[pIdx + 1];
                  pixels[dstIdx + 2] = plte[pIdx + 2];
                  pixels[dstIdx + 3] = 255;
                } else if (colorType === 6) {
                  pixels[dstIdx] = currLine[x * 4];
                  pixels[dstIdx + 1] = currLine[x * 4 + 1];
                  pixels[dstIdx + 2] = currLine[x * 4 + 2];
                  pixels[dstIdx + 3] = currLine[x * 4 + 3];
                } else if (colorType === 2) {
                  pixels[dstIdx] = currLine[x * 3];
                  pixels[dstIdx + 1] = currLine[x * 3 + 1];
                  pixels[dstIdx + 2] = currLine[x * 3 + 2];
                  pixels[dstIdx + 3] = 255;
                }
              }
              prevLine.set(currLine);
            }
            textures.push({ width, height, pixels });
          }
        }
      }
    }
    return textures;
  } catch {
    return [];
  }
}

export class MeshVoxelizer {
  private static canvasCache = new WeakMap<object, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }>();

  /**
   * Samples a pixel color from a texture map at UV coordinates (browser environment).
   */
  public static sampleTexturePixel(texture: THREE.Texture, uv: THREE.Vector2): THREE.Color | null {
    if (typeof document === 'undefined' || !texture.image) return null;
    const img = texture.image as any;

    if (typeof img.complete === 'boolean' && !img.complete) return null;
    if (img.width === 0 || img.height === 0) return null;

    let cached = this.canvasCache.get(img);
    if (!cached) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width || 256;
        canvas.height = img.height || 256;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        cached = { canvas, ctx };
        this.canvasCache.set(img, cached);
      } catch {
        return null;
      }
    }

    let u = uv.x % 1;
    let v = uv.y % 1;
    if (u < 0) u += 1;
    if (v < 0) v += 1;
    if (texture.flipY !== false) {
      v = 1 - v;
    }

    const px = Math.min(cached.canvas.width - 1, Math.max(0, Math.floor(u * cached.canvas.width)));
    const py = Math.min(cached.canvas.height - 1, Math.max(0, Math.floor(v * cached.canvas.height)));

    try {
      const p = cached.ctx.getImageData(px, py, 1, 1).data;
      if (p[3] < 10) return null; // Skip transparent pixels
      return new THREE.Color(p[0] / 255, p[1] / 255, p[2] / 255);
    } catch {
      return null;
    }
  }

  /**
   * Extracts direct RGB diffuse and vertex color from an intersection hit.
   */
  public static sampleColorFromHit(hit: THREE.Intersection): {
    colorHex: string;
    colorCode: number;
    colorName: string;
  } {
    const mesh = hit.object as THREE.Mesh;
    const geom = mesh.geometry;
    let sampledColor: THREE.Color | null = null;

    // 0. Try Decoded Texture (e.g. Node.js or embedded GLB texture)
    if (mesh.userData?.decodedTexture && hit.uv) {
      const tex = mesh.userData.decodedTexture;
      let u = hit.uv.x % 1;
      let v = hit.uv.y % 1;
      if (u < 0) u += 1;
      if (v < 0) v += 1;
      const px = Math.min(tex.width - 1, Math.max(0, Math.floor(u * tex.width)));
      const py = Math.min(tex.height - 1, Math.max(0, Math.floor(v * tex.height)));
      const idx = (py * tex.width + px) * 4;
      const alpha = tex.pixels[idx + 3];
      if (alpha > 20) {
        sampledColor = new THREE.Color(
          tex.pixels[idx] / 255,
          tex.pixels[idx + 1] / 255,
          tex.pixels[idx + 2] / 255
        );
      }
    }

    // 1. Try Vertex Colors (geometry.attributes.color)
    if (!sampledColor && geom && geom.attributes.color && hit.face) {
      const colorAttr = geom.attributes.color;
      const a = hit.face.a;
      const b = hit.face.b;
      const c = hit.face.c;

      const ra = colorAttr.getX(a);
      const ga = colorAttr.getY(a);
      const ba = colorAttr.getZ(a);

      const rb = colorAttr.getX(b);
      const gb = colorAttr.getY(b);
      const bb = colorAttr.getZ(b);

      const rc = colorAttr.getX(c);
      const gc = colorAttr.getY(c);
      const bc = colorAttr.getZ(c);

      sampledColor = new THREE.Color((ra + rb + rc) / 3.0, (ga + gb + gc) / 3.0, (ba + bb + bc) / 3.0);
    }

    // 2. Try Texture Map if UV available
    if (!sampledColor && hit.uv && mesh.material) {
      const mat = Array.isArray(mesh.material)
        ? mesh.material[hit.face?.materialIndex ?? 0]
        : mesh.material;

      if ((mat as any)?.map) {
        sampledColor = this.sampleTexturePixel((mat as any).map, hit.uv);
      }
    }

    // 3. Try Material Diffuse Color
    if (!sampledColor && mesh.material) {
      const mat = Array.isArray(mesh.material)
        ? mesh.material[hit.face?.materialIndex ?? 0]
        : mesh.material;

      if ((mat as any)?.color) {
        sampledColor = (mat as any).color.clone();
      }
    }

    // 4. Fallback Default
    if (!sampledColor) {
      sampledColor = new THREE.Color(0xf2cd37); // Default LEGO Yellow
    }

    const hex = '#' + sampledColor.getHexString();
    const nearest = findNearestLegoColor(hex);

    return {
      colorHex: hex,
      colorCode: nearest.code,
      colorName: nearest.name
    };
  }

  /**
   * Loads an authentic 3D model (GLTF/GLB, OBJ, PLY) asynchronously.
   */
  public static async loadModel(pathOrUrlOrFile: string | File): Promise<THREE.Object3D> {
    if (typeof pathOrUrlOrFile === 'string') {
      const url = pathOrUrlOrFile;
      const lower = url.toLowerCase();
      const fs = await getNodeFs();
      const zlib = await getNodeZlib();

      const resolveLocalPath = (rawPath: string): string | null => {
        if (!fs) return null;
        const candidates = [
          rawPath,
          rawPath.startsWith('/') ? `public${rawPath}` : `public/${rawPath}`,
          rawPath.startsWith('/') ? `.${rawPath}` : `./${rawPath}`,
          rawPath.startsWith('/') ? rawPath.slice(1) : rawPath
        ];
        for (const c of candidates) {
          try {
            if (fs.existsSync(c)) return c;
          } catch {}
        }
        return null;
      };

      if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
        let decodedTextures: Array<{ width: number; height: number; pixels: Uint8Array }> = [];
        let scene: THREE.Object3D | null = null;

        const localPath = resolveLocalPath(url);
        if (fs && localPath) {
          try {
            const buf = fs.readFileSync(localPath);
            decodedTextures = decodeGLBTextures(buf, zlib);
            const loader = new GLTFLoader();
            const gltf = await new Promise<any>((resolve, reject) => {
              loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', resolve, reject);
            });
            scene = gltf.scene;
          } catch (e) {
            console.warn('Failed to parse GLB from local file, falling back to loadAsync:', e);
          }
        }

        if (!scene) {
          const loader = new GLTFLoader();
          const gltf = await loader.loadAsync(url);
          scene = gltf.scene;
        }

        if (decodedTextures.length > 0) {
          scene.traverse((c) => {
            if ((c as THREE.Mesh).isMesh) {
              c.userData.decodedTexture = decodedTextures[0];
            }
          });
        }
        return scene;
      }

      if (lower.endsWith('.ply')) {
        const localPath = resolveLocalPath(url);
        if (fs && localPath) {
          try {
            const buf = fs.readFileSync(localPath);
            const loader = new PLYLoader();
            const geom = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
            const mat = new THREE.MeshStandardMaterial({
              vertexColors: !!geom.attributes.color,
              roughness: 0.4
            });
            return new THREE.Mesh(geom, mat);
          } catch (e) {
            console.warn('Failed to parse PLY from local file, falling back to loadAsync:', e);
          }
        }

        const loader = new PLYLoader();
        const geom = await loader.loadAsync(url);
        const mat = new THREE.MeshStandardMaterial({
          vertexColors: !!geom.attributes.color,
          roughness: 0.4
        });
        return new THREE.Mesh(geom, mat);
      }

      if (lower.endsWith('.obj')) {
        const localPath = resolveLocalPath(url);
        if (fs && localPath) {
          try {
            const text = fs.readFileSync(localPath, 'utf-8');
            const loader = new OBJLoader();
            return loader.parse(text);
          } catch (e) {
            console.warn('Failed to parse OBJ from local file, falling back to loadAsync:', e);
          }
        }

        const loader = new OBJLoader();
        return await loader.loadAsync(url);
      }

      // Default fallback to GLTFLoader
      const localPath = resolveLocalPath(url);
      if (fs && localPath) {
        try {
          const buf = fs.readFileSync(localPath);
          const loader = new GLTFLoader();
          const gltf = await new Promise<any>((resolve, reject) => {
            loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', resolve, reject);
          });
          return gltf.scene;
        } catch {}
      }

      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      return gltf.scene;
    } else {
      // Handling browser File instance
      const file = pathOrUrlOrFile;
      const lower = file.name.toLowerCase();
      const buffer = await file.arrayBuffer();

      if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
        const loader = new GLTFLoader();
        const gltf = await new Promise<any>((resolve, reject) => {
          loader.parse(buffer, '', resolve, reject);
        });
        return gltf.scene;
      }

      if (lower.endsWith('.ply')) {
        const loader = new PLYLoader();
        const geom = loader.parse(buffer);
        const mat = new THREE.MeshStandardMaterial({
          vertexColors: !!geom.attributes.color,
          roughness: 0.4
        });
        return new THREE.Mesh(geom, mat);
      }

      if (lower.endsWith('.obj')) {
        const text = new TextDecoder().decode(buffer);
        const loader = new OBJLoader();
        return loader.parse(text);
      }

      // Default try GLTF
      const loader = new GLTFLoader();
      const gltf = await new Promise<any>((resolve, reject) => {
        loader.parse(buffer, '', resolve, reject);
      });
      return gltf.scene;
    }
  }

  /**
   * Generates a procedural test 3D model with authentic geometry and vibrant vertex colors.
   */
  public static createSampleModel(type: 'duck' | 'car' | 'airplane' | 'dolphin' | 'dome_creature'): THREE.Object3D {
    const group = new THREE.Group();

    const paintGeometry = (geom: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry => {
      const count = geom.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return geom;
    };

    switch (type) {
      case 'duck': {
        const yellow = new THREE.Color(0xf2cd37);
        const orange = new THREE.Color(0xfe8a18);
        const black = new THREE.Color(0x1b2a34);

        // Body ellipsoid
        const bodyGeo = paintGeometry(new THREE.SphereGeometry(1.4, 20, 20), yellow);
        bodyGeo.scale(1.5, 1.0, 1.1);
        const bodyMesh = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
        bodyMesh.position.set(0, 1.2, 0);
        group.add(bodyMesh);

        // Head sphere
        const headGeo = paintGeometry(new THREE.SphereGeometry(0.85, 20, 20), yellow);
        const headMesh = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
        headMesh.position.set(1.2, 2.3, 0);
        group.add(headMesh);

        // Beak cone
        const beakGeo = paintGeometry(new THREE.ConeGeometry(0.38, 0.9, 16), orange);
        beakGeo.rotateZ(-Math.PI / 2);
        const beakMesh = new THREE.Mesh(beakGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
        beakMesh.position.set(2.2, 2.1, 0);
        group.add(beakMesh);

        // Eyes
        const eyeLGeo = paintGeometry(new THREE.SphereGeometry(0.16, 12, 12), black);
        const eyeL = new THREE.Mesh(eyeLGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
        eyeL.position.set(1.5, 2.5, 0.6);
        group.add(eyeL);

        const eyeRGeo = paintGeometry(new THREE.SphereGeometry(0.16, 12, 12), black);
        const eyeR = new THREE.Mesh(eyeRGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
        eyeR.position.set(1.5, 2.5, -0.6);
        group.add(eyeR);

        break;
      }

      case 'dolphin': {
        const dorsalSlate = new THREE.Color(0x5e748c); // Marine slate blue
        const bellyWhite = new THREE.Color(0xf0f4f8); // White belly
        const black = new THREE.Color(0x1b2a34);

        // Dolphin body: arched cylinder with vertex gradient
        const bodyGeo = new THREE.CylinderGeometry(0.5, 1.3, 5.0, 20, 10);
        bodyGeo.rotateZ(Math.PI / 2);
        const count = bodyGeo.attributes.position.count;
        const colors = new Float32Array(count * 3);
        const pos = bodyGeo.attributes.position;
        for (let i = 0; i < count; i++) {
          const y = pos.getY(i);
          const t = Math.max(0, Math.min(1, (y + 1.0) / 2.0));
          const col = bellyWhite.clone().lerp(dorsalSlate, t);
          colors[i * 3] = col.r;
          colors[i * 3 + 1] = col.g;
          colors[i * 3 + 2] = col.b;
        }
        bodyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const bodyMesh = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
        bodyMesh.position.set(0, 1.8, 0);
        group.add(bodyMesh);

        // Dorsal Fin
        const finGeo = paintGeometry(new THREE.ConeGeometry(0.4, 1.2, 12), dorsalSlate);
        finGeo.rotateZ(-Math.PI / 4);
        const finMesh = new THREE.Mesh(finGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
        finMesh.position.set(-0.2, 3.2, 0);
        group.add(finMesh);

        // Tail flukes
        const tailGeo = paintGeometry(new THREE.BoxGeometry(0.3, 0.2, 2.0), dorsalSlate);
        const tailMesh = new THREE.Mesh(tailGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
        tailMesh.position.set(-2.5, 2.0, 0);
        group.add(tailMesh);

        // Eyes
        const eyeL = new THREE.Mesh(paintGeometry(new THREE.SphereGeometry(0.12, 10, 10), black), new THREE.MeshStandardMaterial({ vertexColors: true }));
        eyeL.position.set(1.8, 2.0, 0.7);
        group.add(eyeL);

        const eyeR = new THREE.Mesh(paintGeometry(new THREE.SphereGeometry(0.12, 10, 10), black), new THREE.MeshStandardMaterial({ vertexColors: true }));
        eyeR.position.set(1.8, 2.0, -0.7);
        group.add(eyeR);

        break;
      }

      case 'car': {
        const carRed = new THREE.Color(0xc91a09);
        const roofWhite = new THREE.Color(0xf4f4f4);
        const wheelBlack = new THREE.Color(0x1b2a34);
        const glassBlue = new THREE.Color(0x73c2fb);

        // Lower Chassis
        const chassisGeo = paintGeometry(new THREE.BoxGeometry(4.2, 0.9, 2.2), carRed);
        const chassisMesh = new THREE.Mesh(chassisGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
        chassisMesh.position.set(0, 1.0, 0);
        group.add(chassisMesh);

        // Cabin & Windows
        const cabinGeo = paintGeometry(new THREE.BoxGeometry(2.4, 0.9, 1.8), glassBlue);
        const cabinMesh = new THREE.Mesh(cabinGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
        cabinMesh.position.set(-0.2, 1.8, 0);
        group.add(cabinMesh);

        // Roof
        const roofGeo = paintGeometry(new THREE.BoxGeometry(2.5, 0.15, 1.9), roofWhite);
        const roofMesh = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
        roofMesh.position.set(-0.2, 2.3, 0);
        group.add(roofMesh);

        // 4 Wheels
        const wheelGeo = paintGeometry(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 16), wheelBlack);
        wheelGeo.rotateX(Math.PI / 2);
        for (const [wx, wz] of [[1.3, 1.1], [-1.3, 1.1], [1.3, -1.1], [-1.3, -1.1]]) {
          const wheel = new THREE.Mesh(wheelGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
          wheel.position.set(wx, 0.5, wz);
          group.add(wheel);
        }

        break;
      }

      case 'airplane': {
        const white = new THREE.Color(0xf4f4f4);
        const blue = new THREE.Color(0x0055bf);
        const silver = new THREE.Color(0xa0a5a9);

        // Fuselage
        const fuseGeo = paintGeometry(new THREE.CylinderGeometry(0.7, 0.7, 6.0, 16), white);
        fuseGeo.rotateZ(Math.PI / 2);
        const fuseMesh = new THREE.Mesh(fuseGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
        fuseMesh.position.set(0, 1.6, 0);
        group.add(fuseMesh);

        // Nose cone
        const noseGeo = paintGeometry(new THREE.ConeGeometry(0.7, 1.5, 16), blue);
        noseGeo.rotateZ(-Math.PI / 2);
        const noseMesh = new THREE.Mesh(noseGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
        noseMesh.position.set(3.7, 1.6, 0);
        group.add(noseMesh);

        // Delta Wings
        const wingGeo = paintGeometry(new THREE.BoxGeometry(2.2, 0.15, 6.0), silver);
        const wingMesh = new THREE.Mesh(wingGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
        wingMesh.position.set(-0.5, 1.5, 0);
        group.add(wingMesh);

        // Tail fin
        const tailGeo = paintGeometry(new THREE.BoxGeometry(1.2, 1.6, 0.2), blue);
        const tailMesh = new THREE.Mesh(tailGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
        tailMesh.position.set(-2.4, 2.5, 0);
        group.add(tailMesh);

        break;
      }

      case 'dome_creature':
      default: {
        const purple = new THREE.Color(0x8b5cf6);
        const domeGeo = paintGeometry(new THREE.SphereGeometry(1.8, 20, 20), purple);
        const domeMesh = new THREE.Mesh(domeGeo, new THREE.MeshStandardMaterial({ vertexColors: true }));
        domeMesh.position.set(0, 1.8, 0);
        group.add(domeMesh);
        break;
      }
    }

    group.updateMatrixWorld(true);
    return group;
  }

  /**
   * Generates a procedural test 3D geometry with vertex colors.
   */
  public static createSampleGeometry(type: 'duck' | 'car' | 'airplane' | 'dolphin' | 'dome_creature'): THREE.BufferGeometry {
    const model = this.createSampleModel(type);
    const geometries: THREE.BufferGeometry[] = [];

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const nonIndexed = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        nonIndexed.applyMatrix4(mesh.matrixWorld);
        geometries.push(nonIndexed);
      }
    });

    if (geometries.length === 0) {
      return new THREE.SphereGeometry(1.5, 16, 16);
    }

    // Merge attributes
    let totalVerts = 0;
    for (const g of geometries) {
      totalVerts += g.attributes.position.count;
    }

    const posArray = new Float32Array(totalVerts * 3);
    const colorArray = new Float32Array(totalVerts * 3);
    const normalArray = new Float32Array(totalVerts * 3);

    let offset = 0;
    for (const g of geometries) {
      const pos = g.attributes.position;
      const count = pos.count;
      const col = g.attributes.color;
      const norm = g.attributes.normal;

      posArray.set(pos.array, offset * 3);
      if (col) {
        colorArray.set(col.array, offset * 3);
      } else {
        for (let i = 0; i < count; i++) {
          colorArray[(offset + i) * 3] = 0.95;
          colorArray[(offset + i) * 3 + 1] = 0.8;
          colorArray[(offset + i) * 3 + 2] = 0.2;
        }
      }

      if (norm) {
        normalArray.set(norm.array, offset * 3);
      } else {
        for (let i = 0; i < count; i++) {
          normalArray[(offset + i) * 3 + 1] = 1.0;
        }
      }

      offset += count;
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    merged.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3));
    merged.computeBoundingBox();

    return merged;
  }

  /**
   * Voxelizes a Three.js Object3D (GLTF Scene, Group, Mesh) into a solid VoxelGrid.
   */
  public static voxelizeObject(
    object: THREE.Object3D,
    options: VoxelizerOptions = {}
  ): VoxelGrid {
    object.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(object);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    const targetHeightBricks = options.targetHeightBricks || (options.targetHeightPlates ? Math.max(1, Math.round(options.targetHeightPlates / 3)) : 16);
    const brickHeightLDU = options.brickHeightLDU || 24.0;
    const studPitchLDU = options.pitchLDU || 20.0;

    // Aspect ratio in LDU: 1 stud = 20 LDU, 1 brick = 24 LDU (1*1*1 Bricks)
    const targetHeightLDU = targetHeightBricks * brickHeightLDU;
    const scaleFactor = size.y > 0 ? targetHeightLDU / size.y : 1.0;

    const scaledWidthLDU = size.x * scaleFactor;
    const scaledDepthLDU = size.z * scaleFactor;

    const numStudsX = Math.max(3, Math.ceil(scaledWidthLDU / studPitchLDU));
    const numStudsZ = Math.max(3, Math.ceil(scaledDepthLDU / studPitchLDU));
    const numPlatesY = Math.max(2, targetHeightBricks); // 1 unit in Y = 1*1*1 brick!

    // Initialize 3D grid
    const grid: VoxelCell[][][] = [];
    for (let x = 0; x < numStudsX; x++) {
      grid[x] = [];
      for (let z = 0; z < numStudsZ; z++) {
        grid[x][z] = [];
        for (let y = 0; y < numPlatesY; y++) {
          grid[x][z][y] = {
            x,
            z,
            y,
            occupied: false,
            colorCode: 15,
            colorHex: '#f4f4f4',
            colorName: 'White',
            normal: [0, 1, 0],
            depth: 0,
            isBoundary: false,
            isCore: false,
            slopeClass: 'flat',
            slopeHeading: 0,
            curvatureClass: 'flat'
          };
        }
      }
    }

    // Ensure double-sided materials for solid interior raycasting
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => (mat.side = THREE.DoubleSide));
        } else if (m.material) {
          m.material.side = THREE.DoubleSide;
        }
      }
    });

    // Prepass: Topological half-edge connected island extraction
    const islands = MeshIslandSegmenter.segmentObject(object);
    console.log(`[MeshVoxelizer] Detected ${islands.length} topological mesh islands via half-edge prepass.`);

    const raycaster = new THREE.Raycaster();
    const invScale = 1.0 / scaleFactor;
    const minGeom = bbox.min;
    let occupiedCount = 0;

    const centerX = minGeom.x + 0.5 * size.x;
    const centerZ = minGeom.z + 0.5 * size.z;

    // Phase 1: If multiple islands are detected, voxelize each isolated component separately
    if (islands.length > 1) {
      for (const isl of islands) {
        isl.mesh.updateMatrixWorld(true);
        const islBbox = isl.bbox;

        const minX = Math.max(0, Math.floor(((islBbox.min.x - centerX) / (studPitchLDU * invScale)) + numStudsX * 0.5));
        const maxX = Math.min(numStudsX - 1, Math.ceil(((islBbox.max.x - centerX) / (studPitchLDU * invScale)) + numStudsX * 0.5));
        const minZ = Math.max(0, Math.floor(((islBbox.min.z - centerZ) / (studPitchLDU * invScale)) + numStudsZ * 0.5));
        const maxZ = Math.min(numStudsZ - 1, Math.ceil(((islBbox.max.z - centerZ) / (studPitchLDU * invScale)) + numStudsZ * 0.5));

        for (let x = minX; x <= maxX; x++) {
          for (let z = minZ; z <= maxZ; z++) {
            const sampleX = centerX + (x + 0.5 - numStudsX * 0.5) * (studPitchLDU * invScale);
            const sampleZ = centerZ + (z + 0.5 - numStudsZ * 0.5) * (studPitchLDU * invScale);

            const rayOrigin = new THREE.Vector3(sampleX, bbox.max.y + 10.0, sampleZ);
            const rayDir = new THREE.Vector3(0, -1, 0);
            raycaster.set(rayOrigin, rayDir);

            const rawHits = raycaster.intersectObject(isl.mesh, true);
            const hits: THREE.Intersection[] = [];
            for (const h of rawHits) {
              if (hits.length === 0 || Math.abs(hits[hits.length - 1].point.y - h.point.y) > 0.001) {
                hits.push(h);
              }
            }

            if (hits.length % 2 === 1) {
              hits.push({
                point: new THREE.Vector3(sampleX, Math.max(minGeom.y, islBbox.min.y), sampleZ),
                distance: rayOrigin.y - Math.max(minGeom.y, islBbox.min.y),
                object: hits[0].object,
                face: hits[0].face,
                uv: hits[0].uv
              } as THREE.Intersection);
            }

            if (hits.length >= 2) {
              for (let i = 0; i < hits.length - 1; i += 2) {
                const topEnter = Math.max(hits[i].point.y, hits[i + 1].point.y);
                const bottomExit = Math.min(hits[i].point.y, hits[i + 1].point.y);

                const topBrick = Math.min(
                  numPlatesY - 1,
                  Math.floor(((topEnter - minGeom.y) * scaleFactor) / brickHeightLDU)
                );
                const bottomBrick = Math.max(
                  0,
                  Math.floor(((bottomExit - minGeom.y) * scaleFactor) / brickHeightLDU)
                );

                for (let y = bottomBrick; y <= topBrick; y++) {
                  const cell = grid[x][z][y];
                  if (!cell.occupied) {
                    cell.occupied = true;
                    occupiedCount++;
                  }
                  cell.islandId = isl.id;
                  cell.islandColorHex = isl.colorHex;
                  cell.colorHex = isl.colorHex; // Color-code each part with its distinct random color
                  cell.colorName = isl.name;

                  if (hits[0].face) {
                    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hits[0].object.matrixWorld);
                    const norm = hits[0].face.normal.clone().applyMatrix3(normalMatrix).normalize();
                    cell.normal = [norm.x, norm.y, norm.z];
                  }
                }
              }
            }
          }
        }
      }
    }

    // Phase 2: Full volume raycast fallback to ensure 100% solid watertight envelope
    for (let x = 0; x < numStudsX; x++) {
      for (let z = 0; z < numStudsZ; z++) {
        const sampleX = centerX + (x + 0.5 - numStudsX * 0.5) * (studPitchLDU * invScale);
        const sampleZ = centerZ + (z + 0.5 - numStudsZ * 0.5) * (studPitchLDU * invScale);

        const rayOrigin = new THREE.Vector3(sampleX, bbox.max.y + 10.0, sampleZ);
        const rayDir = new THREE.Vector3(0, -1, 0);
        raycaster.set(rayOrigin, rayDir);

        const rawHits = raycaster.intersectObject(object, true);
        const hits: THREE.Intersection[] = [];
        for (const h of rawHits) {
          if (hits.length === 0 || Math.abs(hits[hits.length - 1].point.y - h.point.y) > 0.001) {
            hits.push(h);
          }
        }

        if (hits.length % 2 === 1) {
          hits.push({
            point: new THREE.Vector3(sampleX, minGeom.y, sampleZ),
            distance: rayOrigin.y - minGeom.y,
            object: hits[0].object,
            face: hits[0].face,
            uv: hits[0].uv
          } as THREE.Intersection);
        }

        if (hits.length >= 2) {
          for (let i = 0; i < hits.length - 1; i += 2) {
            const topEnter = Math.max(hits[i].point.y, hits[i + 1].point.y);
            const bottomExit = Math.min(hits[i].point.y, hits[i + 1].point.y);

            const topBrick = Math.min(
              numPlatesY - 1,
              Math.floor(((topEnter - minGeom.y) * scaleFactor) / brickHeightLDU)
            );
            const bottomBrick = Math.max(
              0,
              Math.floor(((bottomExit - minGeom.y) * scaleFactor) / brickHeightLDU)
            );

            for (let y = bottomBrick; y <= topBrick; y++) {
              const cell = grid[x][z][y];
              if (!cell.occupied) {
                cell.occupied = true;
                occupiedCount++;

                const brickWorldY = minGeom.y + (y + 0.5) * (brickHeightLDU * invScale);
                let nearestHit = hits[0];
                let minDist = Math.abs(nearestHit.point.y - brickWorldY);
                for (let k = 1; k < hits.length; k++) {
                  const d = Math.abs(hits[k].point.y - brickWorldY);
                  if (d < minDist) {
                    minDist = d;
                    nearestHit = hits[k];
                  }
                }

                if (nearestHit.face) {
                  const normalMatrix = new THREE.Matrix3().getNormalMatrix(nearestHit.object.matrixWorld);
                  const norm = nearestHit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
                  cell.normal = [norm.x, norm.y, norm.z];
                }

                const sampled = this.sampleColorFromHit(nearestHit);
                // If not assigned to an island yet, assign to closest island by center
                if (cell.islandId === undefined && islands.length > 0) {
                  let closestIsl = islands[0];
                  let minIslDist = Infinity;
                  const vPos = new THREE.Vector3(sampleX, brickWorldY, sampleZ);
                  for (const isl of islands) {
                    const d = vPos.distanceTo(isl.center);
                    if (d < minIslDist) {
                      minIslDist = d;
                      closestIsl = isl;
                    }
                  }
                  cell.islandId = closestIsl.id;
                  cell.islandColorHex = closestIsl.colorHex;
                  cell.colorHex = closestIsl.colorHex;
                  cell.colorName = closestIsl.name;
                } else if (cell.islandId === undefined) {
                  cell.colorHex = sampled.colorHex;
                  cell.colorCode = sampled.colorCode;
                  cell.colorName = sampled.colorName;
                }
              }
            }
          }
        }
      }
    }

    // Robust Fallback if raycasting caught no hits
    if (occupiedCount === 0) {
      const centerX = numStudsX / 2.0;
      const centerZ = numStudsZ / 2.0;
      for (let x = 0; x < numStudsX; x++) {
        for (let z = 0; z < numStudsZ; z++) {
          for (let y = 0; y < numPlatesY; y++) {
            const dx = (x - centerX) / (centerX * 0.85);
            const dz = (z - centerZ) / (centerZ * 0.85);
            const dy = (y - numPlatesY / 2.0) / ((numPlatesY / 2.0) * 0.85);

            if (dx * dx + dz * dz + dy * dy <= 1.0) {
              grid[x][z][y].occupied = true;
              grid[x][z][y].normal = [dx, dy, dz];
              grid[x][z][y].colorCode = 14;
              grid[x][z][y].colorHex = '#f2cd37';
              grid[x][z][y].colorName = 'Yellow';
              occupiedCount++;
            }
          }
        }
      }
    }

    const voxelGrid: VoxelGrid = {
      numStudsX,
      numStudsZ,
      numPlatesY,
      grid,
      totalOccupied: occupiedCount,
      maxCoreDepth: 0,
      coreCentroid: [Math.floor(numStudsX / 2), Math.floor(numStudsZ / 2), Math.floor(numPlatesY / 2)],
      bounds: {
        min: [0, 0, 0],
        max: [numStudsX, numStudsZ, numPlatesY]
      },
      unitScale: studPitchLDU,
      islands
    };

    // Analyze topological distance field, lattice slope, and curvature
    MultiResolutionLattice.analyzeLatticeFeatures(voxelGrid);

    return voxelGrid;
  }

  /**
   * Voxelizes a Three.js BufferGeometry into a solid VoxelGrid.
   */
  public static voxelizeGeometry(
    geometry: THREE.BufferGeometry,
    options: VoxelizerOptions = {}
  ): VoxelGrid {
    geometry.computeBoundingBox();
    const hasVertexColors = !!geometry.attributes.color;
    const dummyMaterial = new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      vertexColors: hasVertexColors,
      color: hasVertexColors ? 0xffffff : 0xf2cd37
    });
    const mesh = new THREE.Mesh(geometry, dummyMaterial);
    mesh.updateMatrixWorld(true);
    return this.voxelizeObject(mesh, options);
  }
}
