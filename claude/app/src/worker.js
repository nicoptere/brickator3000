// Web Worker: runs the brickgen method off the main thread. One worker can score grid phases or finish the best one.
import { setup, scoreJob, finishJob, autoStuds, regionAttempts } from './brickgen/pipeline.js';

let ctx = null, ctxKey = null;
// The solver reports thousands of times inside a long phase. Posting every one of them floods the UI thread with React
// updates for no extra information, so they are thinned to a change worth drawing.
const throttled = () => { let last = '', lf = -1, lt = 0;
  return (stage, frac) => { const now = Date.now();
    if (stage === last && Math.abs((frac ?? 0) - lf) < 0.005 && now - lt < 60) return;
    last = stage; lf = frac ?? 0; lt = now; self.postMessage({ type: 'progress', stage, frac }); }; };

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'auto') {                      // studs: 'auto' - the resolution choice (pipeline.autoStuds), once, before the setups
      self.postMessage({ type: 'auto', key: msg.key, choice: autoStuds(msg.model, msg.opts) });
    } else if (msg.type === 'setup') {
      const t = performance.now();
      ctx = setup(msg.model, msg.opts); ctxKey = msg.key;
      self.postMessage({ type: 'setup', key: msg.key, jobs: ctx.jobs, symmetry: ctx.sym, symOk: ctx.symOk, ms: performance.now() - t, T: ctx.T });
    } else if (msg.type === 'score') {
      if (ctxKey !== msg.key) throw new Error('worker context is stale');
      const scores = [];
      for (const job of msg.jobs) { scores.push({ job, score: scoreJob(ctx, job) }); self.postMessage({ type: 'progress', done: 1 }); }
      self.postMessage({ type: 'scores', scores });
    } else if (msg.type === 'region') {
      // rebuild one box of the finished model several ways (pipeline.regionAttempts). The context of the original run is still
      // here, so the field, the grid phase and the catalogue are the same ones the model was built with.
      if (ctxKey !== msg.key) throw new Error('worker context is stale');
      const a = regionAttempts(ctx, msg.job, msg.box, msg.prev, undefined,
        { progress: throttled() });
      for (const x of a.attempts) if (x.result) { delete x.result.srcTris; delete x.result.srcCols; }   // the caller already has the source mesh
      self.postMessage({ type: 'region', ...a });
    } else if (msg.type === 'finish') {
      if (ctxKey !== msg.key) throw new Error('worker context is stale');
      const logs = [];
      // the finish is the long stage: report what it is doing (pipeline.finishJob -> solver phases, then the post passes)
      const r = finishJob(ctx, msg.job, undefined, (s) => logs.push(s), throttled());
      r.logs = logs; r.job = msg.job; r.options = ctx.o;
      self.postMessage({ type: 'result', result: r }, [r.srcTris.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err && err.stack || err) });
  }
};
