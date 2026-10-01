import type { PlacedBrick, ConnectorSite, BuildabilityStats } from './types';

export interface MechanicalEdge {
  fromBrickId: string;
  toBrickId: string;
  contactPos: [number, number, number];
  jointType: string;
}

/**
 * Mechanical Assembly Graph tracking physical connector snaps, seam staggering,
 * and physical buildability grounding (LTRON / LDCAD standard).
 */
export class AssemblyGraph3D {
  private bricks: Map<string, PlacedBrick> = new Map();
  // Map of active world connector positions to brick instances
  // Key: "gx,gz,gy,dx,dz,dy,polarity" -> { brickId, connector }
  private connectorRegistry: Map<string, { brickId: string; connector: ConnectorSite }> = new Map();

  // Adjacency graph: brickId -> Set of adjacent connected brickIds
  private adjacency: Map<string, Set<string>> = new Map();

  // DSU (Union-Find) for grounding verification: maps brickId -> parentId
  private dsuParent: Map<string, string> = new Map();
  private readonly GROUND_ID = '__GROUND__';

  constructor() {
    this.dsuParent.set(this.GROUND_ID, this.GROUND_ID);
  }

  private dsuFind(id: string): string {
    let root = id;
    while (this.dsuParent.get(root) && this.dsuParent.get(root) !== root) {
      root = this.dsuParent.get(root)!;
    }
    // Path compression
    let curr = id;
    while (curr !== root) {
      const next = this.dsuParent.get(curr);
      if (!next) break;
      this.dsuParent.set(curr, root);
      curr = next;
    }
    return root;
  }

  private dsuUnion(id1: string, id2: string): void {
    const root1 = this.dsuFind(id1);
    const root2 = this.dsuFind(id2);
    if (root1 === root2) return;

    // Prioritize grounding root
    if (root1 === this.GROUND_ID) {
      this.dsuParent.set(root2, this.GROUND_ID);
    } else if (root2 === this.GROUND_ID) {
      this.dsuParent.set(root1, this.GROUND_ID);
    } else {
      this.dsuParent.set(root2, root1);
    }
  }

  private getConnectorKey(gx: number, gz: number, gy: number, dx: number, dz: number, dy: number, polarity: string): string {
    return `${gx},${gz},${gy},${dx},${dz},${dy},${polarity}`;
  }

  /**
   * Registers a placed brick into the mechanical graph and forms edges with mating connectors.
   */
  public addBrick(brick: PlacedBrick): MechanicalEdge[] {
    this.bricks.set(brick.instanceId, brick);
    this.adjacency.set(brick.instanceId, new Set());
    this.dsuParent.set(brick.instanceId, brick.instanceId);

    // If bottom touches base plane y = 0, anchor directly to ground
    if (brick.gridPos[2] === 0) {
      this.dsuUnion(brick.instanceId, this.GROUND_ID);
    }

    const createdEdges: MechanicalEdge[] = [];
    const [bx, bz, by] = brick.gridPos;

    for (const conn of brick.connectors) {
      const gx = bx + conn.localPos[0];
      const gz = bz + conn.localPos[1];
      const gy = by + conn.localPos[2];
      const [dx, dz, dy] = conn.direction;

      // Look for complementary connector at the exact same location:
      // Opposite direction (-dx, -dz, -dy) and opposite polarity
      const oppDx = -dx;
      const oppDz = -dz;
      const oppDy = -dy;
      const oppPolarity = conn.polarity === 'MALE' ? 'FEMALE' : 'MALE';

      const matingKey = this.getConnectorKey(gx, gz, gy, oppDx, oppDz, oppDy, oppPolarity);
      const mate = this.connectorRegistry.get(matingKey);

      if (mate && mate.brickId !== brick.instanceId) {
        // Physical connection formed
        this.adjacency.get(brick.instanceId)!.add(mate.brickId);
        this.adjacency.get(mate.brickId)!.add(brick.instanceId);
        this.dsuUnion(brick.instanceId, mate.brickId);

        createdEdges.push({
          fromBrickId: brick.instanceId,
          toBrickId: mate.brickId,
          contactPos: [gx, gz, gy],
          jointType: conn.jointType
        });
      }

      // Register this connector
      const selfKey = this.getConnectorKey(gx, gz, gy, dx, dz, dy, conn.polarity);
      this.connectorRegistry.set(selfKey, { brickId: brick.instanceId, connector: conn });
    }

    return createdEdges;
  }

  /**
   * Removes a brick from the graph and connector registry.
   */
  public removeBrick(instanceId: string): void {
    const brick = this.bricks.get(instanceId);
    if (!brick) return;

    const [bx, bz, by] = brick.gridPos;
    for (const conn of brick.connectors) {
      const gx = bx + conn.localPos[0];
      const gz = bz + conn.localPos[1];
      const gy = by + conn.localPos[2];
      const [dx, dz, dy] = conn.direction;
      const key = this.getConnectorKey(gx, gz, gy, dx, dz, dy, conn.polarity);
      if (this.connectorRegistry.get(key)?.brickId === instanceId) {
        this.connectorRegistry.delete(key);
      }
    }

    // Disconnect edges
    const neighbors = this.adjacency.get(instanceId);
    if (neighbors) {
      for (const n of neighbors) {
        this.adjacency.get(n)?.delete(instanceId);
      }
    }
    this.adjacency.delete(instanceId);
    this.bricks.delete(instanceId);
    this.dsuParent.delete(instanceId);

    // Rebuild DSU components after deletion
    this.rebuildDSU();
  }

