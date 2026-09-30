/**
 * Wave Function Collapse (WFC) Multi-Scale Refinement Engine with Category Profiles.
 *
 * Implements Step 2 WFC Refinement using statistical 3D transition tensors mined from
 * 1,420 official LDraw OMR models across specialized categories:
 * - 'universal': Full combined dataset (1,420 sets)
 * - 'vehicles': Creator Expert cars, Speed Champions, Technic (Mini Cooper, Beetle, Mustang, Porsche)
 * - 'architecture': Modular buildings, landmarks (Tower Bridge, Big Ben, Colosseum, Cafe Corner)
 * - 'space': Star Wars UCS, Space Shuttle (Discovery, Millennium Falcon, Blockade Runner)
 *
 * Multi-Scale Resolution Hierarchy:
 * - Macro Base (N = 8): Large core blocks (2x8, 2x6, 2x4)
 * - Mid Scale  (N = 4): Running bond seam interlocking (2x3, 2x2, 1x4, 1x2)
 * - Micro Skin (N = 2): Exterior slopes, curved slopes, macaroni, and radar dishes
 * - Fine Skin  (N = 1): 1*1*1 Bricks (3005)
 * - Finish     (N = 0): Studless flat tiles (3068b, 3069b, 2431)
 */

import { VoxelGrid, PlacedBrick, WFC_SCALE_COLORS } from './types';
import omrTensor from './omrAdjacencyTensor.json';
import { CONNECTOR_DATABASE } from './connectorDatabase';
import { LDU_STUD_PITCH, LDU_BRICK_HEIGHT } from './connectivityDictionary';

export type OMRCategory = 'universal' | 'vehicles' | 'architecture' | 'space';

export interface WFCSolutionMetrics {
  totalRefined: number;
  compatibilityScore: number;
  entropyLevels: number[];
  transitionsApplied: number;
  category: OMRCategory;
}

export class WFCRefinerEngine {
  private currentCategory: OMRCategory = 'universal';
  private tensorCache: Map<string, any> = new Map();
  private tensor: Record<string, Record<string, Array<{ partId: string; count: number; prob: number }>>>;
  private probCache: Map<string, number> = new Map();
  private frequencyCache: Map<string, number> = new Map();

  constructor() {
    this.tensor = omrTensor as any;
    this.tensorCache.set('universal', this.tensor);
  }

  public getCategory(): OMRCategory {
    return this.currentCategory;
  }

  public setCategoryTensor(category: OMRCategory, tensorData: any): void {
    this.tensorCache.set(category, tensorData);
    this.currentCategory = category;
    this.tensor = tensorData;
    this.probCache.clear();
    this.frequencyCache.clear();
  }

  /**
   * Switches the active OMR knowledge tensor at runtime with automatic on-demand code splitting.
   */
  public async switchCategory(category: OMRCategory): Promise<void> {
    if (this.currentCategory === category && this.tensor) return;

    if (this.tensorCache.has(category)) {
      this.currentCategory = category;
      this.tensor = this.tensorCache.get(category);
      this.probCache.clear();
      this.frequencyCache.clear();
      return;
    }

    try {
      let loaded: any = null;
      if (category === 'vehicles') {
        loaded = (await import('./tensors/vehicles.json')).default;
      } else if (category === 'architecture') {
        loaded = (await import('./tensors/architecture.json')).default;
      } else if (category === 'space') {
        loaded = (await import('./tensors/space.json')).default;
      } else {
        loaded = omrTensor;
      }

      this.tensorCache.set(category, loaded);
      this.currentCategory = category;
      this.tensor = loaded;
      this.probCache.clear();
      this.frequencyCache.clear();
    } catch (err) {
      console.warn(`Could not dynamically load OMR category tensor for ${category}, falling back to universal:`, err);
      this.currentCategory = 'universal';
      this.tensor = this.tensorCache.get('universal') || (omrTensor as any);
      this.probCache.clear();
      this.frequencyCache.clear();
    }
  }

  /**
   * Returns total frequency of part in the active category tensor.
   */
  public getPartFrequency(partId: string): number {
    const cached = this.frequencyCache.get(partId);
    if (cached !== undefined) return cached;
    let freq = 0;
    const dirs = this.tensor[partId];
    if (dirs) {
      for (const d of Object.keys(dirs)) {
        for (const t of dirs[d]) {
          freq += t.count;
        }
      }
    }
    this.frequencyCache.set(partId, freq);
    return freq;
  }

