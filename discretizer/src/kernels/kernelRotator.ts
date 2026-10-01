import type { BaseKernelDefinition, RotatedKernelVariant } from './types';
import type { ConnectorSite } from '../core/types';

/**
 * Generates canonical 4-way yaw rotation variants (0, 90, 180, 270 degrees)
 * for each kernel definition, pruning redundant symmetrical rotations.
 */
export function generateKernelVariants(
  catalog: BaseKernelDefinition[],
  verticalUnit: 'stud' | 'brick' = 'stud'
): RotatedKernelVariant[] {
  const variants: RotatedKernelVariant[] = [];

  for (const def of catalog) {
    if (verticalUnit === 'brick') {
      // In brick unit mode, exclude sub-brick standard plates (h < 3)
      // but retain flat tiles, slopes, cheese slopes, and wedges
      if (def.category === 'PLATE_STANDARD' && def.baseSize[2] < 3) continue;
    }

    const [w, d] = def.baseSize;

    // Check rotational symmetry
    const isSquare = w === d;
    const isOmniDirectional = def.targetNormal[0] === 0 && def.targetNormal[2] === 0;

    let angles = [0, 90, 180, 270];

    // Prune isotropic parts (like 1x1 cylinder or 2x2 round brick/dish)
    if (isSquare && isOmniDirectional) {
      angles = [0];
    } else if (isOmniDirectional) {
      angles = [0, 90]; // 2-fold symmetry for standard rectangular bricks
    }

    for (const rot of angles) {
      variants.push(createVariant(def, rot, verticalUnit));
    }
  }

  return variants;
}

function createVariant(
  def: BaseKernelDefinition,
  rotation: number,
  verticalUnit: 'stud' | 'brick' = 'stud'
): RotatedKernelVariant {
  const [origW, origD, origH] = def.baseSize;
  const h = verticalUnit === 'brick' ? Math.max(1, Math.round(origH / 3)) : origH;
  const w = origW;
  const d = origD;

  const isRotated90or270 = rotation === 90 || rotation === 270;
  const size: [number, number, number] = isRotated90or270 ? [d, w, h] : [w, d, h];

  // Rotate target normal
  const [nx, ny, nz] = def.targetNormal;
  let rnx = nx;
  let rnz = nz;

  if (rotation === 90) {
    rnx = -nz;
    rnz = nx;
  } else if (rotation === 180) {
    rnx = -nx;
    rnz = -nz;
  } else if (rotation === 270) {
    rnx = nz;
    rnz = -nx;
  }

  // Rotate connectors
  const rotatedConnectors: ConnectorSite[] = def.connectors.map((c) => {
    const [lx, lz, origLy] = c.localPos;
    const ly = verticalUnit === 'brick'
      ? (origLy === 0 ? 0 : Math.max(1, Math.round((origLy / origH) * h)))
      : origLy;
    const [cdx, cdz, cdy] = c.direction;

    let rlx = lx;
    let rlz = lz;
    let rcdx = cdx;
    let rcdz = cdz;

    if (rotation === 90) {
      rlx = d - 1 - lz;
      rlz = lx;
      rcdx = -cdz;
      rcdz = cdx;
    } else if (rotation === 180) {
      rlx = w - 1 - lx;
      rlz = d - 1 - lz;
      rcdx = -cdx;
      rcdz = -cdz;
    } else if (rotation === 270) {
      rlx = lz;
      rlz = w - 1 - lx;
      rcdx = cdz;
      rcdz = -cdx;
    }

    return {
      localPos: [rlx, rlz, ly],
      direction: [rcdx, rcdz, cdy],
      polarity: c.polarity,
      jointType: c.jointType
    };
  });

  // Rotate 3D occupancy mask
  const rotatedMask: boolean[][][] = [];
  for (let y = 0; y < h; y++) {
    const sourceY = verticalUnit === 'brick' ? Math.min(origH - 1, y * 3) : y;
    const layer: boolean[][] = [];
    for (let rz = 0; rz < size[1]; rz++) {
      const row: boolean[] = new Array(size[0]).fill(false);
      for (let rx = 0; rx < size[0]; rx++) {
        // Map (rx, rz) back to unrotated (ox, oz)
        let ox = rx;
        let oz = rz;
        if (rotation === 90) {
          ox = rz;
          oz = d - 1 - rx;
        } else if (rotation === 180) {
          ox = w - 1 - rx;
          oz = d - 1 - rz;
        } else if (rotation === 270) {
          ox = w - 1 - rz;
          oz = rx;
        }

        if (def.occupancyMask[sourceY] && def.occupancyMask[sourceY][oz] && def.occupancyMask[sourceY][oz][ox]) {
          row[rx] = true;
        }
      }
      layer.push(row);
    }
    rotatedMask.push(layer);
  }

  // Authentic LDraw 3x3 orientation matrix
  let ldrawMatrix: number[];
  if (rotation === 90) {
    ldrawMatrix = [0, 0, -1, 0, 1, 0, 1, 0, 0];
  } else if (rotation === 180) {
    ldrawMatrix = [-1, 0, 0, 0, 1, 0, 0, 0, -1];
  } else if (rotation === 270) {
    ldrawMatrix = [0, 0, 1, 0, 1, 0, -1, 0, 0];
  } else {
    ldrawMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }

  return {
    def,
    partId: def.partId,
    name: def.name,
    system: def.system,
    category: def.category,
    rotation,
    size,
    targetNormal: [rnx, ny, rnz],
    connectors: rotatedConnectors,
    occupancyMask: rotatedMask,
    ldrawMatrix
  };
}
