/**
 * Autodesk 3DS (.3ds) Binary File Parser for Brickator 3000.
 *
 * Implements a complete chunk-based binary parser for the Autodesk 3DS format:
 * - Traverses Main (0x4D4D) and 3D Editor (0x3D3D) chunk hierarchy
 * - Parses all Material blocks (0xAFFF) including names, ambient/diffuse/specular colors (COLOR_24 & COLOR_F),
 *   shininess, transparency, and texture map references
 * - Parses Named Objects (0x4000) and Triangular Meshes (0x4100):
 *   * Vertices list (0x4110) with coordinate system conversion (3DS Z-up to Three.js Y-up)
 *   * Face index descriptions (0x4120)
 *   * Per-face material groups (0x4130) with accurate diffuse color assignment
 *   * UV mapping coordinates (0x4140)
 *   * Mesh transform matrices (0x4160)
 * - Constructs standard Three.js BufferGeometry with per-vertex colors and MeshStandardMaterial,
 *   ready for real-time WebGL, Path Tracing, and LEGO Discretization.
 */

import * as THREE from 'three';

// 3DS Chunk Identifiers
export const CHUNK_MAGIC_MAIN = 0x4D4D;
export const CHUNK_3D_EDITOR = 0x3D3D;
export const CHUNK_VERSION = 0x0002;
export const CHUNK_MESH_VERSION = 0x3D3E;
export const CHUNK_MASTER_SCALE = 0x0100;

export const CHUNK_COLOR_F = 0x0010;
export const CHUNK_COLOR_24 = 0x0011;
export const CHUNK_LIN_COLOR_24 = 0x0012;
export const CHUNK_LIN_COLOR_F = 0x0013;

export const CHUNK_INT_PERCENTAGE = 0x0030;
export const CHUNK_FLOAT_PERCENTAGE = 0x0031;

export const CHUNK_MATERIAL_ENTRY = 0xAFFF;
export const CHUNK_MAT_NAME = 0xA000;
export const CHUNK_MAT_AMBIENT = 0xA010;
export const CHUNK_MAT_DIFFUSE = 0xA020;
export const CHUNK_MAT_SPECULAR = 0xA030;
export const CHUNK_MAT_SHININESS = 0xA040;
export const CHUNK_MAT_TRANSPARENCY = 0xA050;
export const CHUNK_MAT_TWO_SIDE = 0xA081;
export const CHUNK_MAT_TEXMAP = 0xA200;
export const CHUNK_MAT_MAPNAME = 0xA300;

export const CHUNK_NAMED_OBJECT = 0x4000;
export const CHUNK_TRI_OBJECT = 0x4100;
export const CHUNK_VERTICES_LIST = 0x4110;
export const CHUNK_FACES_ARRAY = 0x4120;
export const CHUNK_MAT_GROUP = 0x4130;
export const CHUNK_MAPPING_COORDS = 0x4140;
export const CHUNK_SMOOTH_GROUP = 0x4150;
export const CHUNK_MESH_MATRIX = 0x4160;

export interface TDSParserOptions {
  /** Convert 3DS native coordinates (Z-up, Y-depth) to Three.js (Y-up, -Z depth). Default: 'z-up-to-y-up' */
  coordinateConversion?: 'z-up-to-y-up' | 'none';
  /** Generate per-vertex RGB colors on geometry from material groups. Default: true */
  generateVertexColors?: boolean;
  /** Fallback color if no material or face group is defined. Default: 0x05131D (Black) */
  defaultColor?: number;
  /** Whether to log diagnostic information during parsing. Default: false */
  debug?: boolean;
}

export interface TDSMaterialData {
  name: string;
  ambient: THREE.Color;
  diffuse: THREE.Color;
  specular: THREE.Color;
  shininess: number;
  opacity: number;
  twoSided?: boolean;
  textureMapName?: string;
}

export interface TDSFaceGroupData {
  materialName: string;
  faceIndices: number[];
}

export class TDSParser {
  private view: DataView;
  private options: Required<TDSParserOptions>;
  private materials = new Map<string, TDSMaterialData>();
  private meshes: THREE.Mesh[] = [];
  private masterScale: number = 1.0;

  constructor(buffer: ArrayBuffer | Uint8Array, options?: TDSParserOptions) {
    if (buffer instanceof Uint8Array) {
      this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
      this.view = new DataView(buffer);
    }

    this.options = {
      coordinateConversion: options?.coordinateConversion ?? 'z-up-to-y-up',
      generateVertexColors: options?.generateVertexColors ?? true,
      defaultColor: options?.defaultColor ?? 0x05131D,
      debug: options?.debug ?? false
    };
  }

