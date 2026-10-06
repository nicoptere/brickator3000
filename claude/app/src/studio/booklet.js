// Shooting the build booklet from a StudioViewport (brickgen/instructions.js does the planning and the page).
// Shared by StudioApp's "instructions" export and test/booklet_shoot.mjs, so what the test checks is what the button does.
import * as THREE from 'three';
import { planSteps, stepParts, billOfMaterials, bookletHTML } from '../brickgen/instructions.js';
import { createPathTrace } from './pathtrace.js';

/**
 * The cover picture: the finished model path-traced in perspective on a transparent background (no floor, no backdrop - the
 * PNG keeps its alpha and the page supplies the colour), framed as tightly as the projection allows. `azimuth` degrees off the
 * front, `elevation` degrees above the ground, `fov` the lens, `margin` how much air is left around the model. Returns one PNG
 * per entry of `views` ([{ az, el }]), which defaults to a single three-quarter view.
 */
export async function shootCover(vpc, cat, { spp = 256, azimuth = 30, elevation = 22, fov = 32, outHeight = 1600, margin = 1.01, onProgress = null, views = null } = {}) {
  vpc.lego.updateMatrixWorld(true);
  const box = new THREE.Box3(vpc.lego.localToWorld(new THREE.Vector3(0, 0, 0)), vpc.lego.localToWorld(new THREE.Vector3(vpc.W, vpc.H, vpc.D)));
  const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
  const dist = r / Math.sin(fov * Math.PI / 360) * 1.0;                     // as close as the bounding sphere allows: little air around the model
  const out = [], list = views || [{ az: azimuth }];
  for (const v of list) {
    const a = v.az * Math.PI / 180, e = (v.el ?? elevation) * Math.PI / 180;
    const cam = new THREE.PerspectiveCamera(fov, 1, dist / 100, dist * 10);
    cam.position.set(c.x + Math.sin(a) * Math.cos(e) * dist, c.y + Math.sin(e) * dist, c.z + Math.cos(a) * Math.cos(e) * dist);
    cam.lookAt(c); cam.updateMatrixWorld(true);
    const job = await createPathTrace(vpc, { pieces: vpc.pieces, cat, colorMode: 'piece', dark: false, spp, camera: cam, transparent: true, floor: false, outHeight, margin });
    try {
      await job.run((n, total) => onProgress && onProgress((out.length + n / total) / list.length));
      out.push(job.url());
    } finally { job.dispose(); }
  }
  return out;
}

/**
 * The finished-model page's pictures: the viewport's own toon render from a couple of three-quarter angles, framed on the
 * model. No path tracer - this page is a reminder of what was built, not the cover, and a render takes milliseconds.
 */
export function shootQuickViews(vpc, { azimuths = [-32, 32], elevation = 20, maxW = 1300, pad = 0.015, bg = '#ffffff', fov = 32 } = {}) {
  vpc.lego.updateMatrixWorld(true);
  // the real world box of what is drawn (the group may be turned or offset), so nothing is cropped
  const box = new THREE.Box3().setFromObject(vpc.lego);
  const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
  const cam = vpc.camera, pos0 = cam.position.clone(), tgt0 = vpc.controls.target.clone(), fov0 = cam.fov;
  const dist = r / Math.sin(fov * Math.PI / 360) * 1.02;
  const out = [];
  try {
    cam.fov = fov;
    for (const az of azimuths) {
      const a = az * Math.PI / 180, e = elevation * Math.PI / 180;
      cam.position.set(c.x + Math.sin(a) * Math.cos(e) * dist, c.y + Math.sin(e) * dist, c.z + Math.cos(a) * Math.cos(e) * dist);
      vpc.controls.target.copy(c); cam.lookAt(c); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      out.push(vpc.capture(maxW, { quality: 0.92, rect: tightRect(vpc, box, pad), bg, floor: false }));
    }
  } finally {
    cam.fov = fov0; cam.position.copy(pos0); vpc.controls.target.copy(tgt0); cam.updateProjectionMatrix(); vpc.controls.update();
  }
  return out;
}

