// Web Worker: runs the brickgen method off the main thread. One worker can score grid phases or finish the best one.
import { setup, scoreJob, finishJob, autoStuds } from './brickgen/pipeline.js';

let ctx = null, ctxKey = null;

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
    } else if (msg.type === 'finish') {
      if (ctxKey !== msg.key) throw new Error('worker context is stale');
      const logs = [];
      // the finish is the long stage: report what it is doing (pipeline.finishJob -> solver phases, then the post passes)
      const r = finishJob(ctx, msg.job, undefined, (s) => logs.push(s), (label, f) => self.postMessage({ type: 'progress', stage: label, frac: f }));
      r.logs = logs; r.job = msg.job; r.options = ctx.o;
      self.postMessage({ type: 'result', result: r }, [r.srcTris.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err && err.stack || err) });
  }
};
