/**
 * Multi-Resolution Lattice, 3D Distance Transform, Slope & Curvature Inference.
 *
 * Provides the spatial graph foundation for the Markov Growing Core:
 * 1. Computes exact topological Core Depth field D(x, z, y) via BFS / Grassfire transform.
 * 2. Identifies the object's Deep Core Centroid and principal structural axis.
 * 3. Infers surface Slope Angle & Heading via 3D Lattice height gradients.
 * 4. Infers surface Curvature Class via discrete Hessian eigenvalues.
 */

import { VoxelGrid, VoxelCell, VoxelCoord, CurvatureClass, SlopeClass } from './types';

export class MultiResolutionLattice {
  /**
   * Computes the 3D Topological Distance Transform (Grassfire/BFS) across all occupied cells.
   * Assigns depth >= 1 to all solid cells:
   * - Depth 1: Exterior skin / boundary
   * - Depth 2: Mantle
   * - Depth >= 3: Structural Core
   */
  public static computeCoreDistanceField(grid: VoxelGrid): void {
    const { numStudsX, numStudsZ, numPlatesY } = grid;
    const queue: Array<[number, number, number]> = [];

    // 1. Identify all boundary cells (depth = 1)
    let maxDepth = 0;
    let coreSumX = 0;
    let coreSumZ = 0;
    let coreSumY = 0;
    let coreCount = 0;

    for (let x = 0; x < numStudsX; x++) {
      for (let z = 0; z < numStudsZ; z++) {
        for (let y = 0; y < numPlatesY; y++) {
          const cell = grid.grid[x][z][y];
          if (!cell.occupied) {
            cell.depth = 0;
            continue;
          }

          // Check 6-neighbors for empty air or boundary edge
          const isBoundary =
            x === 0 || x === numStudsX - 1 || !grid.grid[x - 1][z][y].occupied || !grid.grid[x + 1][z][y].occupied ||
            z === 0 || z === numStudsZ - 1 || !grid.grid[x][z - 1][y].occupied || !grid.grid[x][z + 1][y].occupied ||
            y === 0 || y === numPlatesY - 1 || !grid.grid[x][z][y - 1].occupied || !grid.grid[x][z][y + 1].occupied;

          cell.isBoundary = isBoundary;
          if (isBoundary) {
            cell.depth = 1;
            queue.push([x, z, y]);
          } else {
            cell.depth = -1; // Unvisited interior
          }
        }
      }
    }

    if (queue.length > 0) {
      maxDepth = 1;
    }

    // 2. Multi-source BFS inward to compute topological depth
    const neighborOffsets = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1]
    ];

    let head = 0;
    while (head < queue.length) {
      const [cx, cz, cy] = queue[head++];
      const currentCell = grid.grid[cx][cz][cy];
      const nextDepth = currentCell.depth + 1;

      for (const [dx, dz, dy] of neighborOffsets) {
        const nx = cx + dx;
        const nz = cz + dz;
        const ny = cy + dy;

        if (nx >= 0 && nx < numStudsX && nz >= 0 && nz < numStudsZ && ny >= 0 && ny < numPlatesY) {
          const neighbor = grid.grid[nx][nz][ny];
          if (neighbor.occupied && neighbor.depth === -1) {
            neighbor.depth = nextDepth;
            queue.push([nx, nz, ny]);

            if (nextDepth > maxDepth) {
              maxDepth = nextDepth;
            }
          }
        }
      }
    }

    grid.maxCoreDepth = maxDepth;

    // 3. Find Core Centroid (center of mass of cells with max depth or depth >= maxDepth - 1)
    const coreThreshold = Math.max(2, maxDepth - 1);
    for (let x = 0; x < numStudsX; x++) {
      for (let z = 0; z < numStudsZ; z++) {
        for (let y = 0; y < numPlatesY; y++) {
          const cell = grid.grid[x][z][y];
          if (cell.occupied) {
            cell.isCore = cell.depth >= coreThreshold;
            if (cell.isCore) {
              coreSumX += x;
              coreSumZ += z;
              coreSumY += y;
              coreCount++;
            }
          }
        }
      }
    }

    if (coreCount > 0) {
      grid.coreCentroid = [
        Math.round(coreSumX / coreCount),
        Math.round(coreSumZ / coreCount),
        Math.round(coreSumY / coreCount)
      ];
    } else {
      grid.coreCentroid = [Math.floor(numStudsX / 2), Math.floor(numStudsZ / 2), Math.floor(numPlatesY / 2)];
    }
  }

  /**
   * Infers surface slope angle and cardinal heading via authentic surface normal and 3D Lattice height gradients.
   */
  public static inferLatticeSlope(grid: VoxelGrid, x: number, z: number, y: number): {
    slopeClass: SlopeClass;
    heading: number;
    angle: number;
  } {
    const { numStudsX, numStudsZ, numPlatesY } = grid;
    const cell = grid.grid[x]?.[z]?.[y];

    // 1. Primary: Use authentic surface normal from mesh raycast
    if (cell && cell.normal && (cell.normal[0] !== 0 || cell.normal[1] !== 0 || cell.normal[2] !== 0)) {
      const [nx, ny, nz] = cell.normal;

      let heading = 0;
      if (Math.abs(nz) >= Math.abs(nx)) {
        heading = nz >= 0 ? 0 : 180;
      } else {
        heading = nx >= 0 ? 270 : 90;
      }

      if (ny < -0.3) {
        return { slopeClass: 'slope_inverted', heading, angle: -30 };
      }
      if (ny > 0.8) {
        return { slopeClass: 'flat', heading, angle: 0 };
      }
      if (ny >= 0.15 && ny <= 0.8) {
        if (ny > 0.45) {
          return { slopeClass: 'slope_curved', heading, angle: 45 };
        } else {
          return { slopeClass: 'slope_33', heading, angle: 33 };
        }
      }
    }

    const isSolid = (cx: number, cz: number, cy: number): boolean => {
      if (cx < 0 || cx >= numStudsX || cz < 0 || cz >= numStudsZ || cy < 0 || cy >= numPlatesY) return false;
      return grid.grid[cx][cz][cy].occupied;
    };

    // Evaluate vertical plate differences in 4 cardinal horizontal directions
    const checkDir = (dx: number, dz: number): number => {
      let stepDiff = 0;
      for (let stepY = -3; stepY <= 3; stepY++) {
        if (isSolid(x + dx, z + dz, y + stepY) !== isSolid(x, z, y + stepY)) {
          stepDiff += stepY;
        }
      }
      return stepDiff;
    };

    const diffZPos = checkDir(0, 1);
    const diffZNeg = checkDir(0, -1);
    const diffXPos = checkDir(1, 0);
    const diffXNeg = checkDir(-1, 0);

    // Identify dominant descent direction
    let heading = 0;
    let maxDiff = 0;

    if (diffZPos > maxDiff) { maxDiff = diffZPos; heading = 0; }
    if (diffZNeg > maxDiff) { maxDiff = diffZNeg; heading = 180; }
    if (diffXNeg > maxDiff) { maxDiff = diffXNeg; heading = 90; }
    if (diffXPos > maxDiff) { maxDiff = diffXPos; heading = 270; }

    // Check if inverted slope (air below, solid above and to the sides)
    const isUnderhang = !isSolid(x, z, y - 1) && (isSolid(x + 1, z, y) || isSolid(x - 1, z, y) || isSolid(x, z + 1, y) || isSolid(x, z - 1, y));
    if (isUnderhang && y > 1) {
      return { slopeClass: 'slope_inverted', heading, angle: -33 };
    }

    if (maxDiff >= 3) {
      return { slopeClass: 'slope_curved', heading, angle: 45 };
    } else if (maxDiff >= 1) {
      return { slopeClass: 'slope_33', heading, angle: 33 };
    }

    return { slopeClass: 'flat', heading: 0, angle: 0 };
  }

  /**
   * Infers surface curvature class via discrete 2D/3D Hessian matrix eigenvalues.
   */
  public static inferSubgridCurvature(grid: VoxelGrid, x: number, z: number, y: number): {
    curvatureClass: CurvatureClass;
    k1: number;
    k2: number;
  } {
    const { numStudsX, numStudsZ, numPlatesY } = grid;

    const isSolid = (cx: number, cz: number, cy: number): number => {
      if (cx < 0 || cx >= numStudsX || cz < 0 || cz >= numStudsZ || cy < 0 || cy >= numPlatesY) return 0;
      return grid.grid[cx][cz][cy].occupied ? 1 : 0;
    };

    // Central difference approximations of 2nd derivatives
    const fC = isSolid(x, z, y);
    const fE = isSolid(x + 1, z, y);
    const fW = isSolid(x - 1, z, y);
    const fN = isSolid(x, z + 1, y);
    const fS = isSolid(x, z - 1, y);
    const fNE = isSolid(x + 1, z + 1, y);
    const fNW = isSolid(x - 1, z + 1, y);
    const fSE = isSolid(x + 1, z - 1, y);
    const fSW = isSolid(x - 1, z - 1, y);

    const d2fdx2 = fE - 2 * fC + fW;
    const d2fdz2 = fN - 2 * fC + fS;
    const d2fdxdz = (fNE - fNW - fSE + fSW) / 4.0;

    // Eigenvalues of 2x2 symmetric Hessian matrix
    const tr = d2fdx2 + d2fdz2;
    const det = d2fdx2 * d2fdz2 - d2fdxdz * d2fdxdz;
    const discriminant = Math.max(0, (tr * tr) / 4.0 - det);
    const sqrtDisc = Math.sqrt(discriminant);

    const k1 = tr / 2.0 + sqrtDisc;
    const k2 = tr / 2.0 - sqrtDisc;

    // Check apex dome: convex in both directions at top layer
    const isTopApex = y === numPlatesY - 1 || !isSolid(x, z, y + 1);
    if (isTopApex && k1 < -0.3 && k2 < -0.3) {
      return { curvatureClass: 'spherical_dome', k1, k2 };
    }

    // Check sharp cusp / extremity
    const solidNeighbors = fE + fW + fN + fS + isSolid(x, z, y + 1) + isSolid(x, z, y - 1);
    if (solidNeighbors <= 2) {
      return { curvatureClass: 'sharp_cusp', k1, k2 };
    }

    // Check corner / macaroni
    const isCorner = (fE !== fW) && (fN !== fS);
    if (isCorner && Math.abs(d2fdxdz) > 0.2) {
      return { curvatureClass: 'corner_macaroni', k1, k2 };
    }

    // Uniaxial cylindrical curvature
    if (Math.abs(k1) > 0.3 && Math.abs(k2) < 0.2) {
      return {
        curvatureClass: k1 > 0 ? 'cylindrical_concave' : 'cylindrical_convex',
        k1,
        k2
      };
    }

    return { curvatureClass: 'flat', k1, k2 };
  }

  /**
   * Annotates all occupied cells in the grid with depth, slope, and curvature.
   */
  public static analyzeLatticeFeatures(grid: VoxelGrid): void {
    this.computeCoreDistanceField(grid);

    const { numStudsX, numStudsZ, numPlatesY } = grid;
    for (let x = 0; x < numStudsX; x++) {
      for (let z = 0; z < numStudsZ; z++) {
        for (let y = 0; y < numPlatesY; y++) {
          const cell = grid.grid[x][z][y];
          if (!cell.occupied) continue;

          if (cell.isBoundary) {
            const slope = this.inferLatticeSlope(grid, x, z, y);
            const curv = this.inferSubgridCurvature(grid, x, z, y);

            cell.slopeClass = slope.slopeClass;
            cell.slopeHeading = slope.heading;
            cell.curvatureClass = curv.curvatureClass;
          } else {
            cell.slopeClass = 'flat';
            cell.slopeHeading = 0;
            cell.curvatureClass = 'flat';
          }
        }
      }
    }
  }
}