/**
 * the canvas rectangle the model's box projects into, plus a hair of padding - `viewport.modelRect` grows it to a given aspect
 * ratio, which leaves a tall model swimming in white. Keeping the model's own aspect is what "as few margins as possible" means.
 */
function tightRect(vpc, box, pad = 0.015) {
  const dom = vpc.renderer.domElement, W = dom.width, H = dom.height, v = new THREE.Vector3();
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const X of [box.min.x, box.max.x]) for (const Y of [box.min.y, box.max.y]) for (const Z of [box.min.z, box.max.z]) {
    v.set(X, Y, Z).project(vpc.camera);
    const px = (v.x * 0.5 + 0.5) * W, py = (-v.y * 0.5 + 0.5) * H;
    if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
  }
  const w = (x1 - x0) * (1 + 2 * pad), h = (y1 - y0) * (1 + 2 * pad);
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
}

/** width / height of a PNG or JPEG data URI, read from its header - the cover page is portrait when its picture is */
export function imageSize(dataUrl) {
  try {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1), bin = atob(b64.slice(0, 2048));
    if (bin.charCodeAt(0) === 0x89) {                                        // PNG: IHDR width / height at bytes 16..24
      const u = (o) => (bin.charCodeAt(o) << 24 | bin.charCodeAt(o + 1) << 16 | bin.charCodeAt(o + 2) << 8 | bin.charCodeAt(o + 3)) >>> 0;
      return { w: u(16), h: u(20) };
    }
    for (let i = 2; i + 9 < bin.length;) {                                   // JPEG: the first SOFn segment
      if (bin.charCodeAt(i) !== 0xff) { i++; continue; }
      const m = bin.charCodeAt(i + 1), len = (bin.charCodeAt(i + 2) << 8) | bin.charCodeAt(i + 3);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (bin.charCodeAt(i + 5) << 8) | bin.charCodeAt(i + 6), w: (bin.charCodeAt(i + 7) << 8) | bin.charCodeAt(i + 8) };
      i += 2 + len;
    }
  } catch { /* a data URI we cannot read: the page stays landscape */ }
  return null;
}

/**
 * identity of everything a booklet is made of: the piece list (what, where, what colour) and the settings that shape the pages
 * or the pictures. Two exports with the same signature produce the same file, so the second one is handed back from the cache
 * instead of re-shooting sixty captures and three path-traced views.
 */
function bookletSig(P, o) {
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  const mix = (x) => { h1 = Math.imul(h1 ^ x, 0x01000193); h2 = Math.imul(h2 + x, 0x85ebca6b) ^ (h2 >>> 13); };
  for (let k = 0; k < P.length; k++) {
    const p = P[k];
    for (let q = 0; q < p.id.length; q++) mix(p.id.charCodeAt(q));
    mix((p.i * 10) | 0); mix((p.j * 10) | 0); mix((p.b * 2) | 0); mix(((p.ori ?? 0) << 10) + ((p.rot || 0) / 90 | 0));
    const c = p.rgb || [0, 0, 0]; mix((c[0] << 16) | (c[1] << 8) | c[2]);
  }
  return `${P.length}|${h1 >>> 0}|${h2 >>> 0}|${JSON.stringify(o)}`;
}
let lastBooklet = null;                                   // { sig, out } - the previous export, reused while nothing changed

/**
 * Plan the steps on the viewport's own piece list (setLego sorted it by level, so that order is already the build order),
 * shoot the cover (path-traced, two views - or, when the path tracer is not available, the toon viewport from the user's
 * view) and every step as an isometric orthographic picture framed on the pieces it adds - the new pieces in their own
 * colours, everything already built in grey - and lay the booklet out. The viewport is left in the state the caller gave it
 * except for colours / visibility (the caller restores those: it knows its own view state).
 *   opts: the run's options (stepTarget / stepLevels / stepMin / stepMax are read) ; meta: { pieces, levels, studs, weld }
 *   cover: { spp } or false for the quick toon cover
 * The last page of the build is the finished model, large: a third path-traced view from a nearer-front angle, so it is not
 * the same picture as the cover's (`hero: false` skips it and the page falls back to a cover view).
 * The result is cached: calling it again with the same pieces and the same settings returns the same file (`cached: true`)
 * without shooting anything.
 */
