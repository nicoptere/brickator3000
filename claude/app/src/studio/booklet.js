// Shooting the build booklet from a StudioViewport (brickgen/instructions.js does the planning and the page).
// Shared by StudioApp's "instructions" export and test/booklet_shoot.mjs, so what the test checks is what the button does.
import * as THREE from 'three';
import { planSteps, stepParts, billOfMaterials, bookletHTML } from '../brickgen/instructions.js';
import { createPathTrace } from './pathtrace.js';

/**
 * The cover pictures: the finished model path-traced in perspective from two three-quarter views - turned to its left and to
 * its right - on a transparent background (no floor, no backdrop: the PNG keeps its alpha, the page supplies the colour).
 * `azimuth` degrees off the front, `elevation` degrees above the ground, `fov` the lens. Returns [leftPNG, rightPNG], or one
 * PNG per entry of `views` ([{ az, el }], used for the extra hero shot of the finished-model page).
 */
export async function shootCover(vpc, cat, { spp = 256, azimuth = 38, elevation = 24, fov = 32, outHeight = 1400, onProgress = null, views = null } = {}) {
  vpc.lego.updateMatrixWorld(true);
  const box = new THREE.Box3(vpc.lego.localToWorld(new THREE.Vector3(0, 0, 0)), vpc.lego.localToWorld(new THREE.Vector3(vpc.W, vpc.H, vpc.D)));
  const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
  const dist = r / Math.sin(fov * Math.PI / 360) * 1.05;
  const out = [], list = views || [{ az: -azimuth }, { az: azimuth }];
  for (const v of list) {
    const a = v.az * Math.PI / 180, e = (v.el ?? elevation) * Math.PI / 180;
    const cam = new THREE.PerspectiveCamera(fov, 1, dist / 100, dist * 10);
    cam.position.set(c.x + Math.sin(a) * Math.cos(e) * dist, c.y + Math.sin(e) * dist, c.z + Math.cos(a) * Math.cos(e) * dist);
    cam.lookAt(c); cam.updateMatrixWorld(true);
    const job = await createPathTrace(vpc, { pieces: vpc.pieces, cat, colorMode: 'piece', dark: false, spp, camera: cam, transparent: true, floor: false, outHeight, margin: 1.08 });
    try {
      await job.run((n, total) => onProgress && onProgress((out.length + n / total) / list.length));
      out.push(job.url());
    } finally { job.dispose(); }
  }
  return out;
}

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
 */
export async function shootBooklet(vpc, cat, { title = 'model', opts = {}, meta = {}, onProgress = null, onStage = null, cover: coverOpt = {},
  dimRGB = [160, 160, 160], dimInkRGB = [112, 112, 112], inkRGB = [16, 19, 26], ar = 1.75, maxW = 900 } = {}) {
  const P = vpc.pieces, by = {}; for (const c of cat) by[c.id] = c;
  const { steps } = planSteps(P, opts);
  vpc.setTheme(false); vpc.setMode('lego'); vpc.setOutline(true); vpc.paused = true;
  vpc.setAllStuds(true);                                                       // a plate must show its studs even in the steps before something covers them
  const all = new Uint8Array(P.length).fill(1);
  vpc.showStep(all, null);
  // the cover: the finished model in its own colours, in perspective; plus the hero shot of the last page
  let covers = null, final = null;
  if (coverOpt !== false) {
    const { hero = true, azimuth = 38, elevation = 24, ...co } = coverOpt;
    const views = [{ az: -azimuth }, { az: azimuth }, ...(hero ? [{ az: 14, el: elevation - 5 }] : [])];
    try {
      onStage && onStage(hero ? 'Rendering the cover and the finished model' : 'Rendering the cover');
      const shots = await shootCover(vpc, cat, { ...co, azimuth, elevation, views, onProgress });
      covers = shots.slice(0, 2); final = shots[2] || null;
    } catch (e) { console.warn('path-traced cover failed, using the viewport:', e); }
  }
  if (!covers) {
    covers = [vpc.capture(1100, { quality: 0.9, rect: vpc.modelRect(4 / 3, 0.1), bg: '#f3f0d6', floor: false })];
    final = vpc.capture(1400, { quality: 0.92, rect: vpc.modelRect(1.5, 0.06), bg: '#ffffff', floor: false });
  }
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
  const html = bookletHTML({ title, covers, final, steps: withParts, images, bom: billOfMaterials(P, by),
    meta: { pieces: P.length, levels: Math.max(...P.map((p) => p.b + p.h)), ...meta } });
  vpc.setAllStuds(false); vpc.setInkPerPiece(false);
  return { html, steps: steps.length, pages: Math.ceil(steps.length / 4) + 3 };
}
