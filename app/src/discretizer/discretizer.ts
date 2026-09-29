import * as THREE from 'three';
import { LEGO_SOLID_PALETTE, matchOfficialLegoColor, LegoPaletteColor } from '../color_matcher';
import type {
  DiscretizerOptions,
  DiscretizedBrick,
  DiscretizationStats,
  DiscretizerResult,
  ResolutionPreset
} from './types';

// Metric constants in LDU (LDraw Units)
export const LDU_STUD_PITCH = 20;   // 1 stud in X and Z = 20 LDU = 8.0 mm
export const LDU_PLATE_HEIGHT = 8;  // 1 plate in Y = 8 LDU = 3.2 mm
export const LDU_BRICK_HEIGHT = 24; // 1 standard brick in Y = 24 LDU = 3 plates = 9.6 mm

interface VoxelCell {
  occupied: boolean;
  color: [number, number, number]; // RGB 0..255
  normal: [number, number, number];
  colorCode: number;
  colorHex: string;
  colorName: string;
  assigned: boolean;
  isSlopeCandidate?: boolean;
  slopeHeading?: number; // 0, 90, 180, 270
}

/**
 * Standard rotation matrices around Y for LDraw (row-major [a,b,c, d,e,f, g,h,i])
 */
const ROT_MATRICES: Record<number, number[]> = {
  0: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  90: [0, 0, 1, 0, 1, 0, -1, 0, 0],
  180: [-1, 0, 0, 0, 1, 0, 0, 0, -1],
  270: [0, 0, -1, 0, 1, 0, 1, 0, 0]
};

/**
 * Determines target bounding studs based on resolution preset
 */
function getTargetStuds(res: ResolutionPreset | number): number {
  if (typeof res === 'number') return Math.max(4, Math.min(64, res));
  switch (res) {
    case 'minimal': return 8;   // ~8x8 studs (micro-scale)
    case 'medium':  return 16;  // ~16x16 studs (desk sculpture)
    case 'large':   return 32;  // ~32x32 studs (display model)
    case 'full':    return 48;  // ~48x48 studs (collector-scale)
    default:        return 16;
  }
}

/**
 * LEGO 3D Discretizer: Converts any 3D Mesh, Point Cloud, or Splat into a buildable LEGO assembly.
 */
