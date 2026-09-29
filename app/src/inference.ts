import * as ort from 'onnxruntime-web/webgl';
import { ClassesData, AtlasIndexData, DetectedRegion, CandidateMatch } from './types';
import { PatchCandidate } from './segmenter';
import { getAssetUrl } from './url';
import { loadModelBuffer, evictModelCache } from './model_loader';

export class InferenceEngine {
  private session: ort.InferenceSession | null = null;
  private classesData: ClassesData | null = null;
  private atlasData: AtlasIndexData | null = null;
  private aliasMap: Map<string, string> = new Map();
  private isLoaded: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    // WebGL acceleration - runs on GPU without exhausting WebAssembly heap
  }

  public hasLocalModel(): boolean {
    return this.session !== null;
  }

  public isUsingServerEngine(): boolean {
    return false;
  }

  public async init(onProgress?: (status: string) => void): Promise<void> {
    if (this.isLoaded && this.session) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        if (onProgress) onProgress('Loading taxonomy & atlas index...');
        const [classRes, atlasRes] = await Promise.all([
          fetch(getAssetUrl('data/classes.json')),
          fetch(getAssetUrl('data/atlas_index.json'))
        ]);

        this.classesData = await classRes.json();
        this.atlasData = await atlasRes.json();

        // Build reverse alias map for canonical ID resolution
        if (this.atlasData && this.atlasData.parts) {
          for (const [canonicalId, part] of Object.entries(this.atlasData.parts)) {
            this.aliasMap.set(canonicalId.toLowerCase(), canonicalId);
            if (Array.isArray(part.aliases)) {
              for (const alias of part.aliases) {
                this.aliasMap.set(alias.toLowerCase(), canonicalId);
              }
            }
          }
        }

        const modelUrl = getAssetUrl('models/bricknet_v6_decomposed.onnx?v=20260921_v6_decomposed');
        if (onProgress) onProgress('Loading BrickNet model weights (V6 Multi-Scale)...');
        const buffer = await loadModelBuffer(modelUrl, onProgress);

        if (onProgress) onProgress('Compiling WebGL BrickNet shaders...');
        try {
          // Attempt high-performance WebGL acceleration
          this.session = await ort.InferenceSession.create(new Uint8Array(buffer), {
            executionProviders: ['webgl'],
            graphOptimizationLevel: 'all'
          });
          if (onProgress) onProgress('BrickNet WebGL Ready');
          console.log('✓ In-browser BrickNet V6 WebGL session initialized successfully.');
          this.isLoaded = true;
        } catch (webglErr: any) {
          console.warn('In-browser BrickNet WebGL compilation failed, attempting WASM fallback:', webglErr);
          try {
            this.session = await ort.InferenceSession.create(new Uint8Array(buffer), {
              executionProviders: ['wasm'],
              graphOptimizationLevel: 'all'
            });
            if (onProgress) onProgress('BrickNet WASM Ready');
            console.log('✓ In-browser BrickNet V6 WASM session initialized successfully.');
            this.isLoaded = true;
          } catch (wasmErr: any) {
            console.error('All BrickNet execution providers failed:', wasmErr);
            await evictModelCache(modelUrl);
            this.session = null;
            this.isLoaded = false;
            if (onProgress) onProgress('Model Loading Error');
          }
        }
      } catch (err: any) {
        console.error('Failed to load taxonomy/atlas index:', err);
        throw new Error(`Taxonomy initialization failed: ${err.message}`);
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  public getAtlasData(): AtlasIndexData | null {
    return this.atlasData;
  }

  public getClassesData(): ClassesData | null {
    return this.classesData;
  }

  /**
   * Warms up BrickNet on GPU by executing a single dummy inference pass.
   * Compiles WebGL shaders and caches pipelines in GPU memory.
   */
  public async warmup(): Promise<void> {
    if (!this.session) return;
    try {
      const dummyData = new Float32Array(1 * 3 * 224 * 224);
      const inputTensor = new ort.Tensor('float32', dummyData, [1, 3, 224, 224]);
      const inputName = this.session.inputNames[0] || 'input';
      const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
      const output = await this.session.run(feeds);
      const outName = this.session.outputNames[0] || Object.keys(output)[0];
      const tensor = output[outName];
      if (tensor && (tensor as any).getData) {
        await (tensor as any).getData();
      }
      console.log('✓ BrickNet V6 GPU shaders compiled and warmed.');
    } catch (err) {
      console.warn('BrickNet warmup warning:', err);
    }
  }

  /**
   * Runs batched in-browser inference across segmented candidate patches (batch size 8)
   */
  public async runInferenceOnPatches(
    candidates: PatchCandidate[],
    onPatchStart: (index: number, total: number, candidate: PatchCandidate) => void,
    onPatchComplete?: (index: number, total: number, region: DetectedRegion) => void
  ): Promise<DetectedRegion[]> {
    const detectedRegions: DetectedRegion[] = [];
    const batchSize = 1;

    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      for (let b = 0; b < batch.length; b++) {
        onPatchStart(i + b, candidates.length, batch[b]);
      }

      const batchRegions = await this.classifyBatch(i, batch);

      for (let b = 0; b < batchRegions.length; b++) {
        detectedRegions.push(batchRegions[b]);
        if (onPatchComplete) {
          onPatchComplete(i + b, candidates.length, batchRegions[b]);
        }
      }

      // Non-blocking micro-yield to keep animations and browser UI 60fps responsive
      await new Promise(r => setTimeout(r, 0));
    }

    return detectedRegions;
  }

  /**
   * High-throughput batched classification using in-browser BrickNet V5 FP32 model
   */
  private async classifyBatch(startIndex: number, candidates: PatchCandidate[]): Promise<DetectedRegion[]> {
    const B = candidates.length;
    if (B === 0) return [];

    if (!this.session || !this.classesData) {
      return candidates.map((cand, idx) => ({
        id: startIndex + idx,
        box: cand.box,
        normBox: cand.normBox,
        partId: 'unknown',
        partName: 'Unknown Part',
        confidence: 0.1,
        classIdx: 0,
        aliases: [],
        thumbnailUrl: cand.patchCanvas.toDataURL(),
        polygon: cand.polygon
      }));
    }

    try {
      const pSize = 3 * 224 * 224;
      const batchTensorData = new Float32Array(B * pSize);
      for (let b = 0; b < B; b++) {
        batchTensorData.set(candidates[b].tensorData, b * pSize);
      }

      const inputTensor = new ort.Tensor('float32', batchTensorData, [B, 3, 224, 224]);
      const inputName = this.session.inputNames[0] || 'input';
      const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
      const output = await this.session.run(feeds);
      const outputName = this.session.outputNames[0] || Object.keys(output)[0];
      const outTensor = output[outputName];
      const allLogits = (outTensor.getData ? await outTensor.getData() : outTensor.data) as Float32Array;
      const numClasses = this.classesData.classes.length || Math.round(allLogits.length / B);

      const regions: DetectedRegion[] = [];

      for (let b = 0; b < B; b++) {
        const cand = candidates[b];
        const logits = allLogits.subarray(b * numClasses, (b + 1) * numClasses);

        let maxLogit = -Infinity;
        for (let j = 0; j < numClasses; j++) {
          if (logits[j] > maxLogit) maxLogit = logits[j];
        }

        let sumExp = 0;
        for (let j = 0; j < numClasses; j++) {
          sumExp += Math.exp(logits[j] - maxLogit);
        }

        const scoredIndices: Array<{ idx: number; prob: number; logit: number }> = [];
        for (let j = 0; j < numClasses; j++) {
          const prob = Math.exp(logits[j] - maxLogit) / sumExp;
          scoredIndices.push({ idx: j, prob, logit: logits[j] });
        }
        scoredIndices.sort((a, b) => b.prob - a.prob);

        const topCandidates: CandidateMatch[] = scoredIndices.slice(0, 100).map(item => {
          const cItem = this.classesData!.classes[item.idx] || { idx: item.idx, id: 'unknown', name: 'Unknown', ldraw: '' };
          const canonId = this.aliasMap.get(cItem.id.toLowerCase()) || cItem.id;
          const aPart = this.atlasData?.parts[canonId] || this.atlasData?.parts[cItem.id];
          return {
            classIdx: item.idx,
            partId: canonId,
            partName: aPart?.name || cItem.name,
            prob: item.prob,
            logit: item.logit,
            aliases: aPart?.aliases || []
          };
        });

        const best = topCandidates[0] || {
          classIdx: 0,
          partId: 'unknown',
          partName: 'Unknown Part',
          prob: 0.1,
          logit: 0,
          aliases: []
        };

        const canonicalId = best.partId;
        const atlasPart = this.atlasData?.parts[canonicalId];
        const thumbnailUrl = atlasPart ? getAssetUrl(`thumbnails/${canonicalId}.png`) : cand.patchCanvas.toDataURL();

        regions.push({
          id: startIndex + b,
          box: cand.box,
          normBox: cand.normBox,
          partId: canonicalId,
          partName: best.partName,
          confidence: best.prob,
          classIdx: best.classIdx,
          aliases: best.aliases,
          thumbnailUrl,
          polygon: cand.polygon,
          candidates: topCandidates
        });
      }

      return regions;
    } catch (err) {
      console.warn(`Error running in-browser batch inference:`, err);
      return candidates.map((cand, idx) => ({
        id: startIndex + idx,
        box: cand.box,
        normBox: cand.normBox,
        partId: 'unknown',
        partName: 'Classification Error',
        confidence: 0.0,
        classIdx: 0,
        aliases: [],
        thumbnailUrl: cand.patchCanvas.toDataURL(),
        polygon: cand.polygon
      }));
    }
  }

  public getPartInfo(partId: string): { name: string; thumbnailUrl?: string } {
    const canonId = this.aliasMap.get(partId.toLowerCase()) || partId;
    const atlasPart = this.atlasData?.parts[canonId] || this.atlasData?.parts[partId];
    const cItem = this.classesData?.classes.find(
      c => c.id.toLowerCase() === canonId.toLowerCase() || c.id.toLowerCase() === partId.toLowerCase()
    );
    const name = atlasPart?.name || cItem?.name || `Part #${partId}`;
    const thumbnailUrl = atlasPart ? getAssetUrl(`thumbnails/${canonId}.png`) : undefined;
    return { name, thumbnailUrl };
  }
}

