/**
 * High-Performance Client-Side Multiset Matcher for LEGO Remix System
 * 
 * Matches detected pieces against a curated catalog of ~1,500 official LEGO micro-builds (8-75 pieces)
 * entirely within the browser in <2ms.
 */

import { getAssetUrl } from './url';

export interface RemixSet {
  id: string;
  name: string;
  year: number;
  theme: string;
  np: number;
  img: string;
  parts: Record<string, number>;
}

export interface RemixCatalog {
  version: string;
  total_sets: number;
  aliases: Record<string, string>;
  sets: RemixSet[];
}

export interface MissingPartInfo {
  partId: string;
  needed: number;
  have: number;
  missing: number;
}

export interface RemixMatch {
  set: RemixSet;
  matched_pieces: number;
  total_pieces: number;
  match_pct: number;
  missing_count: number;
  missing_parts: MissingPartInfo[];
  is_exact: boolean;
}

export interface RemixMatchResult {
  total_detected_pieces: number;
  exact_matches: RemixMatch[];
  near_matches: RemixMatch[];     // >= 70% or missing <= 3 pieces
  partial_matches: RemixMatch[];  // < 70% and >= minMatchPct
  all_matches: RemixMatch[];
}

export interface MatchOptions {
  minConfidence?: number;
  minMatchPct?: number;
  maxResults?: number;
}

let cachedCatalog: RemixCatalog | null = null;
let catalogPromise: Promise<RemixCatalog> | null = null;

/**
 * Loads and caches the curated Remix micro-build catalog from public/data/remix_builds.json
 */
export async function loadRemixCatalog(): Promise<RemixCatalog> {
  if (cachedCatalog) {
    return cachedCatalog;
  }
  if (!catalogPromise) {
    catalogPromise = fetch(getAssetUrl('data/remix_builds.json'))
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load remix catalog: ${res.status} ${res.statusText}`);
        }
        const data: RemixCatalog = await res.json();
        cachedCatalog = data;
        return data;
      })
      .catch((err) => {
        catalogPromise = null;
        throw err;
      });
  }
  return catalogPromise;
}

/**
 * Performs instantaneous multiset matching of detected regions against the catalog.
 */
export function matchDetectedInventory(
  regions: Array<{ partId: string; confidence?: number }>,
  catalog: RemixCatalog,
  options: MatchOptions = {}
): RemixMatchResult {
  const minConfidence = options.minConfidence ?? 0.20;
  const minMatchPct = options.minMatchPct ?? 30.0;
  const maxResults = options.maxResults ?? 5000;

  // 1. Build canonical detected multiset
  const inventory: Record<string, number> = {};
  let totalDetectedPieces = 0;

  for (const r of regions) {
    if (r.confidence !== undefined && r.confidence < minConfidence) {
      continue;
    }
    const rawId = (r.partId || '').trim().toLowerCase().replace('.dat', '').replace('parts/', '');
    if (!rawId) continue;

    const canonId = catalog.aliases[rawId] || rawId;
    inventory[canonId] = (inventory[canonId] || 0) + 1;
    totalDetectedPieces += 1;
  }

  if (totalDetectedPieces === 0) {
    return {
      total_detected_pieces: 0,
      exact_matches: [],
      near_matches: [],
      partial_matches: [],
      all_matches: []
    };
  }

  // 2. Multiset intersection against each catalog set
  const exactMatches: RemixMatch[] = [];
  const nearMatches: RemixMatch[] = [];
  const partialMatches: RemixMatch[] = [];

  for (let i = 0; i < catalog.sets.length; i++) {
    const set = catalog.sets[i];
    const totalRequired = set.np;
    if (totalRequired <= 0) continue;

    let matchedCount = 0;
    const missingParts: MissingPartInfo[] = [];

    const partEntries = Object.entries(set.parts);
    for (let j = 0; j < partEntries.length; j++) {
      const [pId, needed] = partEntries[j];
      const have = inventory[pId] || 0;

      if (have >= needed) {
        matchedCount += needed;
      } else {
        matchedCount += have;
        missingParts.push({
          partId: pId,
          needed,
          have,
          missing: needed - have
        });
      }
    }

    const matchPct = (matchedCount / totalRequired) * 100;
    if (matchPct < minMatchPct) {
      continue;
    }

    const missingCount = totalRequired - matchedCount;
    const isExact = missingCount === 0;

    const matchItem: RemixMatch = {
      set,
      matched_pieces: matchedCount,
      total_pieces: totalRequired,
      match_pct: Math.round(matchPct * 10) / 10,
      missing_count: missingCount,
      missing_parts: missingParts,
      is_exact: isExact
    };

    if (isExact) {
      exactMatches.push(matchItem);
    } else if (matchPct >= 70.0 || missingCount <= 3) {
      nearMatches.push(matchItem);
    } else {
      partialMatches.push(matchItem);
    }
  }

  // 3. Sort:
  // Exact: largest builds first (most rewarding), then newest
  exactMatches.sort((a, b) => b.total_pieces - a.total_pieces || b.set.year - a.set.year);

  // Near matches: highest match % first, then most pieces matched
  nearMatches.sort((a, b) => b.match_pct - a.match_pct || b.matched_pieces - a.matched_pieces);

  // Partial matches: match % descending
  partialMatches.sort((a, b) => b.match_pct - a.match_pct || b.matched_pieces - a.matched_pieces);

  const allMatches = [...exactMatches, ...nearMatches, ...partialMatches].slice(0, maxResults);

  return {
    total_detected_pieces: totalDetectedPieces,
    exact_matches: exactMatches,
    near_matches: nearMatches,
    partial_matches: partialMatches,
    all_matches: allMatches
  };
}

/**
 * Returns all catalog sets as baseline RemixMatch items for catalog exploration
 */
export function getAllCatalogBuilds(catalog: RemixCatalog): RemixMatch[] {
  return catalog.sets.map(set => ({
    set,
    matched_pieces: 0,
    total_pieces: set.np,
    match_pct: 0,
    missing_count: set.np,
    missing_parts: Object.entries(set.parts).map(([partId, needed]) => ({
      partId,
      needed,
      have: 0,
      missing: needed
    })),
    is_exact: false
  }));
}

