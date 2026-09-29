/**
 * LDraw Connector Database for Markov Chain & Growing Core Discretization.
 *
 * Fully compliant with GEMINI.md:
 * - Proactively utilizes Modern Curved Slopes, Macaroni Tiles, Inverted Radar Dishes,
 *   Bionicle/Constraction teeth and spines, Studless Flat Tiles, and High-Clutch Bricks.
 * - Categorizes parts into LEAF, EDGE, FILL, EMPTY with precomputed piece fingerprints.
 */

import { PieceCategory, PieceProfile, CurvatureClass, SlopeClass } from './types';
import { PieceFingerprint, PieceDescriptor } from './pieceFingerprint';

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
  yOffsetPlates: number; // Vertical offset in plates
}

export class ConnectorDatabase {
  private static instance: ConnectorDatabase | null = null;
  public connectors: Map<string, LDrawConnectorMeta> = new Map();
  public byCategory: Map<PieceCategory, LDrawConnectorMeta[]> = new Map();
  public byProfile: Map<PieceProfile, LDrawConnectorMeta[]> = new Map();

  constructor() {
    this.registerAllConnectors();
  }

  public static getInstance(): ConnectorDatabase {
    if (!ConnectorDatabase.instance) {
      ConnectorDatabase.instance = new ConnectorDatabase();
    }
    return ConnectorDatabase.instance;
  }

  private register(descriptor: PieceDescriptor, ldrawOffset: [number, number] = [0, 0], yOffsetPlates: number = 0): void {
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
      ldrawOffset,
      yOffsetPlates
    };

    this.connectors.set(descriptor.partId, meta);

    if (!this.byCategory.has(meta.category)) {
      this.byCategory.set(meta.category, []);
    }
    this.byCategory.get(meta.category)!.push(meta);

