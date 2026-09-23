/**
 * measure.ts — Scene Metric Scale Estimator & Physical Scale Re-Ranker
 *
 * Infers the global physical LEGO stud scale (pixels per 8mm stud pitch) from the
 * most confident and dimensionally consistent piece detections in a scene.
 *
 * Uses this metric consensus to re-rank candidate predictions from BrickNet, penalizing
 * severe scale mismatches (such as a 2x4 or 4x8 piece being misclassified as a 1x1 stud)
 * and recovering the true physical part identity.
 */

import { DetectedRegion, AtlasIndexData, ClassesData, CandidateMatch } from './types';
import { getAssetUrl } from './url';

export interface PartDimension {
  m: number;          // Nominal short dimension in studs (e.g. 1)
  n: number;          // Nominal long dimension in studs (e.g. 2, 4)
  h?: number;         // Height in plate/brick units if known
  area: number;       // Nominal footprint area in studs^2 (m * n)
  aspectRatio: number;// n / m (>= 1.0)
  sourceName: string; // Name source used for dimension derivation
  isKnown: boolean;   // True if dimensions were explicitly parsed
}

export interface ScaleInferenceResult {
  scalePxPerStud: number; // Pixels per 8.0 mm LEGO stud pitch
  scalePxPerMm: number;   // Pixels per mm (scalePxPerStud / 8.0)
  confidence: number;     // Consensus confidence (0.0 - 1.0)
  sampleCount: number;    // Number of anchor piece dimensions used
  details: string;        // Human-readable summary
}

export class Measure {
  private dimensionsCache: Map<string, PartDimension> = new Map();
  private aliasMap: Map<string, string> = new Map();

  // Known catalog override mappings for parts without explicit "M x N" in name
  private static readonly KNOWN_PART_DIMENSIONS: Record<string, { m: number; n: number; h?: number }> = {
    '3001': { m: 2, n: 4, h: 3 }, // Brick 2 x 4
    '3002': { m: 2, n: 3, h: 3 }, // Brick 2 x 3
    '3003': { m: 2, n: 2, h: 3 }, // Brick 2 x 2
    '3004': { m: 1, n: 2, h: 3 }, // Brick 1 x 2
    '3005': { m: 1, n: 1, h: 3 }, // Brick 1 x 1
    '3010': { m: 1, n: 4, h: 3 }, // Brick 1 x 4
    '3020': { m: 2, n: 4, h: 1 }, // Plate 2 x 4
    '3021': { m: 2, n: 3, h: 1 }, // Plate 2 x 3
    '3022': { m: 2, n: 2, h: 1 }, // Plate 2 x 2
    '3023': { m: 1, n: 2, h: 1 }, // Plate 1 x 2
    '3023b': { m: 1, n: 2, h: 1 },// Plate 1 x 2
    '3024': { m: 1, n: 1, h: 1 }, // Plate 1 x 1
    '3040': { m: 1, n: 2, h: 3 }, // Slope 45 2 x 1
    '3040b': { m: 1, n: 2, h: 3 },
    '3068': { m: 2, n: 2, h: 1 }, // Tile 2 x 2
    '3068b': { m: 2, n: 2, h: 1 },
    '3069': { m: 1, n: 2, h: 1 }, // Tile 1 x 2
    '3069b': { m: 1, n: 2, h: 1 },
    '3070': { m: 1, n: 1, h: 1 }, // Tile 1 x 1
    '3070b': { m: 1, n: 1, h: 1 },
    '3622': { m: 1, n: 3, h: 3 }, // Brick 1 x 3
    '3623': { m: 1, n: 3, h: 1 }, // Plate 1 x 3
    '3660': { m: 2, n: 2, h: 3 }, // Slope 45 2 x 2 Inverted
    '3665': { m: 1, n: 2, h: 3 }, // Slope 45 2 x 1 Inverted
    '3700': { m: 1, n: 2, h: 3 }, // Technic Brick 1 x 2 with Hole
    '3710': { m: 1, n: 4, h: 1 }, // Plate 1 x 4
    '3795': { m: 2, n: 6, h: 1 }, // Plate 2 x 6
    '3832': { m: 2, n: 10, h: 1 },// Plate 2 x 10
    '3045': { m: 2, n: 2, h: 3 }, // Slope 45 2 x 2 Double Convex
    '3062': { m: 1, n: 1, h: 3 }, // Brick 1 x 1 Round
    '3062b': { m: 1, n: 1, h: 3 },
    '3673': { m: 1, n: 2 },        // Technic Pin
    '3704': { m: 1, n: 2 },        // Technic Axle 2
    '3705': { m: 1, n: 4 },        // Technic Axle 4
    '3706': { m: 1, n: 6 },        // Technic Axle 6
    '3707': { m: 1, n: 8 },        // Technic Axle 8
    '3708': { m: 1, n: 12 },       // Technic Axle 12
    '3713': { m: 1, n: 1 },        // Technic Bush
    '3749': { m: 1, n: 2 },        // Technic Axle Pin
    '4073': { m: 1, n: 1, h: 1 }, // Plate 1 x 1 Round
    '4150': { m: 2, n: 2, h: 1 }, // Tile 2 x 2 Round
    '6141': { m: 1, n: 1, h: 1 }, // Plate 1 x 1 Round
    '98138': { m: 1, n: 1, h: 1 },// Tile 1 x 1 Round
  };

