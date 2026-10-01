import { PlateLattice3D } from '../core/PlateLattice3D';
import { LegoBitset3D } from '../core/LegoBitset3D';
import { AssemblyGraph3D } from '../core/AssemblyGraph3D';
import type { PlacedBrick, EvaluationStep } from '../core/types';
import { createSolidMask, createStandardConnectors } from '../kernels/kernelHelpers';
import { sampleCentroidColor } from './pipelineDispatcher';

export interface SmartMergeResult {
  mergedCount: number;
  steps: EvaluationStep[];
}

const PLATE_TO_BRICK_MAP: Record<string, { partId: string; name: string; baseW: number; baseD: number }> = {
  '1,1': { partId: '3005', name: 'Brick 1 x 1', baseW: 1, baseD: 1 },
  '1,2': { partId: '3004', name: 'Brick 1 x 2', baseW: 1, baseD: 2 },
  '2,1': { partId: '3004', name: 'Brick 1 x 2', baseW: 1, baseD: 2 },
  '1,3': { partId: '3622', name: 'Brick 1 x 3', baseW: 1, baseD: 3 },
  '3,1': { partId: '3622', name: 'Brick 1 x 3', baseW: 1, baseD: 3 },
  '1,4': { partId: '3010', name: 'Brick 1 x 4', baseW: 1, baseD: 4 },
  '4,1': { partId: '3010', name: 'Brick 1 x 4', baseW: 1, baseD: 4 },
  '1,6': { partId: '3009', name: 'Brick 1 x 6', baseW: 1, baseD: 6 },
  '6,1': { partId: '3009', name: 'Brick 1 x 6', baseW: 1, baseD: 6 },
  '1,8': { partId: '3008', name: 'Brick 1 x 8', baseW: 1, baseD: 8 },
  '8,1': { partId: '3008', name: 'Brick 1 x 8', baseW: 1, baseD: 8 },
  '2,2': { partId: '3003', name: 'Brick 2 x 2', baseW: 2, baseD: 2 },
  '2,3': { partId: '3002', name: 'Brick 2 x 3', baseW: 2, baseD: 3 },
  '3,2': { partId: '3002', name: 'Brick 2 x 3', baseW: 2, baseD: 3 },
  '2,4': { partId: '3001', name: 'Brick 2 x 4', baseW: 2, baseD: 4 },
  '4,2': { partId: '3001', name: 'Brick 2 x 4', baseW: 2, baseD: 4 },
  '2,6': { partId: '2456', name: 'Brick 2 x 6', baseW: 2, baseD: 6 },
  '6,2': { partId: '2456', name: 'Brick 2 x 6', baseW: 2, baseD: 6 },
  '2,8': { partId: '3007', name: 'Brick 2 x 8', baseW: 2, baseD: 8 },
  '8,2': { partId: '3007', name: 'Brick 2 x 8', baseW: 2, baseD: 8 }
};

/**
 * Smart Brick & Plate Merger:
 * 1. Greedily searches for adjacent small bricks/plates/tiles on the same layer,
 *    coalescing them into larger, smarter interlocking pieces.
 * 2. Vertical Stack Coalescing: identifies 3 stacked plates of matching footprint
 *    and merges them into a full-height brick (h=3), eliminating thin stacked plate glitches.
 * 3. Tall Column Coalescing: merges 5 stacked 1x1x3 bricks into a 1x1x5 tall brick (2453b).
 */
