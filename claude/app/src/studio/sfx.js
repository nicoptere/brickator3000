// Sounds of the original app: the four lego_clack mp3 files (public/sounds). Decoded once, played with a little random pitch.
// Muted state is remembered.
const KEY = 'brickgen.studio.sound';
const FILES = [1, 2, 3, 4].map((n) => `./sounds/lego_clack_${n}.mp3`);
let gestured = false;
if (typeof window !== 'undefined') for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, () => { gestured = true; }, { capture: true, once: false, passive: true });
export class Sfx {
  constructor() { this.ctx = null; this.buf = []; this.loading = null; this.last = 0; this.k = 0; try { this.on = localStorage.getItem(KEY) !== 'off'; } catch { this.on = true; } }
  setOn(v) { this.on = v; try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch {} if (v) this.play(0, 1, 0.6); }
  _ctx() {
    if (!this.ctx && !gestured) return null;                     // browsers refuse to start audio before a click / key: stay silent until then
    if (!this.ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; this.ctx = new A(); }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.loading) this.loading = Promise.all(FILES.map(async (f, i) => { try { this.buf[i] = await this.ctx.decodeAudioData(await (await fetch(f)).arrayBuffer()); } catch (e) { console.warn('sound', f, e); } }));
    return this.ctx;
  }
  play(i = -1, rate = 1, vol = 0.8, delay = 0) {
    if (!this.on) return; const c = this._ctx(); if (!c) return;
    const b = this.buf[i >= 0 ? i : (this.k = (this.k + 1 + Math.floor(Math.random() * 3)) % FILES.length)] || this.buf.find(Boolean); if (!b) return;
    const s = c.createBufferSource(), g = c.createGain(); s.buffer = b; s.playbackRate.value = rate * (0.96 + Math.random() * 0.08); g.gain.value = vol;
    s.connect(g).connect(c.destination); s.start(c.currentTime + delay);
  }
  click() { this.play(-1, 1.25, 0.35); }
  /** a brick snapped on level `l` of `n`; rate limited so a fast scrub is not a buzz; pitch climbs a little with the height */
  place(l, n) { const now = performance.now(); if (now - this.last < 60) return; this.last = now; this.play(-1, 0.9 + (n ? l / n : 0) * 0.35, 0.8); }
  start() { this.play(0, 1.1, 0.7); }
  done() { [0, 1, 2, 3].forEach((i) => this.play(i, 0.95 + i * 0.12, 0.8, i * 0.11)); }
  error() { this.play(2, 0.55, 0.9); }
}
export const sfx = new Sfx();