  constructor(atlasData?: AtlasIndexData | null, classesData?: ClassesData | null) {
    if (atlasData) {
      this.initFromAtlas(atlasData);
    }
  }

  public initFromAtlas(atlasData: AtlasIndexData) {
    if (!atlasData || !atlasData.parts) return;

    for (const [canonicalId, part] of Object.entries(atlasData.parts)) {
      this.aliasMap.set(canonicalId.toLowerCase(), canonicalId);
      if (Array.isArray(part.aliases)) {
        for (const alias of part.aliases) {
          this.aliasMap.set(alias.toLowerCase(), canonicalId);
        }
      }
      this.getDimensions(canonicalId, part.name);
    }
  }

  /**
   * Retrieves or computes nominal physical stud dimensions for a part.
   */
  public getDimensions(partId: string, partName?: string): PartDimension {
    const normId = partId.toLowerCase().replace('.dat', '').replace('parts/', '').trim();
    const canonId = this.aliasMap.get(normId) || normId;

    if (this.dimensionsCache.has(canonId)) {
      return this.dimensionsCache.get(canonId)!;
    }

    // 1. Check known explicit override table
    if (Measure.KNOWN_PART_DIMENSIONS[normId] || Measure.KNOWN_PART_DIMENSIONS[canonId]) {
      const k = Measure.KNOWN_PART_DIMENSIONS[normId] || Measure.KNOWN_PART_DIMENSIONS[canonId];
      const dim: PartDimension = {
        m: Math.min(k.m, k.n),
        n: Math.max(k.m, k.n),
        h: k.h,
        area: k.m * k.n,
        aspectRatio: Math.max(k.m, k.n) / Math.min(k.m, k.n),
        sourceName: partName || canonId,
        isKnown: true
      };
      this.dimensionsCache.set(canonId, dim);
      return dim;
    }

    // 2. Parse from part name string (e.g. "Brick 2 x 4", "Plate 1 x 2")
    const nameToParse = partName || canonId;
    const match = nameToParse.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*x\s*(\d+(?:\.\d+)?))?/i);
    if (match) {
      const d1 = parseFloat(match[1]);
      const d2 = parseFloat(match[2]);
      const d3 = match[3] ? parseFloat(match[3]) : undefined;
      if (d1 > 0 && d2 > 0) {
        const shortSide = Math.min(d1, d2);
        const longSide = Math.max(d1, d2);
        const dim: PartDimension = {
          m: shortSide,
          n: longSide,
          h: d3,
          area: shortSide * longSide,
          aspectRatio: longSide / shortSide,
          sourceName: nameToParse,
          isKnown: true
        };
        this.dimensionsCache.set(canonId, dim);
        return dim;
      }
    }

    // 3. Parse Technic Axle / Bar / Beam lengths (e.g. "Axle 5L", "Axle 3", "Bar 4L")
    const lMatch = nameToParse.match(/(?:axle|bar|beam|link|shaft)\s*(\d+(?:\.\d+)?)\s*L?\b/i);
    if (lMatch) {
      const len = parseFloat(lMatch[1]);
      if (len >= 1) {
        const dim: PartDimension = {
          m: 1,
          n: len,
          area: len,
          aspectRatio: len,
          sourceName: nameToParse,
          isKnown: true
        };
        this.dimensionsCache.set(canonId, dim);
        return dim;
      }
    }

    // 3. Fallback for unmeasured shapes (assumed nominal 1x1)
    const fallbackDim: PartDimension = {
      m: 1,
      n: 1,
      area: 1,
      aspectRatio: 1.0,
      sourceName: nameToParse,
      isKnown: false
    };
    this.dimensionsCache.set(canonId, fallbackDim);
    return fallbackDim;
  }

  /**
   * Infers the picture-wide physical stud scale (px/stud) from confident detections.
   */
  public inferScale(regions: DetectedRegion[]): ScaleInferenceResult {
    if (regions.length === 0) {
      return {
        scalePxPerStud: 45.0,
        scalePxPerMm: 45.0 / 8.0,
        confidence: 0.0,
        sampleCount: 0,
        details: 'No pieces available to infer scale.'
      };
    }

    const scaleSamples: number[] = [];
    const validRegions = regions.filter(r => r.box.w > 12 && r.box.h > 12);

    // Filter to confident anchor candidates (confidence >= 0.50 or top 45%)
    let anchors = validRegions.filter(r => r.confidence >= 0.50);
    if (anchors.length < 3) {
      const sorted = [...validRegions].sort((a, b) => b.confidence - a.confidence);
      anchors = sorted.slice(0, Math.max(3, Math.ceil(sorted.length * 0.45)));
    }

    for (const r of anchors) {
      const dim = this.getDimensions(r.partId, r.partName);
      if (!dim.isKnown || dim.area <= 0) continue;

      const boxShort = Math.min(r.box.w, r.box.h);
      const boxLong = Math.max(r.box.w, r.box.h);
      const obsAR = boxLong / Math.max(1, boxShort);

      // Verify aspect ratio compatibility to reject heavily tilted/occluded pieces
      const arRatio = obsAR / dim.aspectRatio;
      if (arRatio > 2.0 || arRatio < 0.5) {
        continue;
      }

      // Sample scale estimates
      const sShort = boxShort / dim.m;
      const sLong = boxLong / dim.n;
      const sArea = Math.sqrt((boxShort * boxLong) / dim.area);

      if (sShort > 10 && sShort < 500) scaleSamples.push(sShort);
      if (sLong > 10 && sLong < 500) scaleSamples.push(sLong);
      if (sArea > 10 && sArea < 500) scaleSamples.push(sArea);
    }

    // Fallback: If not enough specific anchor parts, estimate from general bounding box sizes
    if (scaleSamples.length < 3) {
      for (const r of validRegions) {
        const boxShort = Math.min(r.box.w, r.box.h);
        // Standard brick width is roughly 2 studs in random piles
        const estScale = boxShort / 2.0;
        if (estScale >= 15 && estScale <= 400) {
          scaleSamples.push(estScale);
        }
      }
    }

    if (scaleSamples.length === 0) {
      return {
        scalePxPerStud: 45.0,
        scalePxPerMm: 45.0 / 8.0,
        confidence: 0.1,
        sampleCount: 0,
        details: 'Insufficient anchor data. Using fallback 45px/stud.'
      };
    }

    // Robust Median & MAD outlier rejection
    scaleSamples.sort((a, b) => a - b);
    const medianScale = scaleSamples[Math.floor(scaleSamples.length / 2)];
    const deviations = scaleSamples.map(s => Math.abs(s - medianScale));
    deviations.sort((a, b) => a - b);
    const mad = deviations[Math.floor(deviations.length / 2)] || 1.0;

    // Filter inliers within 2.5 * MAD
    const inliers = scaleSamples.filter(s => Math.abs(s - medianScale) <= Math.max(6.0, 2.5 * mad));
    const finalScale = inliers.reduce((sum, s) => sum + s, 0) / inliers.length;
    const finalScaleRounded = Math.round(finalScale * 10) / 10;
    const confidence = Math.min(0.98, Math.max(0.40, (inliers.length / (scaleSamples.length || 1)) * 0.95));

    return {
      scalePxPerStud: finalScaleRounded,
      scalePxPerMm: Math.round((finalScaleRounded / 8.0) * 100) / 100,
      confidence,
      sampleCount: inliers.length,
      details: `Inferred ${finalScaleRounded} px/stud (${(finalScaleRounded / 8.0).toFixed(2)} px/mm) across ${inliers.length} anchors.`
    };
  }

  /**
   * Re-ranks detected piece candidates based on physical scale compatibility.
   * Eliminates false positives where large objects are matched to tiny 1x1 or 2x1 bricks.
   */
  public reRankWithScale(
    regions: DetectedRegion[],
    targetScale?: number
  ): { regions: DetectedRegion[]; scale: ScaleInferenceResult; correctedCount: number; logs: string[] } {
    const scale = targetScale && targetScale > 5
      ? {
          scalePxPerStud: targetScale,
          scalePxPerMm: targetScale / 8.0,
          confidence: 0.9,
          sampleCount: regions.length,
          details: `Using target scale ${targetScale} px/stud.`
        }
      : this.inferScale(regions);

    const S = scale.scalePxPerStud;
    let correctedCount = 0;
    const logs: string[] = [];
    logs.push(`[Measure] Global scale: ${S} px/stud (${scale.scalePxPerMm} px/mm, conf ${(scale.confidence * 100).toFixed(0)}%).`);

    for (const r of regions) {
      const boxShort = Math.min(r.box.w, r.box.h);
      const boxLong = Math.max(r.box.w, r.box.h);
      const boxArea = r.box.w * r.box.h;

      // Calculate precise polygon area using Shoelace formula if polygon outline exists
      let effectiveArea = boxArea;
      if (r.polygon && r.polygon.length >= 3) {
        let polyArea = 0;
        for (let i = 0; i < r.polygon.length; i++) {
          const j = (i + 1) % r.polygon.length;
          polyArea += r.polygon[i].x * r.polygon[j].y;
          polyArea -= r.polygon[j].x * r.polygon[i].y;
        }
        polyArea = Math.abs(polyArea) / 2;
        if (polyArea > 10) {
          effectiveArea = polyArea;
        }
      }

      // Estimated physical size of this detected region in studs
      const obsM = Math.max(0.7, boxShort / S);
      const obsN = Math.max(0.7, boxLong / S);
      const obsArea = Math.max(0.6, effectiveArea / (S * S));

      r.estimatedStuds = {
        m: Math.round(obsM * 10) / 10,
        n: Math.round(obsN * 10) / 10,
        area: Math.round(obsArea * 10) / 10
      };

      if (!r.candidates || r.candidates.length <= 1) {
        continue;
      }

      const scoredCandidates = r.candidates.map(c => {
        const dim = this.getDimensions(c.partId, c.partName);
        const deltaArea = Math.log(obsArea / (dim.area || 1.0));
        const deltaLong = Math.log(obsN / (dim.n || 1.0));
        const deltaShort = Math.log(obsM / (dim.m || 1.0));

        // Symmetric Scale compatibility Gaussian penalty:
        // deltaArea > 0: large piece observed, candidate is tiny (e.g. large plate identified as 1x1)
        // deltaArea < 0: tiny piece observed, candidate is large (e.g. 1x1 stud identified as 2x4 brick)
        // Squared logarithmic terms symmetrically penalize deviations in both directions!
        const scalePenalty = Math.exp(
          - (deltaArea * deltaArea) / (2 * 0.38 * 0.38)
          - (deltaLong * deltaLong) / (2 * 0.35 * 0.35)
          - (deltaShort * deltaShort) / (2 * 0.35 * 0.35)
        );

        // Combined score: balance visual neural probability with physical scale consistency
        const combinedScore = Math.pow(c.prob, 0.40) * Math.pow(scalePenalty, 0.85);

        return {
          candidate: c,
          dim,
          scalePenalty,
          combinedScore
        };
      });

      // Sort by combined scale-adjusted score
      scoredCandidates.sort((a, b) => b.combinedScore - a.combinedScore);

      const bestMatch = scoredCandidates[0];
      const origPartId = r.partId;

      // If top candidate changed and the new candidate provides a better combined score
      if (bestMatch && bestMatch.candidate.partId !== origPartId) {
        const origScore = scoredCandidates.find(sc => sc.candidate.partId === origPartId);
        if (!origScore || bestMatch.combinedScore > origScore.combinedScore) {
          const oldName = r.partName;
          r.partId = bestMatch.candidate.partId;
          r.partName = bestMatch.candidate.partName;
          r.confidence = Math.min(0.99, Math.max(0.05, bestMatch.combinedScore * 1.5));
          r.classIdx = bestMatch.candidate.classIdx;
          r.aliases = bestMatch.candidate.aliases;
          r.thumbnailUrl = getAssetUrl(`thumbnails/${r.partId}.png`);

          correctedCount++;
          const logMsg = `Region #${r.id} (${r.box.w}x${r.box.h}px, est ~${r.estimatedStuds.m}x${r.estimatedStuds.n} studs): Corrected from "${oldName}" to "${r.partName}" (#${r.partId}).`;
          logs.push(logMsg);
          console.log(`✓ [Measure Scale Re-Rank] ${logMsg}`);
        }
      } else if (bestMatch) {
        // If candidate did NOT change, but the piece has a severe scale mismatch with its current label:
        // Symmetrically penalize its confidence so large-as-tiny or tiny-as-large false positives drop out
        if (bestMatch.scalePenalty < 0.65) {
          const oldConf = r.confidence;
          r.confidence = Math.max(0.02, r.confidence * Math.pow(bestMatch.scalePenalty, 1.2));
          console.log(`✓ [Measure Scale Penalty] Region #${r.id} (${r.partName}): scale penalty ${(bestMatch.scalePenalty * 100).toFixed(1)}%, confidence decayed from ${(oldConf*100).toFixed(0)}% -> ${(r.confidence*100).toFixed(0)}%`);
        }
      }
    }

    logs.push(`[Measure] Re-ranking complete: evaluated ${regions.length} pieces, corrected ${correctedCount} scale mismatches.`);
    return { regions, scale, correctedCount, logs };
  }
}