export function runSmartBrickMergePass(
  lattice: PlateLattice3D,
  bitset: LegoBitset3D,
  assemblyGraph: AssemblyGraph3D,
  stepStartIndex: number = 0
): SmartMergeResult {
  let mergedCount = 0;
  const steps: EvaluationStep[] = [];
  let currentStepIdx = stepStartIndex;

  const isBrickMode = lattice.verticalUnit === 'brick';

  // -------------------------------------------------------------------------
  // Part 1: Horizontal Merges (Up to 3 iterative passes)
  // -------------------------------------------------------------------------
  for (let pass = 0; pass < 3; pass++) {
    let passMerged = 0;
    const allBricks = assemblyGraph.getAllBricks();
    const layerMap = new Map<number, PlacedBrick[]>();

    for (const b of allBricks) {
      if (b.category !== 'BRICK_STANDARD' && b.category !== 'PLATE_STANDARD' && b.category !== 'TILE_FLAT') continue;
      const y = b.gridPos[2];
      if (!layerMap.has(y)) layerMap.set(y, []);
      layerMap.get(y)!.push(b);
    }

    for (const [y, layerBricks] of layerMap) {
      const studToBrick = new Map<string, PlacedBrick>();
      const processed = new Set<string>();

      for (const b of layerBricks) {
        for (let dz = 0; dz < b.size[1]; dz++) {
          for (let dx = 0; dx < b.size[0]; dx++) {
            studToBrick.set(`${b.gridPos[0] + dx},${b.gridPos[1] + dz}`, b);
          }
        }
      }

      const commitMerge = (
        sourceBricks: PlacedBrick[],
        partId: string,
        name: string,
        category: 'BRICK_STANDARD' | 'PLATE_STANDARD' | 'TILE_FLAT',
        newW: number,
        newD: number,
        elementH: number,
        baseW: number,
        baseD: number,
        rotation: number,
        ldrawMatrix: number[],
        ox: number,
        oz: number
      ) => {
        for (const sb of sourceBricks) {
          assemblyGraph.removeBrick(sb.instanceId);
          processed.add(sb.instanceId);
        }

        const sample = sampleCentroidColor(ox, oz, y, newW, newD, elementH, lattice);
        const colorHex = sample.packed !== 0x94a3b8 ? sample.hex : sourceBricks[0].colorHex;
        const colorPacked = sample.packed !== 0x94a3b8 ? sample.packed : sourceBricks[0].colorPacked;

        // Authentic LDraw coordinates
        let ldrawPos: [number, number, number];
        if (category === 'TILE_FLAT') {
          const unitH = isBrickMode ? 24.0 : 8.0;
          const ldrawX = (ox + newW / 2 - lattice.numStudsX / 2) * 20.0;
          const ldrawZ = (oz + newD / 2 - lattice.numStudsZ / 2) * 20.0;
          const ldrawY = -(y * unitH + 8.0);
          ldrawPos = [ldrawX, ldrawY, ldrawZ];
        } else {
          ldrawPos = lattice.gridToLDraw(ox, oz, y, newW, newD, elementH);
        }

        const newInstanceId = `merged_${partId}_${ox}_${oz}_${y}`;
        bitset.claimRegion(ox, oz, y, newW, newD, elementH, newInstanceId);

        const hasTopStuds = category !== 'TILE_FLAT';
        const newBrick: PlacedBrick = {
          instanceId: newInstanceId,
          partId,
          name,
          gridPos: [ox, oz, y],
          baseSize: [baseW, baseD, elementH],
          size: [newW, newD, elementH],
          rotation,
          colorHex,
          colorPacked,
          ldrawPos,
          ldrawMatrix,
          category,
          connectors: createStandardConnectors(newW, newD, elementH, hasTopStuds, true),
          occupancyMask: createSolidMask(newW, newD, elementH)
        };

        assemblyGraph.addBrick(newBrick);
        mergedCount++;
        passMerged++;

        for (let dz = 0; dz < newD; dz++) {
          for (let dx = 0; dx < newW; dx++) {
            studToBrick.set(`${ox + dx},${oz + dz}`, newBrick);
          }
        }
      };

      // 1. Merge pairs of 1x1 pieces into 1x2 pieces
      for (const b00 of layerBricks) {
        if (processed.has(b00.instanceId) || !assemblyGraph.hasBrick(b00.instanceId)) continue;
        if (b00.size[0] !== 1 || b00.size[1] !== 1) continue;

        const [x, z] = [b00.gridPos[0], b00.gridPos[1]];
        const b10 = studToBrick.get(`${x + 1},${z}`);
        const b01 = studToBrick.get(`${x},${z + 1}`);
        const cat = b00.category;
        const elemH = b00.size[2];

        // Part IDs for 1x2 and 2x2
        let p1x2 = '3004';
        let p2x2 = '3003';
        if (cat === 'PLATE_STANDARD') {
          p1x2 = '3023';
          p2x2 = '3022';
        } else if (cat === 'TILE_FLAT') {
          p1x2 = '3069b';
          p2x2 = '3068b';
        }

        // 4 1x1s into 2x2
        const b11 = studToBrick.get(`${x + 1},${z + 1}`);
        if (
          b10 && b10.size[0] === 1 && b10.size[1] === 1 && b10.category === cat && !processed.has(b10.instanceId) && assemblyGraph.hasBrick(b10.instanceId) &&
          b01 && b01.size[0] === 1 && b01.size[1] === 1 && b01.category === cat && !processed.has(b01.instanceId) && assemblyGraph.hasBrick(b01.instanceId) &&
          b11 && b11.size[0] === 1 && b11.size[1] === 1 && b11.category === cat && !processed.has(b11.instanceId) && assemblyGraph.hasBrick(b11.instanceId)
        ) {
          commitMerge([b00, b10, b01, b11], p2x2, `${cat} 2 x 2`, cat as any, 2, 2, elemH, 2, 2, 0, [1, 0, 0, 0, 1, 0, 0, 0, 1], x, z);
          continue;
        }

        // 2 1x1s along X into 1x2
        if (b10 && b10.size[0] === 1 && b10.size[1] === 1 && b10.category === cat && !processed.has(b10.instanceId) && assemblyGraph.hasBrick(b10.instanceId)) {
          commitMerge([b00, b10], p1x2, `${cat} 1 x 2`, cat as any, 2, 1, elemH, 1, 2, 90, [0, 0, -1, 0, 1, 0, 1, 0, 0], x, z);
          continue;
        }

        // 2 1x1s along Z into 1x2
        if (b01 && b01.size[0] === 1 && b01.size[1] === 1 && b01.category === cat && !processed.has(b01.instanceId) && assemblyGraph.hasBrick(b01.instanceId)) {
          commitMerge([b00, b01], p1x2, `${cat} 1 x 2`, cat as any, 1, 2, elemH, 1, 2, 0, [1, 0, 0, 0, 1, 0, 0, 0, 1], x, z);
          continue;
        }
      }

      // 2. Merge pairs of 1x2 pieces into 2x2 or 1x4 pieces
      for (const b of layerBricks) {
        if (processed.has(b.instanceId) || !assemblyGraph.hasBrick(b.instanceId)) continue;
        const [w, d] = [b.size[0], b.size[1]];
        const [x, z] = [b.gridPos[0], b.gridPos[1]];
        const cat = b.category;
        const elemH = b.size[2];

        let p2x2 = '3003', p1x4 = '3010', p2x4 = '3001';
        if (cat === 'PLATE_STANDARD') {
          p2x2 = '3022';
          p1x4 = '3710';
          p2x4 = '3020';
        } else if (cat === 'TILE_FLAT') {
          p2x2 = '3068b';
          p1x4 = '2431';
          p2x4 = '87079';
        }

        // Side-by-side 1x2s into 2x2
        if (w === 2 && d === 1) {
          const adjZ = studToBrick.get(`${x},${z + 1}`);
          if (
            adjZ && adjZ.size[0] === 2 && adjZ.size[1] === 1 && adjZ.category === cat &&
            adjZ.gridPos[0] === x && adjZ.gridPos[1] === z + 1 &&
            !processed.has(adjZ.instanceId) && assemblyGraph.hasBrick(adjZ.instanceId)
          ) {
            commitMerge([b, adjZ], p2x2, `${cat} 2 x 2`, cat as any, 2, 2, elemH, 2, 2, 0, [1, 0, 0, 0, 1, 0, 0, 0, 1], x, z);
            continue;
          }

          // End-to-end 2x1s into 4x1
          const adjX = studToBrick.get(`${x + 2},${z}`);
          if (
            adjX && adjX.size[0] === 2 && adjX.size[1] === 1 && adjX.category === cat &&
            adjX.gridPos[0] === x + 2 && adjX.gridPos[1] === z &&
            !processed.has(adjX.instanceId) && assemblyGraph.hasBrick(adjX.instanceId)
          ) {
            commitMerge([b, adjX], p1x4, `${cat} 1 x 4`, cat as any, 4, 1, elemH, 1, 4, 90, [0, 0, -1, 0, 1, 0, 1, 0, 0], x, z);
            continue;
          }
        } else if (w === 1 && d === 2) {
          const adjX = studToBrick.get(`${x + 1},${z}`);
          if (
            adjX && adjX.size[0] === 1 && adjX.size[1] === 2 && adjX.category === cat &&
            adjX.gridPos[0] === x + 1 && adjX.gridPos[1] === z &&
            !processed.has(adjX.instanceId) && assemblyGraph.hasBrick(adjX.instanceId)
          ) {
            commitMerge([b, adjX], p2x2, `${cat} 2 x 2`, cat as any, 2, 2, elemH, 2, 2, 0, [1, 0, 0, 0, 1, 0, 0, 0, 1], x, z);
            continue;
          }

          const adjZ = studToBrick.get(`${x},${z + 2}`);
          if (
            adjZ && adjZ.size[0] === 1 && adjZ.size[1] === 2 && adjZ.category === cat &&
            adjZ.gridPos[0] === x && adjZ.gridPos[1] === z + 2 &&
            !processed.has(adjZ.instanceId) && assemblyGraph.hasBrick(adjZ.instanceId)
          ) {
            commitMerge([b, adjZ], p1x4, `${cat} 1 x 4`, cat as any, 1, 4, elemH, 1, 4, 0, [1, 0, 0, 0, 1, 0, 0, 0, 1], x, z);
            continue;
          }
        } else if (w === 2 && d === 2) {
          const adjX = studToBrick.get(`${x + 2},${z}`);
          if (
            adjX && adjX.size[0] === 2 && adjX.size[1] === 2 && adjX.category === cat &&
            adjX.gridPos[0] === x + 2 && adjX.gridPos[1] === z &&
            !processed.has(adjX.instanceId) && assemblyGraph.hasBrick(adjX.instanceId)
          ) {
            commitMerge([b, adjX], p2x4, `${cat} 2 x 4`, cat as any, 4, 2, elemH, 2, 4, 90, [0, 0, -1, 0, 1, 0, 1, 0, 0], x, z);
            continue;
          }

          const adjZ = studToBrick.get(`${x},${z + 2}`);
          if (
            adjZ && adjZ.size[0] === 2 && adjZ.size[1] === 2 && adjZ.category === cat &&
            adjZ.gridPos[0] === x && adjZ.gridPos[1] === z + 2 &&
            !processed.has(adjZ.instanceId) && assemblyGraph.hasBrick(adjZ.instanceId)
          ) {
            commitMerge([b, adjZ], p2x4, `${cat} 2 x 4`, cat as any, 2, 4, elemH, 2, 4, 0, [1, 0, 0, 0, 1, 0, 0, 0, 1], x, z);
            continue;
          }
        }
      }
    }

    if (passMerged === 0) break;
  }

  // -------------------------------------------------------------------------
  // Part 2: Vertical Plate-to-Brick Stack Coalescing (in Stud mode)
  // -------------------------------------------------------------------------
  if (!isBrickMode) {
    const processedVert = new Set<string>();
    const allBricks = assemblyGraph.getAllBricks();
    // Index plates by "x,z,y"
    const plateByCoord = new Map<string, PlacedBrick>();

    for (const b of allBricks) {
      if (b.category === 'PLATE_STANDARD' && b.size[2] === 1) {
        plateByCoord.set(`${b.gridPos[0]},${b.gridPos[1]},${b.gridPos[2]}`, b);
      }
    }

    for (const b0 of allBricks) {
      if (b0.category !== 'PLATE_STANDARD' || b0.size[2] !== 1) continue;
      if (processedVert.has(b0.instanceId) || !assemblyGraph.hasBrick(b0.instanceId)) continue;

      const [x, z, y] = b0.gridPos;
      const [w, d] = [b0.size[0], b0.size[1]];

      const b1 = plateByCoord.get(`${x},${z},${y + 1}`);
      const b2 = plateByCoord.get(`${x},${z},${y + 2}`);

      if (
        b1 && b1.size[0] === w && b1.size[1] === d && b1.size[2] === 1 &&
        !processedVert.has(b1.instanceId) && assemblyGraph.hasBrick(b1.instanceId) &&
        b2 && b2.size[0] === w && b2.size[1] === d && b2.size[2] === 1 &&
        !processedVert.has(b2.instanceId) && assemblyGraph.hasBrick(b2.instanceId)
      ) {
        const key = `${w},${d}`;
        const mapping = PLATE_TO_BRICK_MAP[key];
        if (mapping) {
          assemblyGraph.removeBrick(b0.instanceId);
          assemblyGraph.removeBrick(b1.instanceId);
          assemblyGraph.removeBrick(b2.instanceId);
          processedVert.add(b0.instanceId);
          processedVert.add(b1.instanceId);
          processedVert.add(b2.instanceId);

          const sample = sampleCentroidColor(x, z, y, w, d, 3, lattice);
          const colorHex = sample.packed !== 0x94a3b8 ? sample.hex : b0.colorHex;
          const colorPacked = sample.packed !== 0x94a3b8 ? sample.packed : b0.colorPacked;
          const ldrawPos = lattice.gridToLDraw(x, z, y, w, d, 3);
          const newInstanceId = `vmerged_${mapping.partId}_${x}_${z}_${y}`;

          bitset.claimRegion(x, z, y, w, d, 3, newInstanceId);

          const newBrick: PlacedBrick = {
            instanceId: newInstanceId,
            partId: mapping.partId,
            name: mapping.name,
            gridPos: [x, z, y],
            baseSize: [mapping.baseW, mapping.baseD, 3],
            size: [w, d, 3],
            rotation: b0.rotation,
            colorHex,
            colorPacked,
            ldrawPos,
            ldrawMatrix: b0.ldrawMatrix,
            category: 'BRICK_STANDARD',
            connectors: createStandardConnectors(w, d, 3, true, true),
            occupancyMask: createSolidMask(w, d, 3)
          };

          assemblyGraph.addBrick(newBrick);
          mergedCount++;
        }
      }
    }

    // -------------------------------------------------------------------------
    // Part 3: Tall Column Coalescing (5 stacked 1x1x3 bricks into 1x1x5 tall brick 2453b)
    // -------------------------------------------------------------------------
    const processedTall = new Set<string>();
    const currentBricks = assemblyGraph.getAllBricks();
    const brick1x1Map = new Map<string, PlacedBrick>();

    for (const b of currentBricks) {
      if (b.category === 'BRICK_STANDARD' && b.size[0] === 1 && b.size[1] === 1 && b.size[2] === 3) {
        brick1x1Map.set(`${b.gridPos[0]},${b.gridPos[1]},${b.gridPos[2]}`, b);
      }
    }

    for (const b0 of currentBricks) {
      if (b0.category !== 'BRICK_STANDARD' || b0.size[0] !== 1 || b0.size[1] !== 1 || b0.size[2] !== 3) continue;
      if (processedTall.has(b0.instanceId) || !assemblyGraph.hasBrick(b0.instanceId)) continue;

      const [x, z, y] = b0.gridPos;
      const b1 = brick1x1Map.get(`${x},${z},${y + 3}`);
      const b2 = brick1x1Map.get(`${x},${z},${y + 6}`);
      const b3 = brick1x1Map.get(`${x},${z},${y + 9}`);
      const b4 = brick1x1Map.get(`${x},${z},${y + 12}`);

      if (
        b1 && !processedTall.has(b1.instanceId) && assemblyGraph.hasBrick(b1.instanceId) &&
        b2 && !processedTall.has(b2.instanceId) && assemblyGraph.hasBrick(b2.instanceId) &&
        b3 && !processedTall.has(b3.instanceId) && assemblyGraph.hasBrick(b3.instanceId) &&
        b4 && !processedTall.has(b4.instanceId) && assemblyGraph.hasBrick(b4.instanceId)
      ) {
        [b0, b1, b2, b3, b4].forEach(sb => {
          assemblyGraph.removeBrick(sb.instanceId);
          processedTall.add(sb.instanceId);
        });

        const sample = sampleCentroidColor(x, z, y, 1, 1, 15, lattice);
        const colorHex = sample.packed !== 0x94a3b8 ? sample.hex : b0.colorHex;
        const colorPacked = sample.packed !== 0x94a3b8 ? sample.packed : b0.colorPacked;
        const ldrawPos = lattice.gridToLDraw(x, z, y, 1, 1, 15);
        const newInstanceId = `tall_${x}_${z}_${y}`;

        bitset.claimRegion(x, z, y, 1, 1, 15, newInstanceId);

        const newBrick: PlacedBrick = {
          instanceId: newInstanceId,
          partId: '2453b',
          name: 'Brick 1 x 1 x 5 Tall',
          gridPos: [x, z, y],
          baseSize: [1, 1, 15],
          size: [1, 1, 15],
          rotation: 0,
          colorHex,
          colorPacked,
          ldrawPos,
          ldrawMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          category: 'BRICK_STANDARD',
          connectors: createStandardConnectors(1, 1, 15, true, true),
          occupancyMask: createSolidMask(1, 1, 15)
        };

        assemblyGraph.addBrick(newBrick);
        mergedCount++;
      }
    }
  }

  return { mergedCount, steps };
}
