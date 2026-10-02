// Main-thread driver: a pool of workers scores the grid phases in parallel, the first worker finishes the best one.
const POOL = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
let workers = [];
const spawn = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

function call(w, msg, onProgress) {
  return new Promise((resolve, reject) => {
    w.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'progress') { onProgress && onProgress(d); return; }
      if (d.type === 'error') { reject(new Error(d.error)); return; }
      resolve(d);
    };
    w.onerror = (e) => reject(new Error(e.message || 'worker error'));
    w.postMessage(msg);
  });
}

export function cancel() { workers.forEach((w) => w.terminate()); workers = []; }

/** model = { tris: Float32Array, vcols: Float32Array (linear) } */
export async function runMethod(model, opts, { workersWanted = POOL, onStage = () => {} } = {}) {
  cancel();
  const n = Math.max(1, workersWanted);
  workers = Array.from({ length: n }, spawn);
  const key = Math.random().toString(36).slice(2);
  const t0 = performance.now();
  onStage('preparing (samples, symmetry, ray cast)', 0);
  const setups = await Promise.all(workers.map((w) => call(w, { type: 'setup', key, model, opts })));
  const jobs = setups[0].jobs;
  const usable = workers.slice(0, Math.min(n, jobs.length));
  let done = 0;
  onStage(`grid phases (${jobs.length} on ${usable.length} workers)`, 0);
  const parts = usable.map((w, k) => call(w, { type: 'score', key, jobs: jobs.filter((_, q) => q % usable.length === k) }, () => { done++; onStage(`grid phases (${jobs.length} on ${usable.length} workers)`, done / jobs.length); }));
  const scored = (await Promise.all(parts)).flatMap((r) => r.scores);
  scored.sort((a, b) => b.score - a.score);
  onStage('solving the best phase + post-process', 1);
  const res = await call(workers[0], { type: 'finish', key, job: scored[0].job });
  const r = res.result;
  r.timing.total = performance.now() - t0; r.timing.setup = setups[0].ms; r.scores = scored; r.workers = usable.length;
  workers.slice(1).forEach((w) => w.terminate()); workers = workers.slice(0, 1);
  return r;
}
export const poolSize = POOL;