  private rebuildDSU(): void {
    this.dsuParent.clear();
    this.dsuParent.set(this.GROUND_ID, this.GROUND_ID);

    for (const [id, brick] of this.bricks) {
      this.dsuParent.set(id, id);
      if (brick.gridPos[2] === 0) {
        this.dsuUnion(id, this.GROUND_ID);
      }
    }

    for (const [id, neighbors] of this.adjacency) {
      for (const n of neighbors) {
        this.dsuUnion(id, n);
      }
    }
  }

  public isGrounded(instanceId: string): boolean {
    if (!this.bricks.has(instanceId)) return false;
    return this.dsuFind(instanceId) === this.GROUND_ID;
  }

  /**
   * Checks if candidate connectors at (x, z, y) form at least one valid mechanical snap
   * with an already-placed grounded brick (or touches y = 0).
   */
  public canConnectToGrounded(x: number, z: number, y: number, connectors: ConnectorSite[]): boolean {
    if (y === 0) return true;

    for (const conn of connectors) {
      const gx = x + conn.localPos[0];
      const gz = z + conn.localPos[1];
      const gy = y + conn.localPos[2];
      const oppDx = -conn.direction[0];
      const oppDz = -conn.direction[1];
      const oppDy = -conn.direction[2];
      const oppPolarity = conn.polarity === 'MALE' ? 'FEMALE' : 'MALE';

      const matingKey = this.getConnectorKey(gx, gz, gy, oppDx, oppDz, oppDy, oppPolarity);
      const mate = this.connectorRegistry.get(matingKey);
      if (mate && this.isGrounded(mate.brickId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Computes seam staggering / running bond score for a candidate brick.
   * Rewards spanning across multiple supporting bricks.
   * Heavily penalizes vertical seam alignment (Minecraft column stacking).
   */
  public evaluateSeamInterlock(
    candidateX: number,
    candidateZ: number,
    candidateY: number,
    widthStuds: number,
    depthStuds: number,
    heightPlates: number
  ): number {
    let score = 0;
    const candMinX = candidateX;
    const candMaxX = candidateX + widthStuds;
    const candMinZ = candidateZ;
    const candMaxZ = candidateZ + depthStuds;

    // Check adjacent layer directly below (y - 1) and directly above (y + heightPlates)
    const testLayers = [candidateY - 1, candidateY + heightPlates];
    const supportingBricks = new Set<string>();

    for (const [id, brick] of this.bricks) {
      const bMinY = brick.gridPos[2];
      const bMaxY = bMinY + brick.size[2];

      const touchesAdjacentLayer = (bMaxY === candidateY) || (bMinY === candidateY + heightPlates);
      if (!touchesAdjacentLayer) continue;

      const bMinX = brick.gridPos[0];
      const bMaxX = bMinX + brick.size[0];
      const bMinZ = brick.gridPos[1];
      const bMaxZ = bMinZ + brick.size[1];

      // Compute horizontal overlap rectangle
      const overlapX0 = Math.max(candMinX, bMinX);
      const overlapX1 = Math.min(candMaxX, bMaxX);
      const overlapZ0 = Math.max(candMinZ, bMinZ);
      const overlapZ1 = Math.min(candMaxZ, bMaxZ);

      if (overlapX0 < overlapX1 && overlapZ0 < overlapZ1) {
        const overlapArea = (overlapX1 - overlapX0) * (overlapZ1 - overlapZ0);
        score += overlapArea * 1.5; // Reward structural overlap area
        supportingBricks.add(id);

        // Check vertical seam alignment
        // Vertical seam aligns if boundaries match exactly
        if (candMinX === bMinX) score -= 2.0 * (overlapZ1 - overlapZ0);
        if (candMaxX === bMaxX) score -= 2.0 * (overlapZ1 - overlapZ0);
        if (candMinZ === bMinZ) score -= 2.0 * (overlapX1 - overlapX0);
        if (candMaxZ === bMaxZ) score -= 2.0 * (overlapX1 - overlapX0);
      }
    }

    // Additional running bond bonus if bridging 2 or more distinct bricks
    if (supportingBricks.size >= 2) {
      score += 4.0;
    }

    return score;
  }

  public getStats(): BuildabilityStats {
    let groundedCount = 0;
    let totalConnections = 0;

    for (const [id] of this.bricks) {
      if (this.isGrounded(id)) {
        groundedCount++;
      }
      totalConnections += (this.adjacency.get(id)?.size ?? 0);
    }

    const total = this.bricks.size;
    const floating = total - groundedCount;

    return {
      totalBricks: total,
      groundedBricks: groundedCount,
      floatingBricks: floating,
      is100PercentGrounded: total > 0 ? floating === 0 : true,
      totalConnections: Math.floor(totalConnections / 2),
      seamInterlockScore: 0
    };
  }

  public getAllBricks(): PlacedBrick[] {
    return Array.from(this.bricks.values());
  }

  public getBrick(id: string): PlacedBrick | undefined {
    return this.bricks.get(id);
  }
}
