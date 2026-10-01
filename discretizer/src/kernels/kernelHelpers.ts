import type { ConnectorSite } from '../core/types';

/**
 * Creates a fully solid 3D occupancy mask [heightPlates][depthStuds][widthStuds].
 */
export function createSolidMask(w: number, d: number, h: number): boolean[][][] {
  const mask: boolean[][][] = [];
  for (let y = 0; y < h; y++) {
    const layer: boolean[][] = [];
    for (let z = 0; z < d; z++) {
      layer.push(new Array(w).fill(true));
    }
    mask.push(layer);
  }
  return mask;
}

/**
 * Creates a sloped 3D occupancy mask where material recedes along the slope axis.
 */
export function createSlopeMask(
  w: number,
  d: number,
  h: number,
  slopeDir: '+z' | '-z' = '+z'
): boolean[][][] {
  const mask: boolean[][][] = [];
  for (let y = 0; y < h; y++) {
    const layer: boolean[][] = [];
    for (let z = 0; z < d; z++) {
      const row: boolean[] = [];
      const zNorm = slopeDir === '+z' ? z / d : (d - 1 - z) / d;
      const yNorm = y / h;
      // Sloping threshold: upper portion towards front is empty
      const isSolid = yNorm <= (1.0 - zNorm * 0.75);
      for (let x = 0; x < w; x++) {
        row.push(isSolid);
      }
      layer.push(row);
    }
    mask.push(layer);
  }
  return mask;
}

/**
 * Creates a cylindrical / round 3D occupancy mask.
 */
export function createRoundMask(w: number, d: number, h: number): boolean[][][] {
  const mask: boolean[][][] = [];
  const cx = (w - 1) / 2;
  const cz = (d - 1) / 2;
  const rx = w / 2;
  const rz = d / 2;

  for (let y = 0; y < h; y++) {
    const layer: boolean[][] = [];
    for (let z = 0; z < d; z++) {
      const row: boolean[] = [];
      for (let x = 0; x < w; x++) {
        const nx = (x - cx) / rx;
        const nz = (z - cz) / rz;
        row.push(nx * nx + nz * nz <= 1.05);
      }
      layer.push(row);
    }
    mask.push(layer);
  }
  return mask;
}

/**
 * Standard System stud (top male) and tube (bottom female) connectors.
 */
export function createStandardConnectors(
  w: number,
  d: number,
  h: number,
  hasTopStuds: boolean = true,
  hasBottomTubes: boolean = true
): ConnectorSite[] {
  const conns: ConnectorSite[] = [];

  if (hasTopStuds) {
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < d; z++) {
        conns.push({
          localPos: [x, z, h],
          direction: [0, 0, 1], // +Y skyward
          polarity: 'MALE',
          jointType: 'STUD_TUBE'
        });
      }
    }
  }

  if (hasBottomTubes) {
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < d; z++) {
        conns.push({
          localPos: [x, z, 0],
          direction: [0, 0, -1], // -Y groundward
          polarity: 'FEMALE',
          jointType: 'STUD_TUBE'
        });
      }
    }
  }

  return conns;
}

/**
 * Technic Brick connectors: standard top studs + bottom tubes, plus horizontal pin holes.
 */
export function createTechnicBrickConnectors(
  w: number,
  d: number,
  h: number,
  holeCount: number
): ConnectorSite[] {
  const conns = createStandardConnectors(w, d, h, true, true);

  // Pin holes along the depth (Z) axis, passing through along X
  const step = d / (holeCount + 1);
  for (let i = 1; i <= holeCount; i++) {
    const zPos = Math.round(i * step - 0.5);
    const yCenter = Math.floor(h / 2);
    // Pin hole entrances on both lateral sides (+X and -X)
    conns.push({
      localPos: [0, zPos, yCenter],
      direction: [-1, 0, 0],
      polarity: 'FEMALE',
      jointType: 'PIN_HOLE'
    });
    conns.push({
      localPos: [w - 1, zPos, yCenter],
      direction: [1, 0, 0],
      polarity: 'FEMALE',
      jointType: 'PIN_HOLE'
    });
  }

  return conns;
}

/**
 * Technic Studless Beam (Liftarm) connectors: pin holes through the thickness.
 */
export function createTechnicBeamConnectors(
  lengthStuds: number,
  thicknessPlates: number = 3
): ConnectorSite[] {
  const conns: ConnectorSite[] = [];
  const yCenter = Math.floor(thicknessPlates / 2);

  for (let z = 0; z < lengthStuds; z++) {
    // Lateral pin holes through thickness
    conns.push({
      localPos: [0, z, yCenter],
      direction: [-1, 0, 0],
      polarity: 'FEMALE',
      jointType: 'PIN_HOLE'
    });
    conns.push({
      localPos: [0, z, yCenter],
      direction: [1, 0, 0],
      polarity: 'FEMALE',
      jointType: 'PIN_HOLE'
    });
  }

  return conns;
}

/**
 * Technic Axle connectors: axial mechanical engagement.
 */
export function createAxleConnectors(lengthStuds: number): ConnectorSite[] {
  const conns: ConnectorSite[] = [];
  for (let z = 0; z < lengthStuds; z++) {
    conns.push({
      localPos: [0, z, 0],
      direction: [0, 1, 0],
      polarity: 'MALE',
      jointType: 'AXLE_SOCKET'
    });
  }
  return conns;
}

/**
 * Technic Pin connectors: friction or frictionless pins.
 */
export function createPinConnectors(lengthStuds: number): ConnectorSite[] {
  const conns: ConnectorSite[] = [];
  for (let z = 0; z < lengthStuds; z++) {
    conns.push({
      localPos: [0, z, 0],
      direction: [1, 0, 0],
      polarity: 'MALE',
      jointType: 'PIN_HOLE'
    });
  }
  return conns;
}