    if (!this.byProfile.has(meta.profile)) {
      this.byProfile.set(meta.profile, []);
    }
    this.byProfile.get(meta.profile)!.push(meta);
  }

  private registerAllConnectors(): void {
    // =========================================================================
    // 1. FILL: Heavy Bulk Structural Connectors (Bricks & Plates)
    // Deep core & mantle structural interlocking (Running Bond spine)
    // =========================================================================
    // Bricks (height 3 plates)
    this.register({
      partId: '3007',
      name: 'Brick 2 x 8',
      category: 'FILL',
      profile: 'brick',
      baseWidthX: 2,
      baseDepthZ: 8,
      baseHeightY: 3,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: false,
      bondingCapacity: 10,
      preferredDepth: [2, 999]
    });

    this.register({
      partId: '2456',
      name: 'Brick 2 x 6',
      category: 'FILL',
      profile: 'brick',
      baseWidthX: 2,
      baseDepthZ: 6,
      baseHeightY: 3,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: false,
      bondingCapacity: 9,
      preferredDepth: [2, 999]
    });

    this.register({
      partId: '3001',
      name: 'Brick 2 x 4',
      category: 'FILL',
      profile: 'brick',
      baseWidthX: 2,
      baseDepthZ: 4,
      baseHeightY: 3,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: false,
      bondingCapacity: 9,
      preferredDepth: [2, 999]
    });

    this.register({
      partId: '3002',
      name: 'Brick 2 x 3',
      category: 'FILL',
      profile: 'brick',
      baseWidthX: 2,
      baseDepthZ: 3,
      baseHeightY: 3,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: false,
      bondingCapacity: 8,
      preferredDepth: [1, 999]
    });

    this.register({
      partId: '3003',
      name: 'Brick 2 x 2',
      category: 'FILL',
      profile: 'brick',
      baseWidthX: 2,
      baseDepthZ: 2,
      baseHeightY: 3,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: false,
      bondingCapacity: 8,
      preferredDepth: [1, 999]
    });

    this.register({
      partId: '3010',
      name: 'Brick 1 x 4',
      category: 'FILL',
      profile: 'brick',
      baseWidthX: 1,
      baseDepthZ: 4,
      baseHeightY: 3,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: false,
      bondingCapacity: 7,
      preferredDepth: [1, 999]
    });

    this.register({
      partId: '3622',
      name: 'Brick 1 x 3',
      category: 'FILL',
      profile: 'brick',
      baseWidthX: 1,
      baseDepthZ: 3,
      baseHeightY: 3,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: false,
      bondingCapacity: 6,
      preferredDepth: [1, 999]
    });

    this.register({
      partId: '3004',
      name: 'Brick 1 x 2',
      category: 'FILL',
      profile: 'brick',
      baseWidthX: 1,
      baseDepthZ: 2,
      baseHeightY: 3,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: false,
      bondingCapacity: 6,
      preferredDepth: [1, 999]
    });

    this.register({
      partId: '3005',
      name: 'Brick 1 x 1',
      category: 'FILL',
      profile: 'brick',
      baseWidthX: 1,
      baseDepthZ: 1,
      baseHeightY: 3,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: false,
      bondingCapacity: 5,
      preferredDepth: [1, 999]
    });

    // 2x2 Corner Brick (2357) - L-Shape (3 cells occupied)
    this.register({
      partId: '2357',
      name: 'Brick 2 x 2 Corner',
      category: 'FILL',
      profile: 'brick',
      baseWidthX: 2,
      baseDepthZ: 2,
      baseHeightY: 3,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'corner_macaroni',
      isModern: false,
      bondingCapacity: 8,
      preferredDepth: [1, 999],
      customOccupiedCells: [
        { dx: 0, dz: 0, dy: 0 }, { dx: 0, dz: 0, dy: 1 }, { dx: 0, dz: 0, dy: 2 },
        { dx: 1, dz: 0, dy: 0 }, { dx: 1, dz: 0, dy: 1 }, { dx: 1, dz: 0, dy: 2 },
        { dx: 0, dz: 1, dy: 0 }, { dx: 0, dz: 1, dy: 1 }, { dx: 0, dz: 1, dy: 2 }
      ],
      customTopStuds: [{ dx: 0, dz: 0 }, { dx: 1, dz: 0 }, { dx: 0, dz: 1 }],
      customBottomTubes: [{ dx: 0, dz: 0 }, { dx: 1, dz: 0 }, { dx: 0, dz: 1 }]
    });

    // Plates (height 1 plate)
    this.register({
      partId: '3020',
      name: 'Plate 2 x 4',
      category: 'FILL',
      profile: 'plate',
      baseWidthX: 2,
      baseDepthZ: 4,
      baseHeightY: 1,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: false,
      bondingCapacity: 7,
      preferredDepth: [1, 999]
    });

    this.register({
      partId: '3022',
      name: 'Plate 2 x 2',
      category: 'FILL',
      profile: 'plate',
      baseWidthX: 2,
      baseDepthZ: 2,
      baseHeightY: 1,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: false,
      bondingCapacity: 6,
      preferredDepth: [1, 999]
    });

    this.register({
      partId: '3710',
      name: 'Plate 1 x 4',
      category: 'FILL',
      profile: 'plate',
      baseWidthX: 1,
      baseDepthZ: 4,
      baseHeightY: 1,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: false,
      bondingCapacity: 6,
      preferredDepth: [1, 999]
    });

    this.register({
      partId: '3023',
      name: 'Plate 1 x 2',
      category: 'FILL',
      profile: 'plate',
      baseWidthX: 1,
      baseDepthZ: 2,
      baseHeightY: 1,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: false,
      bondingCapacity: 5,
      preferredDepth: [1, 999]
    });

    this.register({
      partId: '3024',
      name: 'Plate 1 x 1',
      category: 'FILL',
      profile: 'plate',
      baseWidthX: 1,
      baseDepthZ: 1,
      baseHeightY: 1,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: false,
      bondingCapacity: 4,
      preferredDepth: [1, 999]
    });

    // Jumper Plate 1x2 with 1 Centered Stud (3794b) - Enables half-stud offset running bond
    this.register({
      partId: '3794b',
      name: 'Plate 1 x 2 with Center Stud',
      category: 'FILL',
      profile: 'plate',
      baseWidthX: 1,
      baseDepthZ: 2,
      baseHeightY: 1,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: true,
      bondingCapacity: 6,
      preferredDepth: [1, 999],
      customTopStuds: [{ dx: 0, dz: 0.5 }]
    });

    // =========================================================================
    // 2. EDGE: Boundary Surface, Slopes, Curved Slopes, Macaroni, Tiles
    // Seals exterior boundary with authentic curved and angled aesthetics
    // =========================================================================
    // Modern Curved Slopes (Studless convex top, full clutch beneath)
    this.register({
      partId: '11477',
      name: 'Slope Curved 2 x 1',
      category: 'EDGE',
      profile: 'slope_curved',
      baseWidthX: 1,
      baseDepthZ: 2,
      baseHeightY: 3,
      slopeClass: 'slope_curved',
      slopeAngle: 33,
      baseHeading: 0,
      curvatureClass: 'cylindrical_convex',
      isModern: true,
      bondingCapacity: 7,
      preferredDepth: [1, 1],
      customTopStuds: []
    });

    this.register({
      partId: '15068',
      name: 'Slope Curved 2 x 2',
      category: 'EDGE',
      profile: 'slope_curved',
      baseWidthX: 2,
      baseDepthZ: 2,
      baseHeightY: 3,
      slopeClass: 'slope_curved',
      slopeAngle: 33,
      baseHeading: 0,
      curvatureClass: 'cylindrical_convex',
      isModern: true,
      bondingCapacity: 8,
      preferredDepth: [1, 1],
      customTopStuds: []
    });

    this.register({
      partId: '61678',
      name: 'Slope Curved 4 x 1',
      category: 'EDGE',
      profile: 'slope_curved',
      baseWidthX: 1,
      baseDepthZ: 4,
      baseHeightY: 3,
      slopeClass: 'slope_curved',
      slopeAngle: 25,
      baseHeading: 0,
      curvatureClass: 'cylindrical_convex',
      isModern: true,
      bondingCapacity: 8,
      preferredDepth: [1, 1],
      customTopStuds: []
    });

    this.register({
      partId: '88930',
      name: 'Slope Curved 4 x 2',
      category: 'EDGE',
      profile: 'slope_curved',
      baseWidthX: 2,
      baseDepthZ: 4,
      baseHeightY: 3,
      slopeClass: 'slope_curved',
      slopeAngle: 25,
      baseHeading: 0,
      curvatureClass: 'cylindrical_convex',
      isModern: true,
      bondingCapacity: 9,
      preferredDepth: [1, 1],
      customTopStuds: []
    });

    // Inverted Slopes (Bottom concave arch, top studs)
    this.register({
      partId: '24201',
      name: 'Slope Curved 2 x 1 Inverted',
      category: 'EDGE',
      profile: 'slope_inverted',
      baseWidthX: 1,
      baseDepthZ: 2,
      baseHeightY: 3,
      slopeClass: 'slope_inverted',
      slopeAngle: -33,
      baseHeading: 0,
      curvatureClass: 'cylindrical_concave',
      isModern: true,
      bondingCapacity: 6,
      preferredDepth: [1, 1]
    });

    this.register({
      partId: '93273',
      name: 'Slope Curved 4 x 1 Inverted',
      category: 'EDGE',
      profile: 'slope_inverted',
      baseWidthX: 1,
      baseDepthZ: 4,
      baseHeightY: 3,
      slopeClass: 'slope_inverted',
      slopeAngle: -25,
      baseHeading: 0,
      curvatureClass: 'cylindrical_concave',
      isModern: true,
      bondingCapacity: 7,
      preferredDepth: [1, 1]
    });

    // 45° Slopes
    this.register({
      partId: '3040',
      name: 'Slope 45 2 x 1',
      category: 'EDGE',
      profile: 'slope_45',
      baseWidthX: 1,
      baseDepthZ: 2,
      baseHeightY: 3,
      slopeClass: 'slope_45',
      slopeAngle: 45,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: false,
      bondingCapacity: 7,
      preferredDepth: [1, 1],
      customTopStuds: [{ dx: 0, dz: 1 }]
    });

    this.register({
      partId: '3039',
      name: 'Slope 45 2 x 2',
      category: 'EDGE',
      profile: 'slope_45',
      baseWidthX: 2,
      baseDepthZ: 2,
      baseHeightY: 3,
      slopeClass: 'slope_45',
      slopeAngle: 45,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: false,
      bondingCapacity: 8,
      preferredDepth: [1, 1],
      customTopStuds: [{ dx: 0, dz: 1 }, { dx: 1, dz: 1 }]
    });

    // Macaroni & Round Corner Tiles (Curved perimeters)
    this.register({
      partId: '27925',
      name: 'Tile 2 x 2 Macaroni Curved Round',
      category: 'EDGE',
      profile: 'macaroni',
      baseWidthX: 2,
      baseDepthZ: 2,
      baseHeightY: 1,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'corner_macaroni',
      isModern: true,
      bondingCapacity: 7,
      preferredDepth: [1, 1],
      customTopStuds: [],
      customBottomTubes: [{ dx: 0, dz: 0 }, { dx: 1, dz: 0 }, { dx: 0, dz: 1 }]
    });

    this.register({
      partId: '25269',
      name: 'Tile 1 x 1 Quarter Round',
      category: 'EDGE',
      profile: 'macaroni',
      baseWidthX: 1,
      baseDepthZ: 1,
      baseHeightY: 1,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'corner_macaroni',
      isModern: true,
      bondingCapacity: 5,
      preferredDepth: [1, 1],
      customTopStuds: []
    });

    // Studless Flat Tiles (Smooth studless top finish per LEGO Design Series standard)
    this.register({
      partId: '3068b',
      name: 'Tile 2 x 2 Flat',
      category: 'EDGE',
      profile: 'tile_flat',
      baseWidthX: 2,
      baseDepthZ: 2,
      baseHeightY: 1,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: true,
      bondingCapacity: 7,
      preferredDepth: [1, 1],
      customTopStuds: []
    });

    this.register({
      partId: '3069b',
      name: 'Tile 1 x 2 Flat',
      category: 'EDGE',
      profile: 'tile_flat',
      baseWidthX: 1,
      baseDepthZ: 2,
      baseHeightY: 1,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: true,
      bondingCapacity: 6,
      preferredDepth: [1, 1],
      customTopStuds: []
    });

    this.register({
      partId: '2431',
      name: 'Tile 1 x 4 Flat',
      category: 'EDGE',
      profile: 'tile_flat',
      baseWidthX: 1,
      baseDepthZ: 4,
      baseHeightY: 1,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: true,
      bondingCapacity: 7,
      preferredDepth: [1, 1],
      customTopStuds: []
    });

    this.register({
      partId: '98138',
      name: 'Tile 1 x 1 Round Flat',
      category: 'EDGE',
      profile: 'tile_flat',
      baseWidthX: 1,
      baseDepthZ: 1,
      baseHeightY: 1,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: true,
      bondingCapacity: 5,
      preferredDepth: [1, 1],
      customTopStuds: []
    });

    // =========================================================================
    // 3. LEAF: Terminal Extremities, Apexes, Crests, Bionicle & Creature Elements
    // Crowns domes, organic crests, sharp cusps, terminal horns
    // =========================================================================
    // Cheese Slopes (Low-profile 33° slope)
    this.register({
      partId: '54200',
      name: 'Slope 31 1 x 1 x 2/3 (Cheese Slope)',
      category: 'LEAF',
      profile: 'cheese',
      baseWidthX: 1,
      baseDepthZ: 1,
      baseHeightY: 2,
      slopeClass: 'slope_33',
      slopeAngle: 33,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: true,
      bondingCapacity: 5,
      preferredDepth: [1, 1],
      customTopStuds: []
    });

    this.register({
      partId: '85984',
      name: 'Slope 31 1 x 2 x 2/3 (Double Cheese)',
      category: 'LEAF',
      profile: 'cheese',
      baseWidthX: 1,
      baseDepthZ: 2,
      baseHeightY: 2,
      slopeClass: 'slope_33',
      slopeAngle: 33,
      baseHeading: 0,
      curvatureClass: 'flat',
      isModern: true,
      bondingCapacity: 6,
      preferredDepth: [1, 1],
      customTopStuds: []
    });

    // Inverted Radar Dishes (Crowns domes & spherical apexes)
    this.register({
      partId: '4740',
      name: 'Dish 2 x 2 Inverted (Radar)',
      category: 'LEAF',
      profile: 'dish',
      baseWidthX: 2,
      baseDepthZ: 2,
      baseHeightY: 2,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'spherical_dome',
      isModern: true,
      bondingCapacity: 6,
      preferredDepth: [1, 1],
      customTopStuds: [{ dx: 0.5, dz: 0.5 }],
      customBottomTubes: [{ dx: 0.5, dz: 0.5 }]
    });

    // Bionicle Tooth / Spine 1x3x2 (41669) - Organic spine, crest, beak, ridge
    this.register({
      partId: '41669',
      name: 'Bionicle Tooth / Spine 1 x 3 x 2',
      category: 'LEAF',
      profile: 'tooth_creature',
      baseWidthX: 1,
      baseDepthZ: 3,
      baseHeightY: 6, // 2 bricks tall
      slopeClass: 'slope_75',
      slopeAngle: 75,
      baseHeading: 0,
      curvatureClass: 'sharp_cusp',
      isModern: true,
      bondingCapacity: 6,
      preferredDepth: [1, 1],
      customTopStuds: [],
      customBottomTubes: [{ dx: 0, dz: 0 }]
    });

    // Barb / Tooth / Horn 1x1 (53451) - Small organic claw/horn
    this.register({
      partId: '53451',
      name: 'Barb / Horn 1 x 1 x 0.67',
      category: 'LEAF',
      profile: 'tooth_creature',
      baseWidthX: 1,
      baseDepthZ: 1,
      baseHeightY: 2,
      slopeClass: 'slope_75',
      slopeAngle: 75,
      baseHeading: 0,
      curvatureClass: 'sharp_cusp',
      isModern: true,
      bondingCapacity: 5,
      preferredDepth: [1, 1],
      customTopStuds: [],
      customBottomTubes: [{ dx: 0, dz: 0 }]
    });

    // Cone 1x1 (4589b) - Pointed finial
    this.register({
      partId: '4589b',
      name: 'Cone 1 x 1 with Groove',
      category: 'LEAF',
      profile: 'cone',
      baseWidthX: 1,
      baseDepthZ: 1,
      baseHeightY: 3,
      slopeClass: 'flat',
      slopeAngle: 0,
      baseHeading: 0,
      curvatureClass: 'sharp_cusp',
      isModern: false,
      bondingCapacity: 5,
      preferredDepth: [1, 1],
      customTopStuds: [{ dx: 0, dz: 0 }],
      customBottomTubes: [{ dx: 0, dz: 0 }]
    });
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
}

export const CONNECTOR_DATABASE = ConnectorDatabase.getInstance();