  /**
   * Checks whether the part is present in the active OMR category.
   */
  public isCategoryPart(partId: string): boolean {
    return Boolean(this.tensor[partId]);
  }

  /**
   * Evaluates directional transition compatibility between two adjacent pieces in O(1).
   */
  public getTransitionProbability(
    fromPartId: string,
    direction: '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z',
    toPartId: string
  ): number {
    const key = `${fromPartId}|${direction}|${toPartId}`;
    const cached = this.probCache.get(key);
    if (cached !== undefined) return cached;

    const transitions = this.tensor[fromPartId]?.[direction];
    let prob = 0.05;
    if (transitions) {
      const match = transitions.find((t) => t.partId === toPartId);
      prob = match ? match.prob : 0.01;
    }
    this.probCache.set(key, prob);
    return prob;
  }

  /**
   * Refines a set of placed bricks using WFC constraint propagation and active category knowledge.
   * Actively substitutes discordant or low-probability pieces with high-ranking category pieces.
   */
  public refineModel(bricks: PlacedBrick[], grid: VoxelGrid): WFCSolutionMetrics {
    let transitionsApplied = 0;

    const brickMap = new Map<string, PlacedBrick>();
    const posToBrick = new Map<string, string>();

    for (const b of bricks) {
      brickMap.set(b.id, b);
      const [bx, bz, by] = b.gridPos;
      const [bw, bd, bh] = b.size;
      for (let dx = 0; dx < bw; dx++) {
        for (let dz = 0; dz < bd; dz++) {
          for (let dy = 0; dy < bh; dy++) {
            posToBrick.set(`${bx + dx},${bz + dz},${by + dy}`, b.id);
          }
        }
      }
    }

    // Helper: evaluate average transition compatibility for a candidate part at brick position
    const evalNeighborProb = (brick: PlacedBrick, candidatePartId: string): number => {
      const [bx, bz, by] = brick.gridPos;
      const [bw, bd, bh] = brick.size;
      let pSum = 0;
      let count = 0;

      // +Y
      const topId = posToBrick.get(`${bx},${bz},${by + bh}`);
      if (topId && topId !== brick.id) {
        const topBrick = brickMap.get(topId);
        if (topBrick) {
          pSum += this.getTransitionProbability(candidatePartId, '+Y', topBrick.partId);
          count++;
        }
      }
      // -Y
      const botId = posToBrick.get(`${bx},${bz},${by - 1}`);
      if (botId && botId !== brick.id) {
        const botBrick = brickMap.get(botId);
        if (botBrick) {
          pSum += this.getTransitionProbability(candidatePartId, '-Y', botBrick.partId);
          count++;
        }
      }
      // +X
      const rightId = posToBrick.get(`${bx + bw},${bz},${by}`);
      if (rightId && rightId !== brick.id) {
        const rightBrick = brickMap.get(rightId);
        if (rightBrick) {
          pSum += this.getTransitionProbability(candidatePartId, '+X', rightBrick.partId);
          count++;
        }
      }
      // -X
      const leftId = posToBrick.get(`${bx - 1},${bz},${by}`);
      if (leftId && leftId !== brick.id) {
        const leftBrick = brickMap.get(leftId);
        if (leftBrick) {
          pSum += this.getTransitionProbability(candidatePartId, '-X', leftBrick.partId);
          count++;
        }
      }
      // +Z
      const frontId = posToBrick.get(`${bx},${bz + bd},${by}`);
      if (frontId && frontId !== brick.id) {
        const frontBrick = brickMap.get(frontId);
        if (frontBrick) {
          pSum += this.getTransitionProbability(candidatePartId, '+Z', frontBrick.partId);
          count++;
        }
      }
      // -Z
      const backId = posToBrick.get(`${bx},${bz - 1},${by}`);
      if (backId && backId !== brick.id) {
        const backBrick = brickMap.get(backId);
        if (backBrick) {
          pSum += this.getTransitionProbability(candidatePartId, '-Z', backBrick.partId);
          count++;
        }
      }

      return count > 0 ? pSum / count : 0.05;
    };

    // Active WFC Substitution Pass:
    // Replace discordant pieces (e.g. erroneous dome dishes, low-compatibility parts) with high-ranked category pieces
    for (const brick of bricks) {
      const isDomeOnSurface = brick.profile === 'dish';
      const currentProb = evalNeighborProb(brick, brick.partId);
      const isLowProb = currentProb < 0.06;
      const isNotCategory = !this.isCategoryPart(brick.partId);

      if (isDomeOnSurface || isLowProb || isNotCategory) {
        const isQuarterTurn = brick.rotation === 90 || brick.rotation === 270;
        const [wX, wZ, hY] = brick.baseSize || [
          isQuarterTurn ? brick.size[1] : brick.size[0],
          isQuarterTurn ? brick.size[0] : brick.size[1],
          brick.size[2]
        ];

        // Find alternative connectors with exact same canonical footprint
        const candidates: string[] = [];

        if (isDomeOnSurface) {
          // Replace erroneous dome dish with flat tile or curved slope
          if (wX === 2 && wZ === 2) {
            candidates.push('15068', '3068b', '3003', '3039');
          } else if (wX === 4 && wZ === 4) {
            candidates.push('88930', '3001', '87079', '2419');
          }
        }

        // Category-informed substitutions
        if (this.currentCategory === 'vehicles') {
          if (brick.profile === 'slope_45') candidates.push('88930', '15068', '11477', '85984');
          if (brick.profile === 'brick' && hY === 1) candidates.push('3068b', '3069b', '2431', '87079', '2412b');
        } else if (this.currentCategory === 'space') {
          if (brick.profile === 'slope_45') candidates.push('30382', '2419', '43712', '88930', '11477');
          if (brick.profile === 'slope_inverted') candidates.push('93273', '24201', '4854', '43713');
        } else if (this.currentCategory === 'architecture') {
          if (brick.profile === 'slope_curved') candidates.push('60477', '4286', '3298', '3040b');
          if (brick.profile === 'brick') candidates.push('87079', '4162', '3068b', '3001', '3004');
        }

        // Add standard dimension matches
        const matches = CONNECTOR_DATABASE.connectors;
        for (const [pid, conn] of matches) {
          if (conn.footprint[0] === wX && conn.footprint[1] === wZ && conn.footprint[2] === hY) {
            if (this.isCategoryPart(pid) && !candidates.includes(pid)) {
              candidates.push(pid);
              if (candidates.length >= 10) break;
            }
          }
        }

        let bestCandidate: string | null = null;
        let bestScore = currentProb + (isNotCategory ? 0.0 : 0.05);

        for (const cid of candidates) {
          const cConn = CONNECTOR_DATABASE.getConnector(cid);
          if (!cConn || cConn.profile === 'dish') continue;

          const candProb = evalNeighborProb(brick, cid);
          const candFreq = Math.min(1.0, this.getPartFrequency(cid) / 400.0);
          const score = candProb + candFreq * 0.15;

          if (score > bestScore + 0.04) {
            bestScore = score;
            bestCandidate = cid;
          }
        }

        if (bestCandidate && bestCandidate !== brick.partId) {
          const repl = CONNECTOR_DATABASE.getConnector(bestCandidate);
          if (repl) {
            brick.partId = repl.partId;
            brick.name = repl.name;
            brick.profile = repl.profile;
            brick.category = repl.category;

            const [startX, startZ, startY] = brick.gridPos;
            const ldrawX = (startX + brick.size[0] / 2.0) * LDU_STUD_PITCH;
            const ldrawZ = (startZ + brick.size[1] / 2.0) * LDU_STUD_PITCH;
            const ldrawY = -(startY + brick.size[2]) * LDU_BRICK_HEIGHT;
            brick.ldrawPos = [ldrawX, ldrawY, ldrawZ];

            transitionsApplied++;
          }
        }
      }
    }

    // Final evaluation score
    let totalScore = 0;
    let comparisons = 0;
    for (const b of bricks) {
      const p = evalNeighborProb(b, b.partId);
      totalScore += p;
      comparisons++;
    }

    const avgCompatibility = comparisons > 0 ? totalScore / comparisons : 1.0;

    return {
      totalRefined: bricks.length,
      compatibilityScore: parseFloat((avgCompatibility * 100).toFixed(1)),
      entropyLevels: [8, 4, 2, 1],
      transitionsApplied,
      category: this.currentCategory
    };
  }

  /**
   * Refines a specific isolated island component using WFC constraint propagation.
   */
  public refineIsland(islandId: number, bricks: PlacedBrick[], grid: VoxelGrid): WFCSolutionMetrics {
    const islandBricks = bricks.filter((b) => b.islandId === islandId);
    return this.refineModel(islandBricks, grid);
  }
}

export const WFC_REFINER = new WFCRefinerEngine();
