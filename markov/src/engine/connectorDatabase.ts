/**
 * LDraw Connector Database for Markov Chain & Multi-Head Growing Core Discretization.
 *
 * Expands to hundreds of real, authentic LDraw pieces loaded from generatedConnectorCatalog.json:
 * - 200+ distinct connectors across FILL, EDGE, LEAF, EMPTY
 * - O(1) multi-index lookup tables for blazing fast candidate retrieval:
 *   - fillByDimensions: Map<"wx,wz,hy", LDrawConnectorMeta[]>
 *   - edgeBySlope: Map<SlopeClass, LDrawConnectorMeta[]>
 *   - edgeByCurvature: Map<CurvatureClass, LDrawConnectorMeta[]>
 *   - leafByProfile: Map<PieceProfile, LDrawConnectorMeta[]>
 *   - tileByDimensions: Map<"wx,wz", LDrawConnectorMeta[]>
 */

import { PieceCategory, PieceProfile, CurvatureClass, SlopeClass } from './types';
import { PieceFingerprint, PieceDescriptor } from './pieceFingerprint';
import rawCatalog from './generatedConnectorCatalog';

export interface LDrawConnectorMeta {
  partId: string;
  name: string;
  category: PieceCategory;
  profile: PieceProfile;
  footprint: [number, number, number]; // [wX, wZ, hY]
  bondingCapacity: number;
  isModern: boolean;
  slopeClass: SlopeClass;
  slopeAngle: number;
  curvatureClass: CurvatureClass;
  preferredDepth: [number, number];
  fingerprint: PieceFingerprint;
  ldrawOffset: [number, number]; // X, Z center offset in LDU
  ldrawPartCenter: [number, number]; // [cx, cz] local centroid in LDraw part space
  yOffsetPlates: number; // Vertical offset in plates
}

export const LDRAW_PART_CENTROIDS: Record<string, [number, number]> = {
  // 45° Slopes (local center in Z is at -10 LDU)
  '3040': [0, -10],
  '3040b': [0, -10],
  '3040a': [0, -10],
  '3039': [0, -10],
  '3038': [0, -20],
  '3048': [0, -10],
  '60477': [0, -40],
  '3298': [0, -10],

  // Inverted Slopes
  '24201': [0, 10],
  '3665': [0, -10],
  '3665a': [0, -10],
  '3665b': [0, -10],
  '3747': [0, -20],
  '3747a': [0, -20],
  '3747b': [0, -20],
  '4287': [0, -20],
  '4287a': [0, -20],
  '4287b': [0, -20],
  '4287c': [0, -20],
  '3049': [0, 10],
  '3049b': [0, 10],

  // Macaroni & Curved Corners
  '27925': [10, -10],
  '3063': [10, -10],
  '3063a': [10, -10],
  '3063b': [10, -10],
};

export class ConnectorDatabase {
  private static instance: ConnectorDatabase | null = null;
  public connectors: Map<string, LDrawConnectorMeta> = new Map();
  public byCategory: Map<PieceCategory, LDrawConnectorMeta[]> = new Map();
  public byProfile: Map<PieceProfile, LDrawConnectorMeta[]> = new Map();

  // Fast O(1) indexed lookup tables for multi-head candidate selection
  public fillByDimensions: Map<string, LDrawConnectorMeta[]> = new Map();
  public edgeBySlope: Map<SlopeClass, LDrawConnectorMeta[]> = new Map();
  public edgeByCurvature: Map<CurvatureClass, LDrawConnectorMeta[]> = new Map();
  public leafByProfile: Map<PieceProfile, LDrawConnectorMeta[]> = new Map();
  public tileByDimensions: Map<string, LDrawConnectorMeta[]> = new Map();

  constructor() {
    this.registerCatalog();
  }

  public static getInstance(): ConnectorDatabase {
    if (!ConnectorDatabase.instance) {
      ConnectorDatabase.instance = new ConnectorDatabase();
    }
    return ConnectorDatabase.instance;
  }