  /**
   * Static helper to parse a .3ds ArrayBuffer directly into a Three.js Group
   */
  public static parse(buffer: ArrayBuffer | Uint8Array, options?: TDSParserOptions): THREE.Group {
    const parser = new TDSParser(buffer, options);
    return parser.parse();
  }

  /**
   * Parses the binary 3DS buffer and returns a populated THREE.Group
   */
  public parse(): THREE.Group {
    if (this.view.byteLength < 6) {
      throw new Error('Invalid .3DS file: Buffer is too small (< 6 bytes).');
    }

    const rootId = this.view.getUint16(0, true);
    const rootLen = this.view.getUint32(2, true);

    if (rootId !== CHUNK_MAGIC_MAIN) {
      throw new Error(`Invalid .3DS file: Unexpected root magic 0x${rootId.toString(16)} (expected 0x4D4D).`);
    }

    let pos = 6;
    const end = Math.min(rootLen, this.view.byteLength);

    while (pos + 6 <= end) {
      const chunkId = this.view.getUint16(pos, true);
      const chunkLen = this.view.getUint32(pos + 2, true);

      if (chunkLen < 6) {
        if (this.options.debug) console.warn(`Invalid chunk length ${chunkLen} at offset ${pos}`);
        break;
      }

      if (chunkId === CHUNK_3D_EDITOR) {
        this.parse3DEditorChunk(pos + 6, chunkLen - 6);
      }

      pos += chunkLen;
    }

    const group = new THREE.Group();
    group.name = 'TDSModel';

    if (this.masterScale !== 1.0) {
      group.scale.set(this.masterScale, this.masterScale, this.masterScale);
    }

    for (const mesh of this.meshes) {
      group.add(mesh);
    }

    return group;
  }

  /**
   * Traverses the 3D Editor chunk (0x3D3D)
   */
  private parse3DEditorChunk(startPos: number, length: number): void {
    let pos = startPos;
    const end = Math.min(startPos + length, this.view.byteLength);

    while (pos + 6 <= end) {
      const chunkId = this.view.getUint16(pos, true);
      const chunkLen = this.view.getUint32(pos + 2, true);

      if (chunkLen < 6) break;

      if (chunkId === CHUNK_MASTER_SCALE) {
        this.masterScale = this.view.getFloat32(pos + 6, true);
      } else if (chunkId === CHUNK_MATERIAL_ENTRY) {
        this.parseMaterialEntry(pos + 6, chunkLen - 6);
      } else if (chunkId === CHUNK_NAMED_OBJECT) {
        this.parseNamedObject(pos + 6, chunkLen - 6);
      }

      pos += chunkLen;
    }
  }

  /**
   * Parses Material Chunk (0xAFFF)
   */
  private parseMaterialEntry(startPos: number, length: number): void {
    let pos = startPos;
    const end = Math.min(startPos + length, this.view.byteLength);

    let name = '';
    let ambient = new THREE.Color(0.2, 0.2, 0.2);
    let diffuse = new THREE.Color(0.8, 0.8, 0.8);
    let specular = new THREE.Color(0.1, 0.1, 0.1);
    let shininess = 0.25;
    let opacity = 1.0;
    let twoSided = false;
    let textureMapName: string | undefined = undefined;

    while (pos + 6 <= end) {
      const chunkId = this.view.getUint16(pos, true);
      const chunkLen = this.view.getUint32(pos + 2, true);

      if (chunkLen < 6) break;

      if (chunkId === CHUNK_MAT_NAME) {
        name = this.readNullTerminatedString(pos + 6, chunkLen - 6).text;
      } else if (chunkId === CHUNK_MAT_AMBIENT) {
        ambient = this.parseColorSubchunk(pos + 6, chunkLen - 6) || ambient;
      } else if (chunkId === CHUNK_MAT_DIFFUSE) {
        diffuse = this.parseColorSubchunk(pos + 6, chunkLen - 6) || diffuse;
      } else if (chunkId === CHUNK_MAT_SPECULAR) {
        specular = this.parseColorSubchunk(pos + 6, chunkLen - 6) || specular;
      } else if (chunkId === CHUNK_MAT_SHININESS) {
        shininess = this.parsePercentageSubchunk(pos + 6, chunkLen - 6);
      } else if (chunkId === CHUNK_MAT_TRANSPARENCY) {
        opacity = 1.0 - this.parsePercentageSubchunk(pos + 6, chunkLen - 6);
      } else if (chunkId === CHUNK_MAT_TWO_SIDE) {
        twoSided = true;
      } else if (chunkId === CHUNK_MAT_TEXMAP) {
        textureMapName = this.parseTextureMapSubchunk(pos + 6, chunkLen - 6);
      }

      pos += chunkLen;
    }

    if (name) {
      this.materials.set(name, {
        name,
        ambient,
        diffuse,
        specular,
        shininess,
        opacity,
        twoSided,
        textureMapName
      });
    }
  }