export async function shootBooklet(vpc, cat, { title = 'model', opts = {}, meta = {}, onProgress = null, onStage = null, cover: coverOpt = {},
  dimRGB = [160, 160, 160], dimInkRGB = [112, 112, 112], inkRGB = [16, 19, 26], ar = 1.75, maxW = 900 } = {}) {
  const P = vpc.pieces, by = {}; for (const c of cat) by[c.id] = c;
  // nothing to redo when neither the model nor the settings moved: shooting a booklet is a minute of captures and path traces
  const sig = bookletSig(P, { title, cover: coverOpt, meta, dimRGB, dimInkRGB, inkRGB, ar, maxW,
    step: [opts.stepTarget, opts.stepLevels, opts.stepMin, opts.stepMax] });
  if (lastBooklet && lastBooklet.sig === sig) { onStage && onStage('The booklet is already up to date'); return { ...lastBooklet.out, cached: true }; }
  const { steps } = planSteps(P, opts);
  vpc.setTheme(false); vpc.setMode('lego'); vpc.setOutline(true); vpc.paused = true;
  vpc.setAllStuds(true);                                                       // a plate must show its studs even in the steps before something covers them
  const all = new Uint8Array(P.length).fill(1);
  vpc.showStep(all, null);
  // the cover: ONE path-traced view of the finished model, framed as tightly as the lens allows; the last page gets two quick
  // toon views instead (a reminder of what was built - it does not need a second long render)
  let cover = null;
  if (coverOpt !== false) {
    try { onStage && onStage('Rendering the cover'); cover = (await shootCover(vpc, cat, { ...coverOpt, onProgress }))[0]; }
    catch (e) { console.warn('path-traced cover failed, using the viewport:', e); }
  }
  if (!cover) cover = shootQuickViews(vpc, { azimuths: [26], maxW: 1500, bg: '#f3f0d6' })[0];      // no path tracer: the viewport's own render
  const size = imageSize(cover), coverPortrait = !!(size && size.h > size.w * 1.02);
  const finals = shootQuickViews(vpc);
  onStage && onStage('Drawing the steps');
  const shown = new Uint8Array(P.length), hot = new Uint8Array(P.length), images = [];
  const minSpan = Math.max(8, 0.55 * Math.max(vpc.W, vpc.D) / 20);             // W / D are LDU, 20 per stud: a 3-piece step keeps half the model in frame
  for (let k = 0; k < steps.length; k++) {
    hot.fill(0); for (const n of steps[k].idx) { shown[n] = 1; hot[n] = 1; }
    vpc.showStep(shown, hot, { dimRGB, dimInkRGB, inkRGB });                 // new pieces: own colour, black line; built: grey, grey line
    images.push(vpc.captureIso(vpc.piecesBox(steps[k].idx), { ar, maxW, margin: 0.75, pad: 0.04, minSpan }));
    if (onProgress && k % 4 === 0) { onProgress(k / steps.length); await new Promise((r) => setTimeout(r)); }
  }
  const withParts = steps.map((s) => ({ ...s, parts: stepParts(P, s.idx, by) }));
  const html = bookletHTML({ title, cover, coverPortrait, finals, steps: withParts, images, bom: billOfMaterials(P, by),
    meta: { pieces: P.length, levels: Math.max(...P.map((p) => p.b + p.h)), ...meta } });
  vpc.setAllStuds(false); vpc.setInkPerPiece(false);
  const out = { html, steps: steps.length, pages: Math.ceil(steps.length / 4) + 3 };
  lastBooklet = { sig, out };
  return { ...out, cached: false };
}