export class LegoDiscretizer {
  /**
   * Main entry point to discretize a Three.js BufferGeometry or Object3D
   */
  public static async discretize(
    objectOrGeometry: THREE.Object3D | THREE.BufferGeometry,
    options: DiscretizerOptions
  ): Promise<DiscretizerResult> {
    const startTime = performance.now();
    const targetStudDim = getTargetStuds(options.resolution);
    const enableSlopes = options.enableSlopes ?? true;
    const enableInterlocking = options.enableInterlocking ?? true;
    const removeFloating = options.removeFloating ?? true;

    // 1. Extract geometry and compute bounding box
    let geometry: THREE.BufferGeometry;
    let fallbackMaterialColor = new THREE.Color(0xf2cd37); // Default LEGO classic yellow

    if ((objectOrGeometry as THREE.Object3D).isObject3D) {
      const obj = objectOrGeometry as THREE.Object3D;
      const geometries: THREE.BufferGeometry[] = [];
      obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh || (child as THREE.Points).isPoints) {
          const mesh = child as THREE.Mesh;
          if (mesh.geometry) {
            const geomClone = mesh.geometry.clone();
            geomClone.applyMatrix4(mesh.matrixWorld);
            geometries.push(geomClone);
            if (mesh.material) {
              const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
              if ((mat as THREE.MeshStandardMaterial).color) {
                fallbackMaterialColor = (mat as THREE.MeshStandardMaterial).color;
              }
            }
          }
        }
      });
      if (geometries.length === 0) {
        throw new Error('No renderable meshes or points found in input 3D model.');
      }
      geometry = geometries[0]; // Primary geometry
    } else {
      geometry = objectOrGeometry as THREE.BufferGeometry;
    }

    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox || new THREE.Box3();
    const size = new THREE.Vector3();
    bbox.getSize(size);

    if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
      throw new Error('Input 3D model has invalid or zero dimensions.');
    }

    // 2. Compute non-cubic sub-plate grid dimensions
    // 1 stud pitch = 20 LDU in X and Z. 1 plate = 8 LDU in Y (1 brick = 3 plates).
    // Target: max horizontal dimension is mapped to targetStudDim.
    const maxHoriz = Math.max(size.x, size.z);
    const scaleStud = targetStudDim / maxHoriz;

    const numStudsX = Math.max(2, Math.round(size.x * scaleStud));
    const numStudsZ = Math.max(2, Math.round(size.z * scaleStud));
    // Plate height is 8/20 = 0.4 of stud pitch, so plates per unit height is (size.y * scaleStud) / 0.4
    const numPlatesY = Math.max(3, Math.round((size.y * scaleStud) / (8 / 20)));

    // 3. Initialize 3D Voxel Field: grid[x][z][y]
    const grid: VoxelCell[][][] = [];
    for (let x = 0; x < numStudsX; x++) {
      grid[x] = [];
      for (let z = 0; z < numStudsZ; z++) {
        grid[x][z] = [];
        for (let y = 0; y < numPlatesY; y++) {
          grid[x][z][y] = {
            occupied: false,
            color: [242, 205, 55], // Classic yellow fallback
            normal: [0, 1, 0],
            colorCode: 14,
            colorHex: '#F2CD37',
            colorName: 'Yellow',
            assigned: false
          };
        }
      }
    }

    // 4. Sample Geometry into Voxel Field
    const posAttr = geometry.getAttribute('position');
    const colorAttr = geometry.getAttribute('color');
    const normalAttr = geometry.getAttribute('normal');

    if (posAttr) {
      const vPos = new THREE.Vector3();
      const vNorm = new THREE.Vector3(0, 1, 0);
      const vCol = new THREE.Color();

      const count = posAttr.count;
      for (let i = 0; i < count; i++) {
        vPos.fromBufferAttribute(posAttr, i);

        // Normalize coordinate to [0..1] range within bounding box
        const normX = (vPos.x - bbox.min.x) / size.x;
        const normY = (vPos.y - bbox.min.y) / size.y;
        const normZ = (vPos.z - bbox.min.z) / size.z;

        const gx = Math.min(numStudsX - 1, Math.max(0, Math.floor(normX * numStudsX)));
        const gy = Math.min(numPlatesY - 1, Math.max(0, Math.floor(normY * numPlatesY)));
        const gz = Math.min(numStudsZ - 1, Math.max(0, Math.floor(normZ * numStudsZ)));

        const cell = grid[gx][gz][gy];
        cell.occupied = true;

        // Normal
        if (normalAttr) {
          vNorm.fromBufferAttribute(normalAttr, i);
          cell.normal = [vNorm.x, vNorm.y, vNorm.z];
        }

        // Color
        if (colorAttr) {
          vCol.fromBufferAttribute(colorAttr, i);
          cell.color = [Math.round(vCol.r * 255), Math.round(vCol.g * 255), Math.round(vCol.b * 255)];
        } else {
          cell.color = [
            Math.round(fallbackMaterialColor.r * 255),
            Math.round(fallbackMaterialColor.g * 255),
            Math.round(fallbackMaterialColor.b * 255)
          ];
        }
      }
    }

    // 5. Solid Infill: Fill horizontal gaps inside the model volume
    for (let y = 0; y < numPlatesY; y++) {
      for (let z = 0; z < numStudsZ; z++) {
        let firstX = -1;
        let lastX = -1;
        for (let x = 0; x < numStudsX; x++) {
          if (grid[x][z][y].occupied) {
            if (firstX === -1) firstX = x;
            lastX = x;
          }
        }
        if (firstX !== -1 && lastX > firstX + 1) {
          const colL = grid[firstX][z][y].color;
          const colR = grid[lastX][z][y].color;
          for (let x = firstX + 1; x < lastX; x++) {
            if (!grid[x][z][y].occupied) {
              const t = (x - firstX) / (lastX - firstX);
              grid[x][z][y].occupied = true;
              grid[x][z][y].color = [
                Math.round(colL[0] * (1 - t) + colR[0] * t),
                Math.round(colL[1] * (1 - t) + colR[1] * t),
                Math.round(colL[2] * (1 - t) + colR[2] * t)
              ];
              grid[x][z][y].normal = [0, 1, 0];
            }
          }
        }
      }
    }

    // 6. Map Voxel Colors to Official LEGO Palette (CIEDE2000)
    for (let x = 0; x < numStudsX; x++) {
      for (let z = 0; z < numStudsZ; z++) {
        for (let y = 0; y < numPlatesY; y++) {
          const cell = grid[x][z][y];
          if (cell.occupied) {
            const matched = matchOfficialLegoColor(cell.color);
            cell.colorCode = matched.code;
            cell.colorHex = matched.hex;
            cell.colorName = matched.name;
          }
        }
      }
    }

    // 7. Slope & Wedge Classification on Boundary Cells
    if (enableSlopes) {
      for (let x = 0; x < numStudsX; x++) {
        for (let z = 0; z < numStudsZ; z++) {
          for (let y = 0; y < numPlatesY; y++) {
            const cell = grid[x][z][y];
            if (!cell.occupied) continue;

            // Check if top cell is empty (surface)
            const isTopSurface = y === numPlatesY - 1 || !grid[x][z][y + 1].occupied;
            if (!isTopSurface) continue;

            const [nx, ny, nz] = cell.normal;
            // Angle with positive Y
            const len = Math.hypot(nx, ny, nz) || 1;
            const cosAngle = Math.max(-1, Math.min(1, ny / len));
            const angleDeg = (Math.acos(cosAngle) * 180) / Math.PI;

            // Slope candidate if between 25° and 65° incline
            if (angleDeg >= 25 && angleDeg <= 65) {
              cell.isSlopeCandidate = true;
              // Determine heading based on (nx, nz)
              const hAngle = Math.atan2(nz, nx) * (180 / Math.PI);
              // Snap heading to 0, 90, 180, 270
              if (hAngle >= -45 && hAngle < 45) {
                cell.slopeHeading = 90;
              } else if (hAngle >= 45 && hAngle < 135) {
                cell.slopeHeading = 0;
              } else if (hAngle >= 135 || hAngle < -135) {
                cell.slopeHeading = 270;
              } else {
                cell.slopeHeading = 180;
              }
            }
          }
        }
      }
    }

    // 8. Tiling Engine: Merge Cells into Standard Bricks & Plates with Running Bond
    const bricks: DiscretizedBrick[] = [];

    // Canonical Part Catalog
    // Standard Bricks (Height = 3 plates)
    const BRICK_SHAPES: [number, number, string, string][] = [
      [2, 4, '3001', 'Brick 2 x 4'],
      [4, 2, '3001', 'Brick 2 x 4'],
      [2, 3, '3002', 'Brick 2 x 3'],
      [3, 2, '3002', 'Brick 2 x 3'],
      [2, 2, '3003', 'Brick 2 x 2'],
      [1, 4, '3010', 'Brick 1 x 4'],
      [4, 1, '3010', 'Brick 1 x 4'],
      [1, 3, '3622', 'Brick 1 x 3'],
      [3, 1, '3622', 'Brick 1 x 3'],
      [1, 2, '3004', 'Brick 1 x 2'],
      [2, 1, '3004', 'Brick 1 x 2'],
      [1, 1, '3005', 'Brick 1 x 1']
    ];

    // Standard Plates (Height = 1 plate)
    const PLATE_SHAPES: [number, number, string, string][] = [
      [2, 4, '3020', 'Plate 2 x 4'],
      [4, 2, '3020', 'Plate 2 x 4'],
      [2, 2, '3022', 'Plate 2 x 2'],
      [1, 4, '3710', 'Plate 1 x 4'],
      [4, 1, '3710', 'Plate 1 x 4'],
      [1, 3, '3623', 'Plate 1 x 3'],
      [3, 1, '3623', 'Plate 1 x 3'],
      [1, 2, '3023', 'Plate 1 x 2'],
      [2, 1, '3023', 'Plate 1 x 2'],
      [1, 1, '3024', 'Plate 1 x 1']
    ];

    // Helper: Test if an (nx * nz * ny) block of cells can form a solid piece
    const canFitBlock = (
      startX: number,
      startZ: number,
      startY: number,
      wX: number,
      wZ: number,
      hY: number,
      expectedColor: number
    ): boolean => {
      if (startX + wX > numStudsX || startZ + wZ > numStudsZ || startY + hY > numPlatesY) {
        return false;
      }
      for (let dx = 0; dx < wX; dx++) {
        for (let dz = 0; dz < wZ; dz++) {
          for (let dy = 0; dy < hY; dy++) {
            const c = grid[startX + dx][startZ + dz][startY + dy];
            if (!c.occupied || c.assigned || c.colorCode !== expectedColor) {
              return false;
            }
          }
        }
      }
      return true;
    };

    // Helper: Mark block as assigned
    const assignBlock = (
      startX: number,
      startZ: number,
      startY: number,
      wX: number,
      wZ: number,
      hY: number
    ) => {
      for (let dx = 0; dx < wX; dx++) {
        for (let dz = 0; dz < wZ; dz++) {
          for (let dy = 0; dy < hY; dy++) {
            grid[startX + dx][startZ + dz][startY + dy].assigned = true;
          }
        }
      }
    };

    // Helper: Convert grid coordinates to LDraw centered world space
    const toLDrawCoordinates = (
      startX: number,
      startZ: number,
      startY: number,
      wX: number,
      wZ: number,
      hY: number,
      rot: number
    ): [number, number, number] => {
      // In LDraw: X and Z are centered around (0,0). 1 stud = 20 LDU.
      const posX = ((startX + wX / 2) - numStudsX / 2) * LDU_STUD_PITCH;
      const posZ = ((startZ + wZ / 2) - numStudsZ / 2) * LDU_STUD_PITCH;
      // In LDraw, Y points DOWN. Top of layer is -(startY + hY) * 8.
      const posY = -(startY + hY) * LDU_PLATE_HEIGHT;
      return [posX, posY, posZ];
    };

    // --- Pass 8.1: Slopes on boundary cells ---
    if (enableSlopes) {
      for (let y = 0; y < numPlatesY; y++) {
        for (let z = 0; z < numStudsZ; z++) {
          for (let x = 0; x < numStudsX; x++) {
            const cell = grid[x][z][y];
            if (cell.occupied && !cell.assigned && cell.isSlopeCandidate) {
              const rot = cell.slopeHeading || 0;
              // Check if 2x1 slope fits
              let fits2x1 = false;
              if (rot === 0 || rot === 180) {
                fits2x1 = canFitBlock(x, z, y, 1, 2, 3, cell.colorCode);
                if (fits2x1) {
                  assignBlock(x, z, y, 1, 2, 3);
                  const ldrawPos = toLDrawCoordinates(x, z, y, 1, 2, 3, rot);
                  bricks.push({
                    id: `slope_${bricks.length}`,
                    partId: '3040',
                    name: 'Slope Brick 45 2 x 1',
                    colorCode: cell.colorCode,
                    colorHex: cell.colorHex,
                    colorName: cell.colorName,
                    gridPos: [x, y, z],
                    ldrawPos,
                    rotation: rot,
                    matrix: ROT_MATRICES[rot] || ROT_MATRICES[0],
                    size: [1, 2, 3],
                    isSlope: true
                  });
                  continue;
                }
              }
              // Fallback to 1x1 Cheese Slope 31° (54200, height 2 plates)
              const fitsCheese = canFitBlock(x, z, y, 1, 1, 2, cell.colorCode);
              if (fitsCheese) {
                assignBlock(x, z, y, 1, 1, 2);
                const ldrawPos = toLDrawCoordinates(x, z, y, 1, 1, 2, rot);
                bricks.push({
                  id: `cheese_${bricks.length}`,
                  partId: '54200',
                  name: 'Slope 31 1 x 1 x 0.667',
                  colorCode: cell.colorCode,
                  colorHex: cell.colorHex,
                  colorName: cell.colorName,
                  gridPos: [x, y, z],
                  ldrawPos,
                  rotation: rot,
                  matrix: ROT_MATRICES[rot] || ROT_MATRICES[0],
                  size: [1, 1, 2],
                  isSlope: true
                });
              }
            }
          }
        }
      }
    }

    // --- Pass 8.2: Standard 1.0H Bricks (Height = 3 plates) with Staggered Running Bond ---
    for (let y = 0; y <= numPlatesY - 3; y += 3) {
      const brickLayerIndex = y / 3;
      // Staggering: Even layers merge along X first; odd layers merge along Z first
      const preferZ = enableInterlocking && brickLayerIndex % 2 === 1;

      const orderedShapes = preferZ
        ? [...BRICK_SHAPES].sort((a, b) => b[1] * b[0] - a[1] * a[0] || b[1] - a[1])
        : [...BRICK_SHAPES].sort((a, b) => b[0] * b[1] - a[0] * a[1] || b[0] - a[0]);

      for (let z = 0; z < numStudsZ; z++) {
        for (let x = 0; x < numStudsX; x++) {
          const cell = grid[x][z][y];
          if (!cell.occupied || cell.assigned) continue;

          const colorCode = cell.colorCode;

          for (const [wX, wZ, partId, name] of orderedShapes) {
            if (canFitBlock(x, z, y, wX, wZ, 3, colorCode)) {
              assignBlock(x, z, y, wX, wZ, 3);
              const rot = wX >= wZ ? 0 : 90;
              const ldrawPos = toLDrawCoordinates(x, z, y, wX, wZ, 3, rot);

              bricks.push({
                id: `brick_${bricks.length}`,
                partId,
                name,
                colorCode,
                colorHex: cell.colorHex,
                colorName: cell.colorName,
                gridPos: [x, y, z],
                ldrawPos,
                rotation: rot,
                matrix: ROT_MATRICES[rot] || ROT_MATRICES[0],
                size: [wX, wZ, 3],
                isSlope: false
              });
              break;
            }
          }
        }
      }
    }

    // --- Pass 8.3: Thin Plates (Height = 1 plate) for remaining details ---
    for (let y = 0; y < numPlatesY; y++) {
      for (let z = 0; z < numStudsZ; z++) {
        for (let x = 0; x < numStudsX; x++) {
          const cell = grid[x][z][y];
          if (!cell.occupied || cell.assigned) continue;

          const colorCode = cell.colorCode;

          for (const [wX, wZ, partId, name] of PLATE_SHAPES) {
            if (canFitBlock(x, z, y, wX, wZ, 1, colorCode)) {
              assignBlock(x, z, y, wX, wZ, 1);
              const rot = wX >= wZ ? 0 : 90;
              const ldrawPos = toLDrawCoordinates(x, z, y, wX, wZ, 1, rot);

              bricks.push({
                id: `plate_${bricks.length}`,
                partId,
                name,
                colorCode,
                colorHex: cell.colorHex,
                colorName: cell.colorName,
                gridPos: [x, y, z],
                ldrawPos,
                rotation: rot,
                matrix: ROT_MATRICES[rot] || ROT_MATRICES[0],
                size: [wX, wZ, 1],
                isSlope: false
              });
              break;
            }
          }
        }
      }
    }

    // 9. Floating Piece Removal & Connectivity Verification
    let finalBricks = bricks;
    let removedCount = 0;

    if (removeFloating && bricks.length > 0) {
      // Build adjacency graph: two bricks are connected if their footprints overlap vertically
      const n = bricks.length;
      const adj: number[][] = Array.from({ length: n }, () => []);

      for (let i = 0; i < n; i++) {
        const bA = bricks[i];
        const [ax, ay, az] = bA.gridPos;
        const [aw, ad, ah] = bA.size;
        const topA = ay + ah;

        for (let j = i + 1; j < n; j++) {
          const bB = bricks[j];
          const [bx, by, bz] = bB.gridPos;
          const [bw, bd, bh] = bB.size;
          const topB = by + bh;

          // Check vertical contact: either A sits on B or B sits on A
          const isTouchingY = topA === by || topB === ay;
          if (isTouchingY) {
            // Check horizontal overlap
            const overlapX = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
            const overlapZ = Math.max(0, Math.min(az + ad, bz + bd) - Math.max(az, bz));
            if (overlapX > 0 && overlapZ > 0) {
              adj[i].push(j);
              adj[j].push(i);
            }
          }
        }
      }

      // BFS from ground layer (any brick with bottom layer <= 1 plate above ground)
      const visited = new Set<number>();
      const queue: number[] = [];

      for (let i = 0; i < n; i++) {
        if (bricks[i].gridPos[1] <= 1) {
          visited.add(i);
          queue.push(i);
        }
      }

      while (queue.length > 0) {
        const curr = queue.shift()!;
        for (const neighbor of adj[curr]) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      finalBricks = bricks.filter((_, idx) => visited.has(idx));
      removedCount = n - finalBricks.length;
    }

    // 10. Center of Mass & Physical Stability
    let sumX = 0, sumY = 0, sumZ = 0, totalMass = 0;
    let minBaseX = Infinity, maxBaseX = -Infinity;
    let minBaseZ = Infinity, maxBaseZ = -Infinity;

    for (const b of finalBricks) {
      const [gx, gy, gz] = b.gridPos;
      const [w, d, h] = b.size;
      const mass = w * d * h; // Mass proportional to volume in plate-stud units
      const cx = gx + w / 2;
      const cy = gy + h / 2;
      const cz = gz + d / 2;

      sumX += cx * mass;
      sumY += cy * mass;
      sumZ += cz * mass;
      totalMass += mass;

      if (gy <= 1) {
        minBaseX = Math.min(minBaseX, gx);
        maxBaseX = Math.max(maxBaseX, gx + w);
        minBaseZ = Math.min(minBaseZ, gz);
        maxBaseZ = Math.max(maxBaseZ, gz + d);
      }
    }

    const comX = totalMass > 0 ? sumX / totalMass : numStudsX / 2;
    const comY = totalMass > 0 ? sumY / totalMass : 0;
    const comZ = totalMass > 0 ? sumZ / totalMass : numStudsZ / 2;

    const isStable = comX >= minBaseX && comX <= maxBaseX && comZ >= minBaseZ && comZ <= maxBaseZ;

    // 11. Compile Official LDraw Document
    const ldrLines: string[] = [
      '0 Discretized LEGO Assembly',
      '0 Name: model.ldr',
      '0 Author: Brickator3000 Discretizer',
      `0 Resolution: ${targetStudDim} studs (${numStudsX}x${numStudsZ}x${numPlatesY})`,
      '0 BFC CERTIFY CCW',
      ''
    ];

    for (const b of finalBricks) {
      const [px, py, pz] = b.ldrawPos;
      const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = b.matrix;
      // 1 <colour> x y z a b c d e f g h i <part>.dat
      ldrLines.push(
        `1 ${b.colorCode} ${px.toFixed(1)} ${py.toFixed(1)} ${pz.toFixed(1)} ${m0} ${m1} ${m2} ${m3} ${m4} ${m5} ${m6} ${m7} ${m8} ${b.partId}.dat`
      );
    }
    ldrLines.push('0');
    const ldrContent = ldrLines.join('\n');

    // 12. Statistics Breakdown
    const colorMap = new Map<number, { name: string; hex: string; count: number }>();
    const partMap = new Map<string, { name: string; count: number }>();
    let brickCount = 0;
    let plateCount = 0;
    let slopeCount = 0;

    for (const b of finalBricks) {
      // Color breakdown
      const c = colorMap.get(b.colorCode) || { name: b.colorName, hex: b.colorHex, count: 0 };
      c.count++;
      colorMap.set(b.colorCode, c);

      // Part breakdown
      const p = partMap.get(b.partId) || { name: b.name, count: 0 };
      p.count++;
      partMap.set(b.partId, p);

      if (b.isSlope) slopeCount++;
      else if (b.size[2] === 3) brickCount++;
      else plateCount++;
    }

    const colorBreakdown = Array.from(colorMap.entries()).map(([code, val]) => ({
      code,
      name: val.name,
      hex: val.hex,
      count: val.count
    })).sort((a, b) => b.count - a.count);

    const partBreakdown = Array.from(partMap.entries()).map(([partId, val]) => ({
      partId,
      name: val.name,
      count: val.count
    })).sort((a, b) => b.count - a.count);

    const stats: DiscretizationStats = {
      totalPieces: finalBricks.length,
      brickCount,
      plateCount,
      slopeCount,
      distinctParts: partMap.size,
      colorBreakdown,
      partBreakdown,
      centerOfMass: [comX, comY, comZ],
      isStable,
      floatingPiecesRemoved: removedCount,
      gridSize: [numStudsX, numStudsZ, numPlatesY],
      processingTimeMs: Math.round(performance.now() - startTime)
    };

    return {
      ldrContent,
      bricks: finalBricks,
      stats
    };
  }
}