  private registerCatalog(): void {
    for (const item of rawCatalog) {
      let baseHeightY = item.heightY;
      // In authentic LDraw, 2x1, 2x2, and 2x4 curved slopes (11477, 15068, 88930, 61678) are 2 plates tall (16 LDU), not 3!
      if ((item.profile === 'slope_curved' || item.profile === 'cheese') && baseHeightY === 3) {
        baseHeightY = 2;
      }

      const descriptor: PieceDescriptor = {
        partId: item.partId,
        name: item.name,
        category: item.category as PieceCategory,
        profile: item.profile as PieceProfile,
        baseWidthX: item.widthX,
        baseDepthZ: item.depthZ,
        baseHeightY,
        slopeClass: item.slopeClass as SlopeClass,
        slopeAngle: item.slopeAngle,
        baseHeading: 0,
        curvatureClass: item.curvatureClass as CurvatureClass,
        isModern: item.isModern,
        bondingCapacity: item.bondingCapacity,
        preferredDepth: item.preferredDepth as [number, number]
      };

      // Custom offsets for special parts
      if (item.partId === '2357') {
        // Corner brick 2x2 L-shape (3 plates = 1 brick tall)
        descriptor.customOccupiedCells = [
          { dx: 0, dz: 0, dy: 0 },
          { dx: 1, dz: 0, dy: 0 },
          { dx: 0, dz: 1, dy: 0 }
        ];
        descriptor.customTopStuds = [{ dx: 0, dz: 0 }, { dx: 1, dz: 0 }, { dx: 0, dz: 1 }];
        descriptor.customBottomTubes = [{ dx: 0, dz: 0 }, { dx: 1, dz: 0 }, { dx: 0, dz: 1 }];
      } else if (item.partId === '3794b') {
        // Jumper plate
        descriptor.customTopStuds = [{ dx: 0, dz: 0 }];
      } else if (item.partId === '4740') {
        // Dish 2x2
        descriptor.customTopStuds = [{ dx: 0, dz: 0 }];
        descriptor.customBottomTubes = [{ dx: 0, dz: 0 }];
      }

      // LDraw Part Origin Invariant:
      // Bricks, plates, and flat tiles have origin (Y=0) at their TOP face.
      // Slopes with curved or cheese profile (15068, 11477, 88930, 54200) have origin (Y=0) at their BOTTOM face.
      const isBottomOrigin = descriptor.profile === 'slope_curved' || descriptor.profile === 'cheese';
      const yOffsetPlates = isBottomOrigin ? descriptor.baseHeightY : 0;

      const fp = new PieceFingerprint(descriptor);
      const meta: LDrawConnectorMeta = {
        partId: descriptor.partId,
        name: descriptor.name,
        category: descriptor.category,
        profile: descriptor.profile,
        footprint: [descriptor.baseWidthX, descriptor.baseDepthZ, descriptor.baseHeightY],
        bondingCapacity: descriptor.bondingCapacity,
        isModern: descriptor.isModern,
        slopeClass: descriptor.slopeClass,
        slopeAngle: descriptor.slopeAngle,
        curvatureClass: descriptor.curvatureClass,
        preferredDepth: descriptor.preferredDepth,
        fingerprint: fp,
        ldrawOffset: [0, 0],
        ldrawPartCenter: LDRAW_PART_CENTROIDS[descriptor.partId] || [0, 0],
        yOffsetPlates
      };

      this.connectors.set(descriptor.partId, meta);

      // Category indexing
      if (!this.byCategory.has(meta.category)) this.byCategory.set(meta.category, []);
      this.byCategory.get(meta.category)!.push(meta);

      // Profile indexing
      if (!this.byProfile.has(meta.profile)) this.byProfile.set(meta.profile, []);
      this.byProfile.get(meta.profile)!.push(meta);

      // Fast Index 1: FILL pieces indexed by canonical dimension "wx,wz,hy"
      if (meta.category === 'FILL') {
        const cWx = Math.min(meta.footprint[0], meta.footprint[1]);
        const cWz = Math.max(meta.footprint[0], meta.footprint[1]);
        const dimKey = `${cWx},${cWz},${meta.footprint[2]}`;
        if (!this.fillByDimensions.has(dimKey)) this.fillByDimensions.set(dimKey, []);
        this.fillByDimensions.get(dimKey)!.push(meta);
      }

      // Fast Index 2: EDGE pieces indexed by slope and curvature
      if (meta.category === 'EDGE') {
        if (!this.edgeBySlope.has(meta.slopeClass)) this.edgeBySlope.set(meta.slopeClass, []);
        this.edgeBySlope.get(meta.slopeClass)!.push(meta);

        if (!this.edgeByCurvature.has(meta.curvatureClass)) this.edgeByCurvature.set(meta.curvatureClass, []);
        this.edgeByCurvature.get(meta.curvatureClass)!.push(meta);

        if (meta.profile === 'tile_flat') {
          const tileKey = `${Math.min(meta.footprint[0], meta.footprint[1])},${Math.max(meta.footprint[0], meta.footprint[1])}`;
          if (!this.tileByDimensions.has(tileKey)) this.tileByDimensions.set(tileKey, []);
          this.tileByDimensions.get(tileKey)!.push(meta);
        }
      }

      // Fast Index 3: LEAF pieces indexed by profile
      if (meta.category === 'LEAF') {
        if (!this.leafByProfile.has(meta.profile)) this.leafByProfile.set(meta.profile, []);
        this.leafByProfile.get(meta.profile)!.push(meta);
      }
    }

    console.log(`[ConnectorDatabase] Loaded ${this.connectors.size} authentic LDraw connectors:`);
    console.log(`  FILL: ${this.byCategory.get('FILL')?.length || 0}`);
    console.log(`  EDGE: ${this.byCategory.get('EDGE')?.length || 0}`);
    console.log(`  LEAF: ${this.byCategory.get('LEAF')?.length || 0}`);
  }

  public getConnector(partId: string): LDrawConnectorMeta | undefined {
    return this.connectors.get(partId);
  }

  public getByCategory(category: PieceCategory): LDrawConnectorMeta[] {
    return this.byCategory.get(category) || [];
  }

  public getByProfile(profile: PieceProfile): LDrawConnectorMeta[] {
    return this.byProfile.get(profile) || [];
  }

  /**
   * Fast O(1) query: Finds the best matching FILL brick/plate for the available space.
   */
  public queryBestFillPieces(maxWx: number, maxWz: number, targetHy: number): LDrawConnectorMeta[] {
    const results: LDrawConnectorMeta[] = [];
    const minW = Math.min(maxWx, maxWz);
    const maxW = Math.max(maxWx, maxWz);

    // Try canonical sizes descending
    for (let w = minW; w >= 1; w--) {
      for (let d = maxW; d >= w; d--) {
        const key = `${w},${d},${targetHy}`;
        const matches = this.fillByDimensions.get(key);
        if (matches && matches.length > 0) {
          results.push(...matches);
          if (results.length >= 3) return results;
        }
      }
    }

    // Fallback to plates if bricks couldn't fit
    if (targetHy === 3 && results.length === 0) {
      return this.queryBestFillPieces(maxWx, maxWz, 1);
    }

    return results;
  }
}

export const CONNECTOR_DATABASE = ConnectorDatabase.getInstance();