  /**
   * Parses Named Object (0x4000)
   */
  private parseNamedObject(startPos: number, length: number): void {
    const { text: objectName, nextOffset } = this.readNullTerminatedString(startPos, length);
    let pos = nextOffset;
    const end = Math.min(startPos + length, this.view.byteLength);

    while (pos + 6 <= end) {
      const chunkId = this.view.getUint16(pos, true);
      const chunkLen = this.view.getUint32(pos + 2, true);

      if (chunkLen < 6) break;

      if (chunkId === CHUNK_TRI_OBJECT) {
        this.parseTriangularObject(objectName, pos + 6, chunkLen - 6);
      }

      pos += chunkLen;
    }
  }

  /**
   * Parses Triangular Object Mesh (0x4100)
   */
  private parseTriangularObject(objectName: string, startPos: number, length: number): void {
    let pos = startPos;
    const end = Math.min(startPos + length, this.view.byteLength);

    let rawVertices: Float32Array | null = null;
    let rawFaces: Uint16Array | null = null;
    let rawUvs: Float32Array | null = null;
    let localMatrix: THREE.Matrix4 | null = null;
    const materialGroups: TDSFaceGroupData[] = [];

    while (pos + 6 <= end) {
      const chunkId = this.view.getUint16(pos, true);
      const chunkLen = this.view.getUint32(pos + 2, true);

      if (chunkLen < 6) break;

      if (chunkId === CHUNK_VERTICES_LIST) {
        const count = this.view.getUint16(pos + 6, true);
        rawVertices = new Float32Array(count * 3);
        let vp = pos + 8;
        const isZUp = this.options.coordinateConversion === 'z-up-to-y-up';

        for (let i = 0; i < count; i++) {
          if (vp + 12 > this.view.byteLength) break;
          const x = this.view.getFloat32(vp + 0, true);
          const y = this.view.getFloat32(vp + 4, true);
          const z = this.view.getFloat32(vp + 8, true);

          if (isZUp) {
            // Rigid -90 deg rotation around X axis: (x, y, z) -> (x, z, -y)
            rawVertices[i * 3 + 0] = x;
            rawVertices[i * 3 + 1] = z;
            rawVertices[i * 3 + 2] = -y;
          } else {
            rawVertices[i * 3 + 0] = x;
            rawVertices[i * 3 + 1] = y;
            rawVertices[i * 3 + 2] = z;
          }
          vp += 12;
        }
      } else if (chunkId === CHUNK_FACES_ARRAY) {
        const faceCount = this.view.getUint16(pos + 6, true);
        rawFaces = new Uint16Array(faceCount * 3);
        let fp = pos + 8;

        for (let i = 0; i < faceCount; i++) {
          if (fp + 6 > this.view.byteLength) break;
          rawFaces[i * 3 + 0] = this.view.getUint16(fp + 0, true);
          rawFaces[i * 3 + 1] = this.view.getUint16(fp + 2, true);
          rawFaces[i * 3 + 2] = this.view.getUint16(fp + 4, true);
          fp += 8; // uint16 a, b, c + uint16 flags
        }

        // Subchunks within face array (e.g. material groups 0x4130, smooth groups 0x4150)
        let subPos = fp;
        const faceChunkEnd = pos + chunkLen;

        while (subPos + 6 <= faceChunkEnd && subPos + 6 <= this.view.byteLength) {
          const sId = this.view.getUint16(subPos, true);
          const sLen = this.view.getUint32(subPos + 2, true);

          if (sLen < 6) break;

          if (sId === CHUNK_MAT_GROUP) {
            const { text: matName, nextOffset: mend } = this.readNullTerminatedString(subPos + 6, sLen - 6);
            if (mend + 2 <= this.view.byteLength) {
              const nFaces = this.view.getUint16(mend, true);
              const faceIndices: number[] = [];
              let ip = mend + 2;
              for (let j = 0; j < nFaces; j++) {
                if (ip + 2 > this.view.byteLength) break;
                faceIndices.push(this.view.getUint16(ip, true));
                ip += 2;
              }
              materialGroups.push({ materialName: matName, faceIndices });
            }
          }

          subPos += sLen;
        }
      } else if (chunkId === CHUNK_MAPPING_COORDS) {
        const uvCount = this.view.getUint16(pos + 6, true);
        rawUvs = new Float32Array(uvCount * 2);
        let up = pos + 8;

        for (let i = 0; i < uvCount; i++) {
          if (up + 8 > this.view.byteLength) break;
          rawUvs[i * 2 + 0] = this.view.getFloat32(up + 0, true);
          rawUvs[i * 2 + 1] = this.view.getFloat32(up + 4, true);
          up += 8;
        }
      } else if (chunkId === CHUNK_MESH_MATRIX) {
        // 4x3 local coordinate system matrix
        let mp = pos + 6;
        if (mp + 48 <= this.view.byteLength) {
          const vals: number[] = [];
          for (let i = 0; i < 12; i++) {
            vals.push(this.view.getFloat32(mp, true));
            mp += 4;
          }
          const m = new THREE.Matrix4();
          m.set(
            vals[0], vals[3], vals[6], vals[9],
            vals[1], vals[4], vals[7], vals[10],
            vals[2], vals[5], vals[8], vals[11],
            0, 0, 0, 1
          );
          localMatrix = m;
        }
      }

      pos += chunkLen;
    }

    if (!rawVertices || !rawFaces || rawFaces.length === 0) {
      return;
    }

    // Build unrolled non-indexed triangle buffer for exact material coloring and clean vertex normals
    const faceCount = rawFaces.length / 3;
    const vertexCount = faceCount * 3;
    const posBuffer = new Float32Array(vertexCount * 3);
    const colBuffer = new Float32Array(vertexCount * 4);
    const uvBuffer = rawUvs ? new Float32Array(vertexCount * 2) : null;

    // Map each face to its assigned material color
    const faceColors = new Array<THREE.Color>(faceCount);
    const fallbackColor = new THREE.Color(this.options.defaultColor);

    for (let f = 0; f < faceCount; f++) {
      faceColors[f] = fallbackColor;
    }

    for (const group of materialGroups) {
      const mat = this.materials.get(group.materialName);
      const col = mat ? mat.diffuse : fallbackColor;
      for (const fIdx of group.faceIndices) {
        if (fIdx < faceCount) {
          faceColors[fIdx] = col;
        }
      }
    }

    const numVerts = rawVertices.length / 3;

    for (let f = 0; f < faceCount; f++) {
      const iA = rawFaces[f * 3 + 0];
      const iB = rawFaces[f * 3 + 1];
      const iC = rawFaces[f * 3 + 2];
      const col = faceColors[f];

      const vBase = f * 9;
      const cBase = f * 12;

      // Vertex A
      if (iA < numVerts) {
        posBuffer[vBase + 0] = rawVertices[iA * 3 + 0];
        posBuffer[vBase + 1] = rawVertices[iA * 3 + 1];
        posBuffer[vBase + 2] = rawVertices[iA * 3 + 2];
      }
      colBuffer[cBase + 0] = col.r;
      colBuffer[cBase + 1] = col.g;
      colBuffer[cBase + 2] = col.b;
      colBuffer[cBase + 3] = 1.0;

      // Vertex B
      if (iB < numVerts) {
        posBuffer[vBase + 3] = rawVertices[iB * 3 + 0];
        posBuffer[vBase + 4] = rawVertices[iB * 3 + 1];
        posBuffer[vBase + 5] = rawVertices[iB * 3 + 2];
      }
      colBuffer[cBase + 4] = col.r;
      colBuffer[cBase + 5] = col.g;
      colBuffer[cBase + 6] = col.b;
      colBuffer[cBase + 7] = 1.0;

      // Vertex C
      if (iC < numVerts) {
        posBuffer[vBase + 6] = rawVertices[iC * 3 + 0];
        posBuffer[vBase + 7] = rawVertices[iC * 3 + 1];
        posBuffer[vBase + 8] = rawVertices[iC * 3 + 2];
      }
      colBuffer[cBase + 8] = col.r;
      colBuffer[cBase + 9] = col.g;
      colBuffer[cBase + 10] = col.b;
      colBuffer[cBase + 11] = 1.0;

      // UVs if available
      if (uvBuffer && rawUvs) {
        const uBase = f * 6;
        if (iA * 2 + 1 < rawUvs.length) {
          uvBuffer[uBase + 0] = rawUvs[iA * 2 + 0];
          uvBuffer[uBase + 1] = rawUvs[iA * 2 + 1];
        }
        if (iB * 2 + 1 < rawUvs.length) {
          uvBuffer[uBase + 2] = rawUvs[iB * 2 + 0];
          uvBuffer[uBase + 3] = rawUvs[iB * 2 + 1];
        }
        if (iC * 2 + 1 < rawUvs.length) {
          uvBuffer[uBase + 4] = rawUvs[iC * 2 + 0];
          uvBuffer[uBase + 5] = rawUvs[iC * 2 + 1];
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(posBuffer, 3));

    if (this.options.generateVertexColors) {
      geometry.setAttribute('color', new THREE.BufferAttribute(colBuffer, 4));
    }

    if (uvBuffer) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvBuffer, 2));
    }

    geometry.computeVertexNormals();

    // Standard PBR Material
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: this.options.generateVertexColors,
      roughness: 0.35,
      metalness: 0.05,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = objectName || `mesh_${this.meshes.length}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      materialGroups,
      materials: Array.from(this.materials.keys())
    };

    this.meshes.push(mesh);
  }

  /**
   * Reads RGB color from subchunks (COLOR_24, COLOR_F, LIN_COLOR_24, LIN_COLOR_F)
   */
  private parseColorSubchunk(startPos: number, length: number): THREE.Color | null {
    let pos = startPos;
    const end = Math.min(startPos + length, this.view.byteLength);

    while (pos + 6 <= end) {
      const chunkId = this.view.getUint16(pos, true);
      const chunkLen = this.view.getUint32(pos + 2, true);

      if (chunkLen < 6) break;

      if (chunkId === CHUNK_COLOR_24 || chunkId === CHUNK_LIN_COLOR_24) {
        if (pos + 9 <= this.view.byteLength) {
          const r = this.view.getUint8(pos + 6) / 255;
          const g = this.view.getUint8(pos + 7) / 255;
          const b = this.view.getUint8(pos + 8) / 255;
          return new THREE.Color(r, g, b);
        }
      } else if (chunkId === CHUNK_COLOR_F || chunkId === CHUNK_LIN_COLOR_F) {
        if (pos + 18 <= this.view.byteLength) {
          const r = this.view.getFloat32(pos + 6, true);
          const g = this.view.getFloat32(pos + 10, true);
          const b = this.view.getFloat32(pos + 14, true);
          return new THREE.Color(r, g, b);
        }
      }

      pos += chunkLen;
    }

    return null;
  }

  /**
   * Reads percentage value from INT_PERCENTAGE (0-100) or FLOAT_PERCENTAGE (0.0-1.0)
   */
  private parsePercentageSubchunk(startPos: number, length: number): number {
    let pos = startPos;
    const end = Math.min(startPos + length, this.view.byteLength);

    while (pos + 6 <= end) {
      const chunkId = this.view.getUint16(pos, true);
      const chunkLen = this.view.getUint32(pos + 2, true);

      if (chunkLen < 6) break;

      if (chunkId === CHUNK_INT_PERCENTAGE) {
        if (pos + 8 <= this.view.byteLength) {
          return this.view.getInt16(pos + 6, true) / 100;
        }
      } else if (chunkId === CHUNK_FLOAT_PERCENTAGE) {
        if (pos + 10 <= this.view.byteLength) {
          return this.view.getFloat32(pos + 6, true);
        }
      }

      pos += chunkLen;
    }

    return 0;
  }

  /**
   * Safely reads texture map name without throwing or attempting network requests
   */
  private parseTextureMapSubchunk(startPos: number, length: number): string | undefined {
    let pos = startPos;
    const end = Math.min(startPos + length, this.view.byteLength);

    while (pos + 6 <= end) {
      const chunkId = this.view.getUint16(pos, true);
      const chunkLen = this.view.getUint32(pos + 2, true);

      if (chunkLen < 6) break;

      if (chunkId === CHUNK_MAT_MAPNAME) {
        return this.readNullTerminatedString(pos + 6, chunkLen - 6).text;
      }

      pos += chunkLen;
    }

    return undefined;
  }

  /**
   * Reads a null-terminated ASCII string from the DataView
   */
  private readNullTerminatedString(offset: number, maxLen: number): { text: string; nextOffset: number } {
    let text = '';
    let pos = offset;
    const end = Math.min(offset + maxLen, this.view.byteLength);

    while (pos < end) {
      const byte = this.view.getUint8(pos++);
      if (byte === 0) break;
      text += String.fromCharCode(byte);
    }

    return { text, nextOffset: pos };
  }
}
